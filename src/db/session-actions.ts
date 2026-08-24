import { db } from '@/db/appDb';
import { normalizeOptionalNumber, normalizeOptionalText } from '@/db/normalize';
import type {
  Side,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSetLog,
} from '@/domain/models';
import {
  clampRestSeconds,
  DEFAULT_REST_SECONDS,
  findRestTrack,
  pruneRestTracks,
  removeRestTrack,
  removeRestTracksForExercise,
  upsertRestTrack,
} from '@/domain/rest-timer';
import type { SetLogValuesInput } from '@/domain/history';
import { materializeSession } from '@/domain/session';
import { clampSetTimerSeconds } from '@/domain/set-timer';
import {
  areGroupsContiguous,
  planGroupWithPrevious,
  planUngroup,
  type SupersetAssignment,
} from '@/domain/superset';
import { createId } from '@/lib/id';

// Weiterhin von hier aus zu haben: der Typ gehört zur Aktion, auch wenn er
// in `domain` liegen muss, damit reine Module ihn benutzen dürfen.
export type { SetLogValuesInput };

interface AddSessionExerciseInput {
  sessionId: string;
  /** Immer eine bestehende Übung - angelegt wird sie in `exercise-actions.ts`. */
  exerciseId: string;
  workSetCount: number;
  includeWarmup?: boolean;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  targetBandId?: string;
  targetHeightCm?: number;
  restSeconds?: number;
  notes?: string;
}

function createSetLogs(
  sessionExerciseId: string,
  workSetCount: number,
  unilateral: boolean,
  includeWarmup = true,
) {
  const sides = unilateral ? (['left', 'right'] as const) : (['both'] as const);
  const setLogs: WorkoutSetLog[] = [];

  // Spiegelt die Regel aus `materializeSession`: höchstens eine Aufwärmrunde,
  // nur wenn sie nicht ausdrücklich abgewählt wurde, und einseitig gespiegelt
  // wie die Arbeitssätze.
  if (includeWarmup) {
    for (const side of sides) {
      setLogs.push({
        id: createId(),
        sessionExerciseId,
        setKind: 'warmup',
        side,
        setNumber: 0,
        completed: false,
      });
    }
  }

  for (let setNumber = 1; setNumber <= workSetCount; setNumber += 1) {
    for (const side of sides) {
      setLogs.push({
        id: createId(),
        sessionExerciseId,
        setKind: 'work',
        side,
        setNumber,
        completed: false,
      });
    }
  }

  return setLogs;
}

async function isSessionExerciseEditable(sessionExerciseId: string) {
  const sessionExercise = await db.workoutSessionExercises.get(sessionExerciseId);

  if (!sessionExercise) {
    return false;
  }

  const session = await db.workoutSessions.get(sessionExercise.sessionId);
  return session?.status === 'active';
}

async function isSetLogEditable(setLogId: string) {
  const setLog = await db.workoutSetLogs.get(setLogId);

  if (!setLog) {
    return false;
  }

  return isSessionExerciseEditable(setLog.sessionExerciseId);
}

export async function findActiveSession() {
  return db.workoutSessions.where('status').equals('active').first();
}

