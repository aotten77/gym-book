import { calculateAsymmetryPercent, materializeSession } from '@/domain/session';
import type {
  AppSettings,
  Exercise,
  Program,
  ProgramWeek,
  ProgressionRule,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/domain/models';
import { db } from '@/db/appDb';
import { createId } from '@/lib/id';

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function currentProgramWeek() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const day = Math.floor((now.getTime() - start.getTime()) / 86400000);

  return Math.max(1, Math.min(8, Math.ceil((day + start.getDay() + 1) / 7)));
}

/**
 * Legt beim allerersten Start nur die Einstellungszeile an.
 *
 * Früher schrieb der Bootstrap ein komplettes Demo-Programm inklusive einer
 * fertig ausgefüllten Session von "vor sechs Tagen" und eines erfundenen
 * Asymmetrie-Tests. Für einen echten Nutzer bedeutete das: die Historie zeigt
 * ein Training, das nie stattfand, und "Letzte Werte" schlägt Gewichte für
 * Übungen vor, die er nie gemacht hat. Beispieldaten gibt es jetzt nur noch
 * auf ausdrücklichen Wunsch über die Einstellungen.
 */
export async function bootstrapAppData() {
  // Der Guard läuft außerhalb der Transaktion: sonst wurden bei jedem
  // App-Start alle zwölf Tabellen schreibend gesperrt, nur um sofort wieder
  // auszusteigen.
  const existingSettings = await db.appSettings.get('app-settings');

  if (existingSettings) {
    return;
  }

  await db.transaction('rw', db.appSettings, async () => {
    if (await db.appSettings.get('app-settings')) {
      return;
    }

    await db.appSettings.add({
      id: 'app-settings',
      exportSchemaVersion: 1,
      updatedAt: new Date().toISOString(),
    });
  });
}

/**
 * Legt ein durchgespieltes Beispielprogramm an - ausdrücklich angefordert
 * über die Einstellungen, nicht beim ersten Start.
 */
