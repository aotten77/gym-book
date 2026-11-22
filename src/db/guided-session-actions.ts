import { db } from "@/db/appDb";
import {
  abortSession,
  findActiveSession,
  findPlanEntryForStart,
  resolveSessionWeekContext,
  type StartSessionOptions,
} from "@/db/session-actions";
import {
  addGuidedEvent,
  deriveGuidedRunState,
  guidedRunEndsAt,
} from "@/domain/guided-run";
import { isGuidedTemplate } from "@/domain/guided-steps";
import type { WorkoutSession } from "@/domain/models";
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
  options: StartSessionOptions = {},
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
        steps,
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
 * abgebrochene Einheit bleibt unberührt.
 */
export async function abortGuidedSession(sessionId: string): Promise<void> {
  const session = await db.workoutSessions.get(sessionId);

  if (!session) {
    throw new Error("Session nicht gefunden");
  }

  if (!session.guided) {
    throw new Error("Das ist keine geführte Einheit.");
  }

  await abortSession(sessionId);
}
