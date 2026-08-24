import { describe, expect, it } from 'vitest';
import type { SetValues } from '@/domain/history';
import type { WorkoutSetLog } from '@/domain/models';
import {
  SET_LOG_FIELDS,
  adoptPlaceholders,
  collectSetLogChanges,
  createSetLogDraft,
  findInvalidSetLogFields,
  type SetLogDraft,
} from '@/domain/set-log-draft';

function setLog(values: Partial<WorkoutSetLog> = {}): WorkoutSetLog {
  return {
    id: 'set-log-1',
    sessionExerciseId: 'session-exercise-1',
    setKind: 'work',
    side: 'both',
    setNumber: 1,
    completed: false,
    ...values,
  };
}

function draft(values: Partial<SetLogDraft> = {}): SetLogDraft {
  return { reps: '', seconds: '', weight: '', heightCm: '', bandId: '', ...values };
}

describe('createSetLogDraft', () => {
  it('schreibt gespeicherte Zahlen mit Dezimalkomma ins Feld', () => {
    expect(createSetLogDraft(setLog({ reps: 5, weight: 82.5, heightCm: 25 }))).toEqual({
      reps: '5',
      seconds: '',
      weight: '82,5',
      heightCm: '25',
      bandId: '',
    });
  });

  it('macht aus „kein Band" einen Leerstring, nie ein `undefined`', () => {
    // Im Draft gibt es kein `undefined` - sonst würde React das Feld von
    // kontrolliert auf unkontrolliert umschalten.
    expect(createSetLogDraft(setLog()).bandId).toBe('');
    expect(createSetLogDraft(setLog({ bandId: 'band-gelb' })).bandId).toBe('band-gelb');
  });
});

describe('collectSetLogChanges', () => {
  it('überspringt ein ungültiges Feld, statt es als `undefined` zu schicken', () => {
    /*
     * Der teuerste Fall der ganzen Datei: Dexies `Table.update` löscht jede
     * Property, deren Wert `undefined` ist. Käme eine Fehleingabe als
     * `undefined` an, wäre der gespeicherte Wert weg - und zwar der, den der
     * Nutzer gerade zu korrigieren versucht.
     */
    const changes = collectSetLogChanges(
      draft({ reps: 'abc', weight: '85' }),
      setLog({ reps: 5, weight: 82.5 }),
      'reps_weight',
    );

    expect(changes).toEqual({ weight: 85 });
    expect(changes && 'reps' in changes).toBe(false);
  });

  it('schickt ein bewusst geleertes Feld als `undefined`', () => {
    // Der Gegenfall: leer ist eine Aussage, ungültig ist keine.
    const changes = collectSetLogChanges(
      draft({ reps: '', weight: '82,5' }),
      setLog({ reps: 5, weight: 82.5 }),
      'reps_weight',
    );

    expect(changes && 'reps' in changes).toBe(true);
    expect(changes?.reps).toBeUndefined();
  });

  it('nimmt das deutsche Komma an und gibt eine echte Zahl zurück', () => {
    expect(collectSetLogChanges(draft({ weight: '82,5' }), setLog(), 'reps_weight')).toEqual({
      weight: 82.5,
    });

    // Und die Rückrichtung: was gespeichert ist, steht wieder mit Komma im
    // Feld und gilt dann als unverändert.
    const stored = setLog({ weight: 82.5 });
    expect(collectSetLogChanges(createSetLogDraft(stored), stored, 'reps_weight')).toBeNull();
  });

  it('meldet nichts, wenn sich nichts geändert hat', () => {
    const log = setLog({ reps: 5, weight: 82.5 });
    expect(collectSetLogChanges(createSetLogDraft(log), log, 'reps_weight')).toBeNull();
  });

  it('fasst nur Felder an, die die Übung überhaupt trägt', () => {
    // Eine reine Zeitübung hat kein Gewicht - was im Draft steht, geht sie
    // nichts an, sonst schriebe ein Moduswechsel stumm Werte fort.
    expect(
      collectSetLogChanges(draft({ seconds: '45', weight: '20', reps: '8' }), setLog(), 'time'),
    ).toEqual({ seconds: 45 });
  });

  it('behandelt die Höhe unabhängig vom Tracking-Modus', () => {
    // Die Höhe hängt allein am Schalter der Übung: sie steht neben Kilo, nicht
    // an dessen Stelle.
    expect(
      collectSetLogChanges(draft({ seconds: '45', heightCm: '25' }), setLog(), 'time', undefined, true),
    ).toEqual({ seconds: 45, heightCm: 25 });

    expect(
      collectSetLogChanges(draft({ seconds: '45', heightCm: '25' }), setLog(), 'time', undefined, false),
    ).toEqual({ seconds: 45 });
  });

  it('schickt das Band nur bei einer Bandübung und leert es über `undefined`', () => {
    expect(
      collectSetLogChanges(draft({ reps: '15', bandId: 'band-gelb' }), setLog(), 'reps_weight', 'band'),
    ).toEqual({ reps: 15, bandId: 'band-gelb' });

    // Ohne `loadKind: 'band'` zählt die Übung als Kilo-Übung - das Band im
    // Draft ist dann keine Eingabe.
    expect(
      collectSetLogChanges(draft({ reps: '15', bandId: 'band-gelb' }), setLog(), 'reps_weight'),
    ).toEqual({ reps: 15 });

    const cleared = collectSetLogChanges(
      draft({ bandId: '' }),
      setLog({ bandId: 'band-gelb' }),
      'reps_weight',
      'band',
    );
    expect(cleared && 'bandId' in cleared).toBe(true);
    expect(cleared?.bandId).toBeUndefined();
  });
});