export async function startSessionFromTemplate(templateId: string) {
  const template = await db.workoutTemplates.get(templateId);

  if (!template) {
    throw new Error('Template not found');
  }

  const templateExercises = await db.workoutTemplateExercises
    .where('templateId')
    .equals(templateId)
    .sortBy('orderIndex');

  const exercises = await db.exercises.bulkGet(templateExercises.map((item) => item.exerciseId));
  const settings = await db.appSettings.get('app-settings');
  const program = settings?.activeProgramId
    ? await db.programs.get(settings.activeProgramId)
    : undefined;
  const resolvedProgramWeek = settings?.weekOverride ?? program?.activeWeek ?? 1;
  const usedWeekOverride = typeof settings?.weekOverride === 'number';
  const programWeek =
    program && settings?.activeProgramId
      ? (
          await db.programWeeks
            .where('programId')
            .equals(settings.activeProgramId)
            .filter((week) => week.weekNumber === resolvedProgramWeek)
            .first()
        )
      : undefined;
  const progressionRules =
    programWeek && templateExercises.length > 0
      ? await db.progressionRules.where('programWeekId').equals(programWeek.id).toArray()
      : [];
  const progressionRulesByTemplateExerciseId = Object.fromEntries(
    progressionRules.map((rule) => [rule.templateExerciseId, rule]),
  );
  const bandLevels = await db.bandLevels.toArray();

  const bundle = materializeSession({
    template,
    templateExercises,
    exercisesById: Object.fromEntries(
      exercises.filter(Boolean).map((exercise) => [exercise.id, exercise]),
    ),
    progressionRulesByTemplateExerciseId,
    bandLevelsById: Object.fromEntries(bandLevels.map((band) => [band.id, band])),
    programNameSnapshot: program?.name,
    programWeekLabelSnapshot: programWeek?.label,
    usedWeekOverride,
    resolvedProgramWeek,
    startedAt: new Date().toISOString(),
  });

  return db.transaction(
    'rw',
    db.workoutSessions,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    async () => {
      // Der Check gehört in dieselbe Transaktion wie das Insert, sonst
      // erzeugen zwei schnelle Taps zwei parallele aktive Sessions.
      const existingActiveSession = await findActiveSession();

      if (existingActiveSession) {
        return existingActiveSession.id;
      }

      await db.workoutSessions.add(bundle.session);
      await db.workoutSessionExercises.bulkAdd(bundle.sessionExercises);
      await db.workoutSetLogs.bulkAdd(bundle.setLogs);

      return bundle.session.id;
    },
  );
}

export async function toggleSetCompletion(setLogId: string) {
  await db.transaction(
    'rw',
    db.workoutSessions,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    async () => {
      if (!(await isSetLogEditable(setLogId))) {
        return;
      }

      // Lesen und Schreiben in einem Zug: bei einem Doppeltipp würde ein
      // getrenntes get/update beide Male denselben Ausgangswert sehen.
      await db.workoutSetLogs.where('id').equals(setLogId).modify((log) => {
        const nextCompleted = !log.completed;
        log.completed = nextCompleted;

        if (nextCompleted) {
          log.completedAt = new Date().toISOString();
        } else {
          delete log.completedAt;
        }
      });
    },
  );
}

/**
 * Schreibt Satzwerte.
 *
 * Nur Felder, die im Input als eigene Property vorhanden sind, werden
 * angefasst. Ein fehlendes Feld bleibt unverändert; ein Feld mit `undefined`
 * wird bewusst geleert. Ohne diese Unterscheidung würde eine Fehleingabe
 * über Dexies `undefined = Property löschen` einen gespeicherten Wert
 * vernichten.
 */
