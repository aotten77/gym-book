import { db } from '@/db/appDb';
import { isSetLogEditable } from '@/db/session-guards';
import { updateSetLogValues } from '@/db/session-actions';
import type { Side, WorkoutSession } from '@/domain/models';
import {
  clampRestSeconds,
  DEFAULT_REST_SECONDS,
  findRestTrack,
  pruneRestTracks,
  removeRestTrack,
  removeRestTracksForExercise,
  upsertRestTrack,
} from '@/domain/rest-timer';
import { clampSetTimerSeconds } from '@/domain/set-timer';

/*
 * Die Uhren einer laufenden Einheit - Pausen und der Satz-Timer.
 *
 * Ein eigener Schnitt aus `session-actions.ts`: 886 Zeilen mit fünf Belangen
 * waren der Grund, warum niemand die Aktionsschicht anfassen wollte. Die
 * Uhren hängen an der `WorkoutSession` und sonst an nichts aus der
 * Satz- und Übungs-CRUD; die einzige Kante zurück ist `updateSetLogValues`,
 * in das `finishSetTimer` seine gehaltene Zeit schreibt.
 *
 * Beide Sorten liegen auf der Session, damit sie einen Reload überleben - der
 * Zustandsspeicher der Oberfläche wäre der falsche Ort für etwas, das
 * weiterläuft, während man das Telefon weglegt.
 */

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
  /*
   * Zwei Schreibvorgänge, die nur zusammen einen Sinn ergeben: die Zeit in den
   * Satz und das Wegräumen des Timers. Bricht der zweite ab, steht die Zeit im
   * Satz, während die Leiste weiter auf ihn zeigt und ihn beim nächsten Ablauf
   * ein zweites Mal schreibt.
   *
   * Der Scope umfasst, was `updateSetLogValues` selbst klammert - Dexie
   * benutzt eine bestehende Transaktion weiter, solange der innere Scope eine
   * Teilmenge ist. Fehlte hier `bandLevels`, bräche der innere Aufruf ab.
   */
  await db.transaction(
    'rw',
    db.workoutSessions,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    db.bandLevels,
    async () => {
      const session = await db.workoutSessions.get(sessionId);
      const timer = session?.setTimer;

      if (!session || session.status !== 'active' || !timer) {
        return;
      }

      const value = Math.max(0, Math.round(seconds));

      await updateSetLogValues(timer.setLogId, { seconds: value });
      await db.workoutSessions.update(sessionId, { setTimer: undefined });
    },
  );
}

/**
 * Bricht den Satz-Timer ab, ohne einen Wert zu schreiben.
 *
 * Als einzige Timer-Aktion hatte sie gar keinen Guard und schrieb blind auf
 * jede Session. Ein Widerspruch zu `closeSession` entsteht daraus nicht: das
 * räumt den `setTimer` beim Abschließen ohnehin, hier bliebe also nur ein
 * `undefined` auf `undefined` zu setzen. Der Guard ist trotzdem richtig, weil
 * abgeschlossene Sessions unveränderlich sind - und er hält die Aktion mit
 * `startSetTimer` und `finishSetTimer` auf einer Linie.
 */
export async function clearSetTimer(sessionId: string) {
  await db.transaction('rw', db.workoutSessions, async () => {
    const session = await db.workoutSessions.get(sessionId);

    if (session?.status !== 'active') {
      return;
    }

    await db.workoutSessions.update(sessionId, { setTimer: undefined });
  });
}
