import { db } from "@/db/appDb";
import { getStepsAnnouncementAvailability } from "@/db/announcement-actions";
import { SETTINGS_ID } from "@/db/normalize";
import { setGuidedAudioMode } from "@/db/settings-actions";
import {
  abortSession,
  findActiveSession,
  findPlanEntryForStart,
  resolveSessionWeekContext,
  type StartSessionOptions,
} from "@/db/session-actions";
import {
  addGuidedEvent,
  deriveGuidedProtocol,
  deriveGuidedRunState,
  guidedRunEndsAt,
} from "@/domain/guided-run";
import { isGuidedTemplate } from "@/domain/guided-steps";
import type { GuidedAudioMode, WorkoutSession } from "@/domain/models";
import { resolveWorkoutCategory } from "@/domain/workout-category";
import { createId } from "@/lib/id";

/*
 * Die Schreibwege einer geführten Einheit.
 *
 * Eine geführte Einheit ist intern eine normale `WorkoutSession` - ohne
 * `WorkoutSessionExercise`-Zeilen, dafür mit `guided` (Schritt-Snapshot und
 * Ereignisse). `startSessionFromTemplate` und `materializeSession` bleiben für
 * Kraft, wie sie sind, und wissen nichts davon.
 */

export interface StartGuidedOptions extends StartSessionOptions {
  /** Die gewünschte Audio-Wahl; ohne sie gilt die zuletzt gewählte, sonst „Stimme + Ton“. */
  audioMode?: GuidedAudioMode;
}

/**
 * Startet eine geführte Einheit.
 *
 * Läuft schon eine Session - gleich welcher Art -, entsteht keine zweite und
 * die Id der laufenden kommt zurück, wie beim Kraft-Start. Prüfung und Insert
 * stehen in derselben Transaktion, sonst erzeugen zwei schnelle Taps zwei
 * parallele aktive Sessions. Den Termin verknüpft dieselbe Regel wie beim
 * Kraft-Start (`findPlanEntryForStart`).
 */
export async function startGuidedSession(
  templateId: string,
  options: StartGuidedOptions = {},
): Promise<string> {
  const now = options.now ?? new Date();
  const template = await db.workoutTemplates.get(templateId);

  if (!template) {
    throw new Error("Workout nicht gefunden.");
  }

  if (!isGuidedTemplate(template)) {
    throw new Error(`${template.name} ist keine geführte Vorlage.`);
  }

  const { program, programWeek, resolvedProgramWeek, usedWeekOverride } =
    await resolveSessionWeekContext();
  // Vor der Transaktion: die Verfügbarkeit liest mehrere Tabellen und die TTS-Einstellungen.
  const availability = await getStepsAnnouncementAvailability(
    template.steps ?? [],
  );
  const wanted: GuidedAudioMode =
    options.audioMode ??
    (await db.appSettings.get(SETTINGS_ID))?.guidedAudioMode ??
    "voice";
  // „Stimme + Ton“ nur mit allen Ansagen: sonst läuft „Nur Ton“, und die Wahl bleibt, wie sie war.
  const audioMode: GuidedAudioMode =
    wanted === "voice" && availability.complete ? "voice" : "tone";
  const session: WorkoutSession = {
    id: createId(),
    templateId: template.id,
    templateNameSnapshot: template.name,
    templateCategorySnapshot: resolveWorkoutCategory(template.category),
    ...(program ? { programNameSnapshot: program.name } : {}),
    ...(programWeek ? { programWeekLabelSnapshot: programWeek.label } : {}),
    usedWeekOverride,
    resolvedProgramWeek,
    startedAt: now.toISOString(),
    status: "active",
    // Eine Kopie: spätere Importe ersetzen die Schritte der Vorlage, nicht die dieser Einheit.
    guided: {
      audioMode,
      steps: (template.steps ?? []).map((step) => ({ ...step })),
      events: addGuidedEvent(
        [],
        { type: "start", at: now.getTime() },
        template.steps ?? [],
      ),
    },
  };

  return db.transaction(
    "rw",
    db.planEntries,
    db.runLogs,
    db.workoutSessions,
    db.appSettings,
    async () => {
      const existingActiveSession = await findActiveSession();

      if (existingActiveSession) {
        return existingActiveSession.id;
      }

      const planEntry = await findPlanEntryForStart(templateId, options, now);

      if (planEntry) {
        session.planEntryId = planEntry.id;
        session.planDateSnapshot = planEntry.date;
      }

      await db.workoutSessions.add(session);

      if (options.audioMode && audioMode === wanted) {
        await setGuidedAudioMode(audioMode);
      }

      return session.id;
    },
  );
}

/**
 * Das automatische Ende nach dem letzten Abschnitt.
 *
 * `completedAt` ist das rechnerische Ende (Start plus Gesamtdauer), nicht
 * `now`: kehrt die Seite erst Minuten später aus dem Hintergrund zurück, soll
 * die Einheit trotzdem so lang gewesen sein, wie sie war, und in der Woche
 * stehen, in der sie endete. Liefert `true`, wenn dieser Aufruf abgeschlossen
 * hat; `false`, wenn nichts zu tun war (noch nicht zu Ende, schon
 * abgeschlossen oder abgebrochen, keine geführte Session). Dem Abbruch
 * ("Einheit beenden") dient weiter `abortSession`.
 */