export async function updateSetLogValues(setLogId: string, values: SetLogValuesInput) {
  /*
   * Geklammert wie die direkten Nachbarn `toggleSetCompletion` und
   * `deleteSetLog`: gelesen werden der Satz, seine Übung, deren Session und
   * der Band-Katalog, geschrieben wird danach - dazwischen darf sich nichts
   * ändern. Der Katalog gehört in den Scope, weil der Bandname aus ihm kommt
   * und zusammen mit der Id geschrieben wird; ein Löschen dazwischen ergäbe
   * einen Satz mit Id und ohne Namen.
   *
   * Alle `await` darin sind Dexies eigene - jedes andere schlösse die
   * Transaktion.
   */
  await db.transaction(
    'rw',
    db.workoutSessions,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    db.bandLevels,
    async () => {
      if (!(await isSetLogEditable(setLogId))) {
        return;
      }

      const current = await db.workoutSetLogs.get(setLogId);

      if (!current) {
        return;
      }

      const changes: Partial<
        Pick<
          WorkoutSetLog,
          'reps' | 'seconds' | 'weight' | 'heightCm' | 'bandId' | 'bandNameSnapshot'
        >
      > = {};

      if ('reps' in values) {
        changes.reps = normalizeOptionalNumber(values.reps);
      }

      if ('seconds' in values) {
        changes.seconds = normalizeOptionalNumber(values.seconds);
      }

      if ('weight' in values) {
        changes.weight = normalizeOptionalNumber(values.weight);
      }

      if ('heightCm' in values) {
        changes.heightCm = normalizeOptionalNumber(values.heightCm);
      }

      if ('bandId' in values) {
        const bandId = normalizeOptionalText(values.bandId);
        const band = bandId ? await db.bandLevels.get(bandId) : undefined;

        // Eine Id ohne passendes Band im Katalog wird ignoriert statt geschrieben:
        // sonst stünde am Satz eine Auswahl, die niemand mehr benennen kann.
        if (!bandId || band) {
          changes.bandId = bandId;
          // Id und Name gehören zusammen - beide setzen oder beide leeren.
          changes.bandNameSnapshot = band?.name;
        }
      }

      if (Object.keys(changes).length === 0) {
        return;
      }

      await db.workoutSetLogs.update(setLogId, changes);
    },
  );
}

/**
 * Entfernt eine einzelne Satzzeile aus einer laufenden Session.
 *
 * Bewusst genau eine Zeile: bei unilateralen Übungen sind links und rechts
 * getrennte Datensätze, und wer nur eine Seite streichen will, soll die
 * andere behalten dürfen. `workSetCount` auf der Session-Übung bleibt
 * unangetastet - der Wert beschreibt die Materialisierung, nicht den
 * laufenden Stand.
 */
export async function deleteSetLog(setLogId: string) {
  await db.transaction(
    'rw',
    db.workoutSessions,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    async () => {
      // Derselbe Guard wie beim Werteschreiben: abgeschlossene Sessions sind
      // unveränderlich.
      if (!(await isSetLogEditable(setLogId))) {
        return;
      }

      const setLog = await db.workoutSetLogs.get(setLogId);
      const sessionExercise = setLog
        ? await db.workoutSessionExercises.get(setLog.sessionExerciseId)
        : undefined;

      await db.workoutSetLogs.delete(setLogId);

      if (!setLog || !sessionExercise) {
        return;
      }

      const session = await db.workoutSessions.get(sessionExercise.sessionId);

      if (!session) {
        return;
      }

      const changes: Partial<WorkoutSession> = {};

      // Ein Timer ohne Satzzeile hätte kein Ziel mehr für sein Ergebnis und
      // liefe in der Leiste bis zum Ablauf weiter.
      if (session.setTimer?.setLogId === setLogId) {
        changes.setTimer = undefined;
      }

      // Dieselbe Überlegung für die Pause: sie gehört zu einer Übung *und*
      // einer Seite. Erst wenn die letzte Zeile dieser Seite weg ist, gibt es
      // nichts mehr, worauf sich das Warten bezöge.
      const remainingOnSide = await db.workoutSetLogs
        .where('sessionExerciseId')
        .equals(sessionExercise.id)
        .filter((log) => log.side === setLog.side)
        .count();

      if (remainingOnSide === 0 && findRestTrack(session.restTimers, sessionExercise.id, setLog.side)) {
        changes.restTimers = removeRestTrack(session.restTimers, sessionExercise.id, setLog.side);
      }

      if (Object.keys(changes).length > 0) {
        await db.workoutSessions.update(session.id, changes);
      }
    },
  );
}

