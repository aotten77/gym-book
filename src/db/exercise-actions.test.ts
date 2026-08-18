import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import {
  createExercise,
  deleteExercise,
  getExerciseUsage,
  updateExercise,
} from '@/db/exercise-actions';
import { createExerciseTest, deleteExerciseTest } from '@/db/test-actions';

async function seedExercise(name = 'Front Squat') {
  return createExercise({
    name,
    instructions: 'Ellbogen hoch',
    tempo: '3-1-1',
    trackingMode: 'reps_weight',
    unilateral: false,
  });
}

describe('exercise actions', () => {
  it('speichert den Höhen-Schalter nur, wenn er an ist', async () => {
    const id = await createExercise({
      name: 'Step-Down',
      trackingMode: 'reps_weight',
      tracksHeight: true,
      unilateral: true,
    });

    expect((await db.exercises.get(id))?.tracksHeight).toBe(true);

    await updateExercise(id, {
      name: 'Step-Down',
      trackingMode: 'reps_weight',
      tracksHeight: false,
      unilateral: true,
    });

    // Kein `false` in der Datenbank: der fehlende Schlüssel ist der Aus-Zustand,
    // sonst hätte dasselbe zwei Schreibweisen.
    expect((await db.exercises.get(id))?.tracksHeight).toBeUndefined();
  });

  it('creates and updates the master data of an exercise', async () => {
    const id = await seedExercise();

    await updateExercise(id, {
      name: 'Front Squat (Pause)',
      instructions: 'Zwei Sekunden halten',
      tempo: '3-2-1',
      trackingMode: 'time_weight',
      unilateral: true,
    });

    expect(await db.exercises.get(id)).toMatchObject({
      name: 'Front Squat (Pause)',
      tempo: '3-2-1',
      trackingMode: 'time_weight',
      unilateral: true,
    });
  });

  it('stores an exercise together with its image', async () => {
    const id = await createExercise(
      { name: 'Pallof Press', trackingMode: 'reps_weight', unilateral: true },
      { file: new Blob(['bild'], { type: 'image/png' }), fileName: 'pallof.png', mimeType: 'image/png' },
    );

    const exercise = await db.exercises.get(id);

    expect(exercise?.mediaAssetId).toBeDefined();
    expect(await db.mediaAssets.get(exercise!.mediaAssetId!)).toMatchObject({
      fileName: 'pallof.png',
      mimeType: 'image/png',
    });
  });

  it('creates neither exercise nor asset when the image type is unsupported', async () => {
    await expect(
      createExercise(
        { name: 'Farmers Walk', trackingMode: 'time', unilateral: false },
        { file: new Blob(['x'], { type: 'image/svg+xml' }), fileName: 'walk.svg', mimeType: 'image/svg+xml' },
      ),
    ).rejects.toThrow(/JPG/);

    expect(await db.exercises.where('name').equals('Farmers Walk').count()).toBe(0);
    expect(await db.mediaAssets.count()).toBe(0);
  });

  it('rejects a blank name', async () => {
    await expect(
      createExercise({ name: '   ', trackingMode: 'reps_weight', unilateral: false }),
    ).rejects.toThrow(/Namen/);
  });

  it('refuses to delete an exercise that a template still uses', async () => {
    const exerciseId = await seedExercise();

    await db.workoutTemplates.add({
      id: 'template-1',
      name: 'Einheit A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.workoutTemplateExercises.add({
      id: 'template-exercise-1',
      templateId: 'template-1',
      exerciseId,
      orderIndex: 1,
      workSetCount: 3,
    });

    const usage = await getExerciseUsage(exerciseId);
    expect(usage.canDelete).toBe(false);
    expect(usage.templateNames).toEqual(['Einheit A']);

    await expect(deleteExercise(exerciseId)).rejects.toThrow(/Vorlage/);
    expect(await db.exercises.get(exerciseId)).toBeDefined();
  });

  it('deletes an unused exercise and cleans up its orphaned media', async () => {
    const exerciseId = await seedExercise('Nordic Curl');

    await db.mediaAssets.add({
      id: 'asset-1',
      mimeType: 'image/png',
      fileName: 'curl.png',
      byteSize: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await db.exercises.update(exerciseId, { mediaAssetId: 'asset-1' });

    await deleteExercise(exerciseId);

    expect(await db.exercises.get(exerciseId)).toBeUndefined();
    expect(await db.mediaAssets.get('asset-1')).toBeUndefined();
  });

  it('keeps history intact when the exercise is deleted', async () => {
    const exerciseId = await seedExercise('Hip Thrust');

    await db.workoutSessionExercises.add({
      id: 'session-exercise-1',
      sessionId: 'session-1',
      exerciseId,
      exerciseNameSnapshot: 'Hip Thrust',
      trackingMode: 'reps_weight',
      unilateral: false,
      orderIndex: 1,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: 3,
    });

    await deleteExercise(exerciseId);

    // Der Snapshot trägt den Namen - die Historie bleibt lesbar.
    expect(await db.workoutSessionExercises.get('session-exercise-1')).toMatchObject({
      exerciseNameSnapshot: 'Hip Thrust',
    });
  });
});

describe('exercise test actions', () => {
  it('stores left/right values with the calculated asymmetry', async () => {
    const exerciseId = await seedExercise('Split Squat');

    const testId = await createExerciseTest({
      exerciseId,
      leftValue: 22,
      rightValue: 24,
      notes: '  Nach dem Aufwärmen  ',
    });

    expect(await db.exerciseTests.get(testId)).toMatchObject({
      exerciseNameSnapshot: 'Split Squat',
      leftValue: 22,
      rightValue: 24,
      asymmetryPercent: 8.3,
      notes: 'Nach dem Aufwärmen',
    });
  });

  it('rejects negative values and unknown exercises', async () => {
    const exerciseId = await seedExercise('Calf Raise');

    await expect(
      createExerciseTest({ exerciseId, leftValue: -1, rightValue: 10 }),
    ).rejects.toThrow(/links/);

    await expect(
      createExerciseTest({ exerciseId: 'does-not-exist', leftValue: 10, rightValue: 10 }),
    ).rejects.toThrow(/nicht gefunden/);
  });

  it('deletes a test', async () => {
    const exerciseId = await seedExercise('Nordic');
    const testId = await createExerciseTest({ exerciseId, leftValue: 10, rightValue: 10 });

    await deleteExerciseTest(testId);

    expect(await db.exerciseTests.get(testId)).toBeUndefined();
  });
});