export async function completeGuidedSession(
  sessionId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return db.transaction("rw", db.workoutSessions, async () => {
    const session = await db.workoutSessions.get(sessionId);

    if (!session) {
      throw new Error("Session nicht gefunden");
    }

    if (session.status !== "active" || !session.guided) {
      return false;
    }

    const endsAt = guidedRunEndsAt(session.guided.steps, session.guided.events);

    if (endsAt === null || now.getTime() < endsAt) {
      return false;
    }

    await db.workoutSessions.update(sessionId, {
      status: "completed",
      completedAt: new Date(endsAt).toISOString(),
      // Das Protokoll gilt bis zum rechnerischen Ende, nicht bis `now`.
      guided: {
        ...session.guided,
        protocol: deriveGuidedProtocol(
          session.guided.steps,
          session.guided.events,
          endsAt,
        ),
      },
    });

    return true;
  });
}

/** Die Steuer-Ereignisse, die der Screen auslösen darf. */
export type GuidedControl =
  "pause" | "resume" | "restart" | "skip" | "extend" | "back" | "startNow";

/**
 * Hängt ein Steuer-Ereignis (Pause, Weiter, Schritt neu starten, Überspringen, +15 s, Zurück, Sofort starten) an die
 * laufende Einheit. Die Gültigkeit prüft `addGuidedEvent`; hier kommt dazu,
 * dass die Session aktiv und geführt ist und nicht schon zu Ende gelaufen
 * ist - nach dem letzten Abschnitt gibt es nichts mehr anzuhalten.
 */
export async function recordGuidedControl(
  sessionId: string,
  control: GuidedControl,
  now: Date = new Date(),
): Promise<void> {
  await db.transaction("rw", db.workoutSessions, async () => {
    const session = await db.workoutSessions.get(sessionId);

    if (!session) {
      throw new Error("Session nicht gefunden");
    }

    if (session.status !== "active" || !session.guided) {
      throw new Error("Die Einheit läuft nicht mehr.");
    }

    const { steps, events } = session.guided;

    if (
      deriveGuidedRunState(steps, events, now.getTime()).phase === "finished"
    ) {
      throw new Error("Die Einheit ist schon zu Ende.");
    }

    await db.workoutSessions.update(sessionId, {
      guided: {
        ...session.guided,
        events: addGuidedEvent(
          events,
          { type: control, at: now.getTime() },
          steps,
        ),
      },
    });
  });
}

/**
 * „Einheit beenden“: bricht die geführte Einheit ab. Wie jeder Abbruch zählt
 * sie weder im Wochenvolumen, noch erledigt sie den Plan-Termin - er bleibt
 * offen und lässt sich neu starten. Eine schon abgeschlossene oder
 * abgebrochene Einheit bleibt unberührt. Beim Abbruch wird das Schritt-Protokoll
 * bis `now` festgehalten: die laufende Übung steht als abgebrochen darin.
 */
export async function abortGuidedSession(
  sessionId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.transaction("rw", db.workoutSessions, async () => {
    const session = await db.workoutSessions.get(sessionId);

    if (!session) {
      throw new Error("Session nicht gefunden");
    }

    if (!session.guided) {
      throw new Error("Das ist keine geführte Einheit.");
    }

    if (session.status !== "active") {
      return;
    }

    await abortSession(sessionId);
    await db.workoutSessions.update(sessionId, {
      completedAt: now.toISOString(),
      guided: {
        ...session.guided,
        protocol: deriveGuidedProtocol(
          session.guided.steps,
          session.guided.events,
          now.getTime(),
        ),
      },
    });
  });
}

/**
 * Schaltet die Audio-Wahl der laufenden Einheit um und merkt sie als zuletzt
 * gewählt. Die Zeit bleibt unberührt: es kommt kein Ereignis dazu. „Stimme +
 * Ton“ gibt es nur, wenn alle Ansagen der Einheit da sind - sonst wirft die
 * Aktion, und die Wahl bleibt stehen.
 */
export async function setGuidedSessionAudioMode(
  sessionId: string,
  mode: GuidedAudioMode,
): Promise<void> {
  const session = await db.workoutSessions.get(sessionId);

  if (!session) {
    throw new Error("Session nicht gefunden");
  }

  if (!session.guided) {
    throw new Error("Das ist keine geführte Einheit.");
  }

  // Vor der Transaktion, wie beim Start.
  if (
    mode === "voice" &&
    !(await getStepsAnnouncementAvailability(session.guided.steps)).complete
  ) {
    throw new Error("Keine Ansagen für diese Vorlage.");
  }

  await db.transaction("rw", db.workoutSessions, db.appSettings, async () => {
    const current = await db.workoutSessions.get(sessionId);

    if (!current?.guided || current.status !== "active") {
      throw new Error("Die Einheit läuft nicht mehr.");
    }

    await db.workoutSessions.update(sessionId, {
      guided: { ...current.guided, audioMode: mode },
    });
    await setGuidedAudioMode(mode);
  });
}