export async function addSessionExercise(input: AddSessionExerciseInput) {
  const session = await db.workoutSessions.get(input.sessionId);

  if (!session || session.status !== 'active') {
    throw new Error('Active session not found');
  }

  const existingSessionExercises = await db.workoutSessionExercises
    .where('sessionId')
    .equals(input.sessionId)
    .sortBy('orderIndex');
  const nextOrderIndex =
    existingSessionExercises.length > 0
      ? Math.max(...existingSessionExercises.map((item) => item.orderIndex)) + 1
      : 1;
  const workSetCount = Math.max(1, input.workSetCount);
  const exercise = await db.exercises.get(input.exerciseId);

  if (!exercise) {
    throw new Error('Exercise not found');
  }

  const { trackingMode, loadKind, tracksHeight, unilateral } = exercise;
  const targetBandId = normalizeOptionalText(input.targetBandId);
  const targetBand = targetBandId ? await db.bandLevels.get(targetBandId) : undefined;
  const sessionExerciseId = createId();
  const setLogs = createSetLogs(
    sessionExerciseId,
    workSetCount,
    unilateral,
    input.includeWarmup !== false,
  );

  await db.transaction('rw', db.workoutSessionExercises, db.workoutSetLogs, async () => {
    await db.workoutSessionExercises.add({
      id: sessionExerciseId,
      sessionId: input.sessionId,
      exerciseId: exercise.id,
      exerciseNameSnapshot: exercise.name,
      trackingMode,
      loadKind,
      tracksHeight,
      unilateral,
      orderIndex: nextOrderIndex,
      wasSkipped: false,
      addedInSession: true,
      workSetCount,
      targetReps: normalizeOptionalNumber(input.targetReps),
      targetSeconds: normalizeOptionalNumber(input.targetSeconds),
      targetWeight: normalizeOptionalNumber(input.targetWeight),
      targetBandId,
      targetBandNameSnapshot: targetBand?.name,
      targetHeightCm: normalizeOptionalNumber(input.targetHeightCm),
      restSeconds: normalizeOptionalNumber(input.restSeconds),
      notes: normalizeOptionalText(input.notes),
    });

    await db.workoutSetLogs.bulkAdd(setLogs);
  });

  return sessionExerciseId;
}

export async function toggleSkipSessionExercise(sessionExerciseId: string) {
  await db.transaction('rw', db.workoutSessions, db.workoutSessionExercises, async () => {
    if (!(await isSessionExerciseEditable(sessionExerciseId))) {
      return;
    }

    let becameSkipped = false;

    // `modify` liest und schreibt in einem Zug, damit ein Doppeltipp den
    // Zustand nicht zweimal auf denselben Wert setzt.
    await db.workoutSessionExercises.where('id').equals(sessionExerciseId).modify((item) => {
      item.wasSkipped = !item.wasSkipped;
      becameSkipped = item.wasSkipped;
    });

    if (!becameSkipped) {
      return;
    }

    const sessionExercise = await db.workoutSessionExercises.get(sessionExerciseId);
    const session = sessionExercise
      ? await db.workoutSessions.get(sessionExercise.sessionId)
      : undefined;

    // Eine Pause für eine übersprungene Übung zählt auf nichts mehr hin.
    if (session?.restTimers?.length) {
      await db.workoutSessions.update(session.id, {
        restTimers: removeRestTracksForExercise(session.restTimers, sessionExerciseId),
      });
    }
  });
}

export async function reorderSessionExercises(sessionId: string, orderedSessionExerciseIds: string[]) {
  const session = await db.workoutSessions.get(sessionId);

  if (!session || session.status !== 'active') {
    return;
  }

  const currentExercises = await db.workoutSessionExercises
    .where('sessionId')
    .equals(sessionId)
    .sortBy('orderIndex');

  if (currentExercises.length !== orderedSessionExerciseIds.length) {
    return;
  }

  const knownIds = new Set(currentExercises.map((item) => item.id));

  if (orderedSessionExerciseIds.some((id) => !knownIds.has(id))) {
    return;
  }

  // Eine Reihenfolge, die einen Supersatz zerreißt, entstünde stumm und ließe
  // sich danach weder darstellen noch am Stück bewegen.
  const exerciseById = new Map(currentExercises.map((item) => [item.id, item]));
  const nextOrder = orderedSessionExerciseIds
    .map((id) => exerciseById.get(id))
    .filter((item): item is WorkoutSessionExercise => Boolean(item));

  if (!areGroupsContiguous(nextOrder)) {
    return;
  }

  await db.transaction('rw', db.workoutSessionExercises, async () => {
    await Promise.all(
      orderedSessionExerciseIds.map((id, index) =>
        db.workoutSessionExercises.update(id, {
          orderIndex: index + 1,
        }),
      ),
    );
  });
}

