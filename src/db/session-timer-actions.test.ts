import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { createBandLevel } from '@/db/band-actions';
import {
  completeSession,
  deleteSetLog,
  toggleSkipSessionExercise,
  updateSetLogValues,
} from '@/db/session-actions';
import {
  clearRestTimer,
  clearSetTimer,
  extendRestTimer,
  finishSetTimer,
  pruneRestTimers,
  startRestTimerForExercise,
  startRestTimerForSetLog,
  startSetTimer,
} from '@/db/session-timer-actions';
import { REST_TRACK_GRACE_SECONDS } from '@/domain/rest-timer';
import { seedRestSession } from '@/test/session-fixtures';

/*
 * Die Uhren einer laufenden Einheit, geprüft an derselben Naht, an der auch
 * der Produktivcode getrennt ist. Vorher lag das in einer Sammeldatei von
 * 1.767 Zeilen - der Grund, warum niemand die Aktionsschicht anfassen wollte,
 * während `band-`, `exercise-` und `history-` längst eigene Testdateien haben.
 */

describe('Satz-Timer', () => {
  async function seedTimerSession(status: 'active' | 'completed') {
    await db.workoutSessions.add({
      id: `session-timer-${status}`,
      templateId: 'template-timer',
      templateNameSnapshot: 'Einheit Zeit',
      resolvedProgramWeek: 1,
      startedAt: '2026-01-08T09:00:00.000Z',
      status,
    });

    await db.workoutSessionExercises.add({
      id: `session-exercise-timer-${status}`,
      sessionId: `session-timer-${status}`,
      exerciseId: 'exercise-plank',
      exerciseNameSnapshot: 'Plank',
      trackingMode: 'time',
      unilateral: false,
      orderIndex: 1,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: 1,
      targetSeconds: 120,
    });

    await db.workoutSetLogs.add({
      id: `plank-${status}`,
      sessionExerciseId: `session-exercise-timer-${status}`,
      setKind: 'work',
      side: 'both',
      setNumber: 1,
      completed: false,
    });
  }

  it('startet den Timer auf der laufenden Session', async () => {
    await seedTimerSession('active');

    await startSetTimer('session-timer-active', 'plank-active', 120);

    const session = await db.workoutSessions.get('session-timer-active');
    expect(session?.setTimer?.setLogId).toBe('plank-active');
    expect(session?.setTimer?.durationSeconds).toBe(120);
    expect(session?.setTimer?.endsAt).toBeGreaterThan(Date.now());
  });

  it('startet keinen Timer in einer abgeschlossenen Session', async () => {
    await seedTimerSession('completed');

    await startSetTimer('session-timer-completed', 'plank-completed', 120);

    expect((await db.workoutSessions.get('session-timer-completed'))?.setTimer).toBeUndefined();
  });

  it('schreibt die gehaltene Zeit in den Satz und beendet den Timer', async () => {
    await seedTimerSession('active');
    await startSetTimer('session-timer-active', 'plank-active', 120);

    await finishSetTimer('session-timer-active', 107);

    expect((await db.workoutSetLogs.get('plank-active'))?.seconds).toBe(107);
    expect((await db.workoutSessions.get('session-timer-active'))?.setTimer).toBeUndefined();
  });

  it('schreibt auch eine Zeit über der Vorgabe', async () => {
    // Der ganze Zweck der Überzeit: wer länger hält, hat es nachher im Satz
    // stehen - sonst zeigt die Sekundenkurve für immer die Vorgabe.
    await seedTimerSession('active');
    await startSetTimer('session-timer-active', 'plank-active', 120);

    await finishSetTimer('session-timer-active', 142);

    expect((await db.workoutSetLogs.get('plank-active'))?.seconds).toBe(142);
  });

  it('schließt einen bandtragenden Satz ab, ohne am Scope zu scheitern', async () => {
    /*
     * Der Nachweis, dass `finishSetTimer`s Transaktion weit genug ist:
     * `updateSetLogValues` klammert selbst und liest dabei den Band-Katalog.
     * Dexie benutzt eine bestehende Transaktion nur weiter, wenn der innere
     * Scope eine Teilmenge ist - fehlte `bandLevels` außen, bräche der innere
     * Aufruf hier ab, und die Zeit landete nie im Satz.
     */
    await seedTimerSession('active');

    const bandId = await createBandLevel('grün');
    await updateSetLogValues('plank-active', { bandId });

    await startSetTimer('session-timer-active', 'plank-active', 120);
    await finishSetTimer('session-timer-active', 107);

    expect(await db.workoutSetLogs.get('plank-active')).toMatchObject({
      seconds: 107,
      bandId,
      bandNameSnapshot: 'grün',
    });
    expect((await db.workoutSessions.get('session-timer-active'))?.setTimer).toBeUndefined();
  });

  it('lässt eine unbekannte Band-Id stehen, statt sie zu schreiben', async () => {
    // Eine Id ohne passendes Band wäre am Satz eine Auswahl, die niemand mehr
    // benennen kann - der bisherige Wert bleibt deshalb unangetastet.
    await seedTimerSession('active');

    const bandId = await createBandLevel('grün');
    await updateSetLogValues('plank-active', { bandId });

    await updateSetLogValues('plank-active', { bandId: 'gibt-es-nicht' });

    expect(await db.workoutSetLogs.get('plank-active')).toMatchObject({
      bandId,
      bandNameSnapshot: 'grün',
    });
  });

  it('verwirft den Timer nicht mehr auf einer abgeschlossenen Session', async () => {
    // Als einzige Timer-Aktion hatte `clearSetTimer` gar keinen Guard.
    await seedTimerSession('completed');

    await db.workoutSessions.update('session-timer-completed', {
      setTimer: {
        setLogId: 'plank-completed',
        durationSeconds: 120,
        endsAt: Date.now() + 120_000,
      },
    });

    await clearSetTimer('session-timer-completed');

    expect((await db.workoutSessions.get('session-timer-completed'))?.setTimer).toBeDefined();
  });

  it('verwirft den Timer ohne einen Wert zu schreiben', async () => {
    await seedTimerSession('active');
    await updateSetLogValues('plank-active', { seconds: 90 });
    await startSetTimer('session-timer-active', 'plank-active', 120);

    await clearSetTimer('session-timer-active');

    expect((await db.workoutSessions.get('session-timer-active'))?.setTimer).toBeUndefined();
    expect((await db.workoutSetLogs.get('plank-active'))?.seconds).toBe(90);
  });

  it('beendet den Timer, wenn seine Satzzeile entfernt wird', async () => {
    await seedTimerSession('active');
    await startSetTimer('session-timer-active', 'plank-active', 120);

    await deleteSetLog('plank-active');

    expect((await db.workoutSessions.get('session-timer-active'))?.setTimer).toBeUndefined();
  });

  it('räumt den Timer beim Abschließen der Session ab', async () => {
    await seedTimerSession('active');
    await startSetTimer('session-timer-active', 'plank-active', 120);

    await completeSession('session-timer-active');

    expect((await db.workoutSessions.get('session-timer-active'))?.setTimer).toBeUndefined();
  });
});