describe('findInvalidSetLogFields', () => {
  it('nennt nur ungültige Felder, die die Übung auch trägt', () => {
    expect(findInvalidSetLogFields(draft({ reps: 'abc', weight: '-5' }), 'reps_weight')).toEqual([
      'reps',
      'weight',
    ]);

    // Dieselbe Fehleingabe an einer Zeitübung: das Feld ist gar nicht sichtbar,
    // also darf es den Speichern-Knopf auch nicht sperren.
    expect(findInvalidSetLogFields(draft({ reps: 'abc' }), 'time')).toEqual([]);
  });

  it('zählt ein leeres Feld nicht als ungültig', () => {
    expect(findInvalidSetLogFields(draft(), 'reps_weight')).toEqual([]);
  });
});

describe('adoptPlaceholders', () => {
  const lastValues: SetValues = {
    reps: 5,
    seconds: 30,
    weight: 82.5,
    heightCm: 25,
    bandId: 'band-gelb',
  };

  it('füllt nur leere Felder und lässt Eingetipptes stehen', () => {
    // "Genau wie letzte Woche" soll ein Tap sein - aber was der Nutzer selbst
    // eingetragen hat, gewinnt gegen den Platzhalter.
    expect(adoptPlaceholders(draft({ weight: '85' }), lastValues, 'reps_weight')).toMatchObject({
      reps: '5',
      weight: '85',
    });
  });

  it('füllt keine Felder, die die Übung nicht trägt', () => {
    const next = adoptPlaceholders(draft(), lastValues, 'reps_weight');

    expect(next.reps).toBe('5');
    expect(next.weight).toBe('82,5');
    // Sekunden und Höhe trägt diese Übung nicht - ein übernommener Wert wäre
    // eine Zahl, die niemand eingegeben hat und die niemand sieht.
    expect(next.seconds).toBe('');
    expect(next.heightCm).toBe('');
  });

  it('übernimmt die Höhe, sobald die Übung sie mitschreibt', () => {
    expect(adoptPlaceholders(draft(), lastValues, 'time', undefined, true)).toMatchObject({
      seconds: '30',
      heightCm: '25',
    });
  });

  it('übernimmt auch das Band, aber nur bei einer Bandübung', () => {
    // Sonst wäre das Band das einzige Feld, das man bei "wie letztes Mal" doch
    // antippen müsste.
    expect(adoptPlaceholders(draft(), lastValues, 'reps_weight', 'band').bandId).toBe('band-gelb');
    expect(adoptPlaceholders(draft(), lastValues, 'reps_weight').bandId).toBe('');
  });

  it('schreibt das Komma so, wie das Feld es zurückliest', () => {
    const adopted = adoptPlaceholders(draft(), lastValues, 'reps_weight');

    expect(adopted.weight).toBe('82,5');
    expect(collectSetLogChanges(adopted, setLog(), 'reps_weight')).toMatchObject({ weight: 82.5 });
  });

  it('lässt den Draft in Ruhe, wenn es nichts zu übernehmen gibt', () => {
    const empty = draft();
    expect(adoptPlaceholders(empty, {}, 'reps_weight')).toEqual(empty);
  });
});

describe('SET_LOG_FIELDS', () => {
  it('ist die Tabelle der Prädikate aus `tracking.ts`, in Anzeigereihenfolge', () => {
    expect(SET_LOG_FIELDS.map(({ key }) => key)).toEqual(['reps', 'seconds', 'weight', 'heightCm']);
  });

  it('lässt eine Bandübung kein Kilofeld tragen', () => {
    // Der zweiargumentige Aufruf muss bis hierher durchgereicht sein - sonst
    // zeigt die Bandübung stumm ein Kilofeld.
    const supported = (loadKind?: 'weight' | 'band') =>
      SET_LOG_FIELDS.filter(({ supported: fn }) => fn('reps_weight', loadKind)).map(
        ({ key }) => key,
      );

    expect(supported('weight')).toEqual(['reps', 'weight']);
    expect(supported('band')).toEqual(['reps']);
    expect(supported(undefined)).toEqual(['reps', 'weight']);
  });
});