/**
 * Startet die Pause für die Übung und Seite einer Satzzeile.
 *
 * Der Bezug auf beides ist der Kern des Pausenmanagements: im Supersatz läuft
 * die Pause der ersten Übung weiter, während die zweite dran ist, und bei
 * einer einseitigen Übung pausiert rechts, während links trainiert wird. Ein
 * zweiter Satz derselben Seite löst die eigene Pause ab, keine fremde.
 */
export async function startRestTimerForSetLog(setLogId: string, seconds?: number) {
  await db.transaction(
    'rw',
    db.workoutSessions,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    async () => {
      if (!(await isSetLogEditable(setLogId))) {
        return;
      }

      const setLog = await db.workoutSetLogs.get(setLogId);
      const sessionExercise = setLog
        ? await db.workoutSessionExercises.get(setLog.sessionExerciseId)
        : undefined;

      if (!setLog || !sessionExercise) {
        return;
      }

      const session = await db.workoutSessions.get(sessionExercise.sessionId);

      if (session?.status !== 'active') {
        return;
      }

      await writeRestTrack(
        session,
        sessionExercise.id,
        setLog.side,
        seconds ?? sessionExercise.restSeconds ?? DEFAULT_REST_SECONDS,
      );
    },
  );
}

/** Manueller Start über die Leiste - ohne dass ein Satz abgehakt wurde. */
export async function startRestTimerForExercise(
  sessionId: string,
  sessionExerciseId: string,
  side: Side,
  seconds?: number,
) {
  await db.transaction('rw', db.workoutSessions, db.workoutSessionExercises, async () => {
    const session = await db.workoutSessions.get(sessionId);
    const sessionExercise = await db.workoutSessionExercises.get(sessionExerciseId);

    if (session?.status !== 'active' || sessionExercise?.sessionId !== sessionId) {
      return;
    }

    await writeRestTrack(
      session,
      sessionExerciseId,
      side,
      seconds ?? sessionExercise.restSeconds ?? DEFAULT_REST_SECONDS,
    );
  });
}

async function writeRestTrack(
  session: WorkoutSession,
  sessionExerciseId: string,
  side: Side,
  seconds: number,
) {
  const durationSeconds = clampRestSeconds(seconds);
  const now = Date.now();

  await db.workoutSessions.update(session.id, {
    // Beim Start gleich aufräumen: lange abgelaufene Spuren würden sonst nur
    // die Leiste zustellen.
    restTimers: upsertRestTrack(pruneRestTracks(session.restTimers, now), {
      sessionExerciseId,
      side,
      durationSeconds,
      endsAt: now + durationSeconds * 1000,
    }),
  });
}

/**
 * Verschiebt das Ende einer Pause - vorwärts wie rückwärts.
 *
 * Ein negatives `seconds` verkürzt. Über den Nullpunkt hinaus geht das
 * bewusst nicht: eine Spur, die im selben Moment abläuft, meldet einen Ablauf,
 * den niemand abgewartet hat - samt Ton und Vibration. Wer sofort weiter will,
 * beendet die Pause ([clearRestTimer]), statt sie auf null zu kürzen.
 */