/**
 * Ein Supersatz aus einer beidseitigen und einer einseitigen Übung - damit
 * beide Fälle des mehrspurigen Pausenmanagements an einer Session hängen.
 */
async function restTimers(sessionId = 'session-rest') {
  return (await db.workoutSessions.get(sessionId))?.restTimers ?? [];
}

describe('Pausentimer', () => {
  it('nimmt die Pausenzeit der Übung, wenn keine angegeben ist', async () => {
    await seedRestSession();

    await startRestTimerForSetLog('a-1');

    const tracks = await restTimers();
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      sessionExerciseId: 'exercise-a',
      side: 'both',
      durationSeconds: 120,
    });
    expect(tracks[0].endsAt).toBeGreaterThan(Date.now());
  });

  it('lässt zwei Übungen eines Supersatzes gleichzeitig pausieren', async () => {
    await seedRestSession();

    await startRestTimerForSetLog('a-1');
    await startRestTimerForSetLog('c-1', 60);

    expect((await restTimers()).map((track) => track.sessionExerciseId).sort()).toEqual([
      'exercise-a',
      'exercise-c',
    ]);
  });

  it('führt links und rechts derselben Übung getrennt', async () => {
    await seedRestSession();

    await startRestTimerForSetLog('b-1-right', 90);
    await startRestTimerForSetLog('b-1-left', 30);

    const tracks = await restTimers();
    expect(tracks).toHaveLength(2);
    expect(tracks.find((track) => track.side === 'right')?.durationSeconds).toBe(90);
    expect(tracks.find((track) => track.side === 'left')?.durationSeconds).toBe(30);
  });

  it('ersetzt die eigene Spur beim nächsten Satz derselben Seite', async () => {
    await seedRestSession();

    await startRestTimerForSetLog('b-1-right', 30);
    await startRestTimerForSetLog('b-2-right', 90);

    const tracks = await restTimers();
    expect(tracks).toHaveLength(1);
    expect(tracks[0].durationSeconds).toBe(90);
  });

  it('startet keine Pause in einer abgeschlossenen Session', async () => {
    await seedRestSession('completed');

    await startRestTimerForSetLog('a-1');
    await startRestTimerForExercise('session-rest', 'exercise-a', 'both', 60);

    expect(await restTimers()).toHaveLength(0);
  });

  it('verlängert genau eine Spur', async () => {
    await seedRestSession();
    await startRestTimerForSetLog('a-1', 60);
    await startRestTimerForSetLog('c-1', 60);

    await extendRestTimer('session-rest', 'exercise-a', 'both', 30);

    const tracks = await restTimers();
    expect(tracks.find((track) => track.sessionExerciseId === 'exercise-a')?.durationSeconds).toBe(90);
    expect(tracks.find((track) => track.sessionExerciseId === 'exercise-c')?.durationSeconds).toBe(60);
  });

  it('verkürzt eine Spur um einen negativen Betrag', async () => {
    await seedRestSession();
    await startRestTimerForSetLog('a-1', 60);

    const before = (await restTimers())[0].endsAt;

    await extendRestTimer('session-rest', 'exercise-a', 'both', -15);

    const track = (await restTimers())[0];
    expect(track.durationSeconds).toBe(45);
    expect(track.endsAt).toBeLessThanOrEqual(before - 15000);
  });

  it('kürzt eine Pause nicht über den Nullpunkt hinaus', async () => {
    await seedRestSession();
    await startRestTimerForSetLog('a-1', 10);

    const before = (await restTimers())[0];

    // Sonst meldete die Spur im selben Moment einen Ablauf, den niemand
    // abgewartet hat - samt Ton und Vibration.
    await extendRestTimer('session-rest', 'exercise-a', 'both', -15);

    expect((await restTimers())[0]).toEqual(before);
  });

  it('bricht wahlweise eine Spur, eine Übung oder alles ab', async () => {
    await seedRestSession();
    await startRestTimerForSetLog('b-1-left', 60);
    await startRestTimerForSetLog('b-1-right', 60);
    await startRestTimerForSetLog('a-1', 60);

    await clearRestTimer('session-rest', 'exercise-b', 'left');
    expect(await restTimers()).toHaveLength(2);

    await clearRestTimer('session-rest', 'exercise-b');
    expect((await restTimers()).map((track) => track.sessionExerciseId)).toEqual(['exercise-a']);

    await clearRestTimer('session-rest');
    expect(await restTimers()).toHaveLength(0);
  });

  it('rührt eine abgeschlossene Session beim Abbrechen nicht an', async () => {
    await seedRestSession();
    await startRestTimerForSetLog('a-1', 60);
    await completeSession('session-rest');
    await db.workoutSessions.update('session-rest', {
      restTimers: [
        { sessionExerciseId: 'exercise-a', side: 'both', endsAt: Date.now() + 60_000, durationSeconds: 60 },
      ],
    });

    await clearRestTimer('session-rest');

    expect(await restTimers()).toHaveLength(1);
  });

  it('räumt lange abgelaufene Spuren weg und lässt frische stehen', async () => {
    await seedRestSession();
    const now = Date.now();
    await db.workoutSessions.update('session-rest', {
      restTimers: [
        { sessionExerciseId: 'exercise-a', side: 'both', endsAt: now - 5_000, durationSeconds: 60 },
        {
          sessionExerciseId: 'exercise-c',
          side: 'both',
          endsAt: now - (REST_TRACK_GRACE_SECONDS + 60) * 1000,
          durationSeconds: 60,
        },
      ],
    });

    await pruneRestTimers('session-rest', now);

    expect((await restTimers()).map((track) => track.sessionExerciseId)).toEqual(['exercise-a']);
  });

  it('entfernt die Spur, wenn die letzte Satzzeile dieser Seite verschwindet', async () => {
    await seedRestSession();
    await startRestTimerForSetLog('b-1-right', 60);
    await startRestTimerForSetLog('b-1-left', 60);

    await deleteSetLog('b-1-right');
    // Rechts hat noch Satz 2 - die Pause bleibt gültig.
    expect(await restTimers()).toHaveLength(2);

    await deleteSetLog('b-2-right');
    expect((await restTimers()).map((track) => track.side)).toEqual(['left']);
  });

  it('räumt die Spuren einer übersprungenen Übung ab', async () => {
    await seedRestSession();
    await startRestTimerForSetLog('b-1-left', 60);
    await startRestTimerForSetLog('a-1', 60);

    await toggleSkipSessionExercise('exercise-b');

    expect((await restTimers()).map((track) => track.sessionExerciseId)).toEqual(['exercise-a']);
  });

  it('räumt alle Spuren beim Abschließen der Session ab', async () => {
    await seedRestSession();
    await startRestTimerForSetLog('a-1', 60);
    await startRestTimerForSetLog('c-1', 60);

    await completeSession('session-rest');

    expect((await db.workoutSessions.get('session-rest'))?.restTimers).toBeUndefined();
  });
});