export async function seedSampleData() {
  await db.transaction('rw', db.tables, async () => {
    const existingExerciseCount = await db.exercises.count();

    if (existingExerciseCount > 0) {
      throw new Error('Beispieldaten lassen sich nur in eine leere Bibliothek laden.');
    }

    const now = new Date().toISOString();
    const activeWeek = currentProgramWeek();
    const programId = createId();
    const templateId = createId();
    const frontSquatId = createId();
    const splitSquatId = createId();
    const nordicId = createId();
    const nordicTemplateExerciseId = createId();

    const program: Program = {
      id: programId,
      name: 'Unterkörper Aufbau',
      activeWeek,
      createdAt: now,
      updatedAt: now,
    };

    const settings: AppSettings = {
      id: 'app-settings',
      activeProgramId: programId,
      exportSchemaVersion: 1,
      updatedAt: now,
    };

    const weeks: ProgramWeek[] = Array.from({ length: 8 }, (_, index) => ({
      id: createId(),
      programId,
      weekNumber: index + 1,
      label: `Woche ${index + 1}`,
    }));

    const exercises: Exercise[] = [
      {
        id: frontSquatId,
        name: 'Front Squat',
        instructions: 'Ellbogen hoch halten, sauber tief, keine Grind-Reps.',
        tempo: '3-1-1',
        trackingMode: 'reps_weight',
        unilateral: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: splitSquatId,
        name: 'Bulgarian Split Squat',
        instructions: 'Saubere Balance, gleicher Satzumfang links und rechts.',
        tempo: '2-1-1',
        trackingMode: 'reps_weight',
        unilateral: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nordicId,
        name: 'Nordic Curl Iso',
        instructions: 'Exzentrik kontrollieren, Zusatzlast optional.',
        trackingMode: 'time_weight',
        unilateral: false,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const template: WorkoutTemplate = {
      id: templateId,
      name: 'Einheit A',
      notes:
        'Unterkörper Fokus mit unilateraler Assistenz und Posterior-Chain-Arbeit.',
      createdAt: now,
      updatedAt: now,
    };

    const templateExercises: WorkoutTemplateExercise[] = [
      {
        id: createId(),
        templateId,
        exerciseId: frontSquatId,
        orderIndex: 1,
        workSetCount: 3,
        targetReps: 5,
        targetWeight: 82.5,
        restSeconds: 150,
        notes: 'RPE 7-8',
      },
      {
        id: createId(),
        templateId,
        exerciseId: splitSquatId,
        orderIndex: 2,
        workSetCount: 2,
        targetReps: 8,
        targetWeight: 22.5,
        restSeconds: 90,
        notes: 'Links mit rechts matchen, keine Extra-Sätze.',
      },
      {
        id: nordicTemplateExerciseId,
        templateId,
        exerciseId: nordicId,
        orderIndex: 3,
        workSetCount: 3,
        targetSeconds: 18,
        targetWeight: 5,
        restSeconds: 75,
        notes: 'Iso-Hold in der schwersten kontrollierbaren Position.',
      },
    ];

    const progressionRules: ProgressionRule[] = weeks.map((week) => ({
      id: createId(),
      templateExerciseId: nordicTemplateExerciseId,
      programWeekId: week.id,
      targetSeconds: 8 + week.weekNumber * 2,
      targetWeight: week.weekNumber >= 5 ? 5 : undefined,
      notes: `Progressionsstufe Woche ${week.weekNumber}`,
    }));

    const exerciseLookup = Object.fromEntries(
      exercises.map((exercise) => [exercise.id, exercise]),
    );
    const completedBundle = materializeSession({
      template,
      templateExercises,
      exercisesById: exerciseLookup,
      resolvedProgramWeek: Math.max(1, activeWeek - 1),
      startedAt: isoDaysAgo(6),
    });

    completedBundle.session.status = 'completed';
    completedBundle.session.completedAt = isoDaysAgo(6);

    completedBundle.setLogs = completedBundle.setLogs.map((log) => {
      const sessionExercise = completedBundle.sessionExercises.find(
        (item) => item.id === log.sessionExerciseId,
      );

      if (!sessionExercise) {
        return log;
      }

      if (log.setKind === 'warmup') {
        return {
          ...log,
          completed: true,
          completedAt: isoDaysAgo(6),
          reps: sessionExercise.trackingMode === 'reps_weight' ? 8 : undefined,
          seconds: sessionExercise.trackingMode !== 'reps_weight' ? 10 : undefined,
          weight: sessionExercise.targetWeight
            ? sessionExercise.targetWeight * 0.5
            : undefined,
        };
      }

      if (sessionExercise.trackingMode === 'reps_weight') {
        const baseWeight = sessionExercise.targetWeight ?? 0;

        return {
          ...log,
          completed: true,
          completedAt: isoDaysAgo(6),
          reps: (sessionExercise.targetReps ?? 0) - (log.side === 'left' ? 0 : 1),
          weight: log.side === 'right' ? baseWeight + 1.25 : baseWeight,
        };
      }

      return {
        ...log,
        completed: true,
        completedAt: isoDaysAgo(6),
        seconds: (sessionExercise.targetSeconds ?? 0) - 2 + log.setNumber,
        weight: sessionExercise.targetWeight,
      };
    });

    await db.programs.add(program);
    await db.programWeeks.bulkAdd(weeks);
    await db.workoutTemplates.add(template);
    await db.exercises.bulkAdd(exercises);
    await db.workoutTemplateExercises.bulkAdd(templateExercises);
    await db.progressionRules.bulkAdd(progressionRules);
    await db.appSettings.put(settings);
    await db.workoutSessions.add(completedBundle.session);
    await db.workoutSessionExercises.bulkAdd(completedBundle.sessionExercises);
    await db.workoutSetLogs.bulkAdd(completedBundle.setLogs);
    await db.exerciseTests.bulkAdd([
      {
        id: createId(),
        exerciseId: splitSquatId,
        exerciseNameSnapshot: 'Bulgarian Split Squat',
        recordedAt: isoDaysAgo(2),
        leftValue: 22,
        rightValue: 24,
        asymmetryPercent: calculateAsymmetryPercent(22, 24),
        notes: 'Kleine Rest-Asymmetrie, aber innerhalb akzeptabler Range.',
      },
    ]);
  });
}