export async function extendRestTimer(
  sessionId: string,
  sessionExerciseId: string,
  side: Side,
  seconds: number,
) {
  await db.transaction('rw', db.workoutSessions, async () => {
    const session = await db.workoutSessions.get(sessionId);

    if (session?.status !== 'active') {
      return;
    }

    const now = Date.now();
    const current = findRestTrack(session.restTimers, sessionExerciseId, side);
    const added = Math.round(seconds);
    // Von der Restlaufzeit aus verlängern, nicht vom ursprünglichen Ende:
    // eine abgelaufene Pause startet damit sauber neu.
    const base = Math.max(current?.endsAt ?? 0, now);
    const endsAt = base + added * 1000;

    if (endsAt <= now) {
      return;
    }

    await db.workoutSessions.update(sessionId, {
      restTimers: upsertRestTrack(session.restTimers, {
        sessionExerciseId,
        side,
        endsAt,
        // Die gelaufene Zeit bleibt gelaufen: der Balken zeigt weiter
        // denselben Anteil, nur gegen ein näher gerücktes Ende.
        durationSeconds: Math.max(1, (current?.durationSeconds ?? 0) + added),
      }),
    });
  });
}

/**
 * Bricht Pausen ab: eine bestimmte Spur, alle einer Übung oder alle der
 * Session. Der Guard fehlte hier früher als einziger Timer-Aktion.
 */
export async function clearRestTimer(sessionId: string, sessionExerciseId?: string, side?: Side) {
  await db.transaction('rw', db.workoutSessions, async () => {
    const session = await db.workoutSessions.get(sessionId);

    if (session?.status !== 'active') {
      return;
    }

    if (!sessionExerciseId) {
      await db.workoutSessions.update(sessionId, { restTimers: [] });
      return;
    }

    await db.workoutSessions.update(sessionId, {
      restTimers: side
        ? removeRestTrack(session.restTimers, sessionExerciseId, side)
        : removeRestTracksForExercise(session.restTimers, sessionExerciseId),
    });
  });
}

/** Räumt Spuren weg, deren Karenzzeit abgelaufen ist. */
export async function pruneRestTimers(sessionId: string, now = Date.now()) {
  await db.transaction('rw', db.workoutSessions, async () => {
    const session = await db.workoutSessions.get(sessionId);

    if (session?.status !== 'active' || !session.restTimers?.length) {
      return;
    }

    const next = pruneRestTracks(session.restTimers, now);

    // Ohne diesen Vergleich schriebe jeder Sekundentakt denselben Stand und
    // ließe über useLiveQuery die ganze Session neu rendern.
    if (next.length === session.restTimers.length) {
      return;
    }

    await db.workoutSessions.update(sessionId, { restTimers: next });
  });
}

/**
 * Verbindet eine Session-Übung mit ihrer Vorgängerin zu einem Supersatz bzw.
 * löst sie wieder heraus.
 *
 * Arbeitet ausschließlich auf der Session-Kopie: ein Supersatz, der beim
 * Training entsteht oder gelöst wird, darf den Plan nicht anfassen.
 */
async function applySessionSupersetPlan(
  sessionExerciseId: string,
  plan: (
    items: WorkoutSessionExercise[],
    id: string,
  ) => SupersetAssignment[] | null,
) {
  await db.transaction('rw', db.workoutSessions, db.workoutSessionExercises, async () => {
    if (!(await isSessionExerciseEditable(sessionExerciseId))) {
      return;
    }

    const current = await db.workoutSessionExercises.get(sessionExerciseId);

    if (!current) {
      return;
    }

    const items = await db.workoutSessionExercises
      .where('sessionId')
      .equals(current.sessionId)
      .sortBy('orderIndex');
    const assignments = plan(items, sessionExerciseId);

    if (!assignments) {
      return;
    }

    await Promise.all(
      assignments.map((entry) =>
        // `undefined` löscht die Property über Dexies Update-Semantik - beim
        // Lösen ist genau das gemeint.
        db.workoutSessionExercises.update(entry.id, { supersetGroupId: entry.supersetGroupId }),
      ),
    );
  });
}

export async function groupSessionExerciseWithPrevious(sessionExerciseId: string) {
  await applySessionSupersetPlan(sessionExerciseId, planGroupWithPrevious);
}

