import { db } from '@/db/appDb';
import { calculateAsymmetryPercent } from '@/domain/session';
import { createId } from '@/lib/id';

/*
 * Der v1-Vertrag listet "tests with left/right values and asymmetry" als
 * Must-have. Modell, Tabelle, `calculateAsymmetryPercent` und der Export waren
 * vorhanden - es fehlte jede Möglichkeit, einen Test zu erfassen: einziger
 * Schreiber im Produktivcode war der Seed.
 */

export interface ExerciseTestInput {
  exerciseId: string;
  leftValue: number;
  rightValue: number;
  notes?: string;
  recordedAt?: string;
}

function assertValue(value: number, side: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Bitte einen gültigen Wert für ${side} eintragen.`);
  }

  return value;
}

export async function createExerciseTest(input: ExerciseTestInput) {
  const left = assertValue(input.leftValue, 'links');
  const right = assertValue(input.rightValue, 'rechts');

  const exercise = await db.exercises.get(input.exerciseId);

  if (!exercise) {
    throw new Error('Übung nicht gefunden.');
  }

  const id = createId();
  const notes = input.notes?.trim();

  await db.exerciseTests.add({
    id,
    exerciseId: exercise.id,
    // Snapshot wie bei Sessions: der Test bleibt lesbar, auch wenn die Übung
    // später umbenannt oder gelöscht wird.
    exerciseNameSnapshot: exercise.name,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    leftValue: left,
    rightValue: right,
    asymmetryPercent: calculateAsymmetryPercent(left, right),
    notes: notes ? notes : undefined,
  });

  return id;
}

export async function deleteExerciseTest(testId: string) {
  await db.exerciseTests.delete(testId);
}

export async function loadTestsForExercise(exerciseId: string) {
  const tests = await db.exerciseTests.where('exerciseId').equals(exerciseId).toArray();
  return tests.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
}