export async function ungroupSessionExercise(sessionExerciseId: string) {
  await applySessionSupersetPlan(sessionExerciseId, planUngroup);
}

/**
 * Startet den Timer für einen Satz auf Zeit.
 *
 * Der Timer hängt an der Session, nicht an der Satzzeile: es läuft immer
 * höchstens einer, und ein Start auf einer anderen Zeile löst den vorigen
 * ohne Rückstand ab.
 *
 * `cuesEnabled` kommt vom Knopf, der gedrückt wurde, und ist voreingestellt
 * aus: der stille Start ist der Normalfall, gesprochen wird nur, wenn man es
 * ausdrücklich verlangt hat.
 */
export async function startSetTimer(
  sessionId: string,
  setLogId: string,
  seconds: number,
  cuesEnabled = false,
) {
  await db.transaction(
    'rw',
    db.workoutSessions,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    async () => {
      // Derselbe Guard wie beim Werteschreiben: in einer abgeschlossenen
      // Session gibt es nichts mehr zu messen.
      if (!(await isSetLogEditable(setLogId))) {
        return;
      }

      const setLog = await db.workoutSetLogs.get(setLogId);
      const sessionExercise = setLog
        ? await db.workoutSessionExercises.get(setLog.sessionExerciseId)
        : undefined;

      // Verhindert einen Timer, der auf eine Satzzeile einer fremden Session
      // zeigt - sein Ergebnis landete sonst außerhalb der laufenden Session.
      if (sessionExercise?.sessionId !== sessionId) {
        return;
      }

      const durationSeconds = clampSetTimerSeconds(seconds);

      await db.workoutSessions.update(sessionId, {
        setTimer: {
          setLogId,
          durationSeconds,
          endsAt: Date.now() + durationSeconds * 1000,
          cuesEnabled,
        },
      });
    },
  );
}

/**
 * Beendet den Satz-Timer und schreibt die erreichte Zeit in den Satz.
 *
 * Genau dafür ist der Timer da: was gemessen wurde, muss nicht noch einmal
 * getippt werden. `seconds` kommt vom Aufrufer, weil nur er weiß, ob der Timer
 * abgelaufen ist (volle Dauer) oder vorzeitig gestoppt wurde (gehaltene Zeit).
 */
export async function finishSetTimer(sessionId: string, seconds: number) {
  const session = await db.workoutSessions.get(sessionId);
  const timer = session?.setTimer;

  if (!session || session.status !== 'active' || !timer) {
    return;
  }

  const value = Math.max(0, Math.round(seconds));

  await updateSetLogValues(timer.setLogId, { seconds: value });
  await db.workoutSessions.update(sessionId, { setTimer: undefined });
}

/** Bricht den Satz-Timer ab, ohne einen Wert zu schreiben. */
export async function clearSetTimer(sessionId: string) {
  await db.workoutSessions.update(sessionId, { setTimer: undefined });
}

async function closeSession(sessionId: string, status: 'completed' | 'aborted') {
  await db.transaction('rw', db.workoutSessions, async () => {
    const session = await db.workoutSessions.get(sessionId);

    if (!session) {
      throw new Error('Session nicht gefunden');
    }

    // Nur eine laufende Session lässt sich abschließen. Ohne diesen Guard
    // überschreibt ein zweiter Tipp den bereits gesetzten Abschlusszeitpunkt.
    if (session.status !== 'active') {
      return;
    }

    await db.workoutSessions.update(sessionId, {
      status,
      completedAt: new Date().toISOString(),
      restTimers: undefined,
      setTimer: undefined,
    });
  });
}

export async function completeSession(sessionId: string) {
  await closeSession(sessionId, 'completed');
}

/**
 * Bricht eine laufende Session ab. Ohne diesen Weg bleibt eine versehentlich
 * gestartete Session für immer aktiv und blockiert jeden neuen Trainingsstart.
 */
export async function abortSession(sessionId: string) {
  await closeSession(sessionId, 'aborted');
}
