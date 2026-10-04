/**
 * Die Wochenrechnung: was in einer Kalenderwoche trainiert wurde, getrennt
 * nach Kraft, Mobility und Laufen.
 *
 * Eine Rechnung, drei Leser. Der Verlauf, die Startseite und die Spalte in
 * `wochen.csv` des Analyse-Exports lesen alle dieselben `WeekVolume`-Zeilen;
 * rechnete jeder für sich, stünden auf drei Bildschirmen drei Wochen.
 *
 * Was als Einheit zählt: `status === 'completed'`, ein `completedAt` und
 * mindestens eine abgehakte Arbeitssatz-Zeile. Eine abgebrochene Einheit
 * zählt nicht - `closeSession` stempelt `completedAt` auch auf sie, und
 * "abgebrochen" heißt in dieser App überall "nicht trainiert". Eine Einheit
 * ohne einen einzigen abgehakten Satz ist gestartet und liegengeblieben. Die
 * Woche richtet sich nach dem lokalen `completedAt`.
 *
 * Das Kraftvolumen zählt nur Übungen, deren Modus Wiederholungen kennt
 * (`supportsReps`) - wie die Spalte `volumen` in `sessions.csv`. Kilo mal
 * Sekunden ist kein Kilogramm Bewegung; einen Haltesatz mit 20 kg dazuzuzählen
 * würde die Summe verfälschen. Mobility trägt nur Einheiten und Dauer bei.
 *
 * Wochen werden über `setDate(+7)` weitergezählt, nie über Millisekunden: eine
 * Woche über die Zeitumstellung hat 167 oder 169 Stunden.
 */
import { parseLocalDate, startOfCalendarWeek } from '@/domain/calendar-week';
import type { RunLog, WorkoutSession, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { supportsReps } from '@/domain/tracking';
import { sumWorkVolume } from '@/domain/volume';
import { resolveWorkoutCategory } from '@/domain/workout-category';
import { formatDurationHours, formatNumber } from '@/lib/format';

export interface WeekVolume {
  /** Montag 00:00 Ortszeit. */
  weekStart: Date;
  strength: { sessions: number; durationSeconds: number; volumeKg: number; workSets: number };
  mobility: { sessions: number; durationSeconds: number };
  running: {
    runs: number;
    distanceKm: number;
    elevationGainM: number;
    /** Mindestens ein Lauf der Woche hat keine Höhenmeter - die Summe ist ein Mindestwert. */
    elevationIncomplete: boolean;
    durationSeconds: number;
  };
}

export interface WeeklyVolumeInput {
  sessions: WorkoutSession[];
  sessionExercises: WorkoutSessionExercise[];
  setLogs: WorkoutSetLog[];
  runs: RunLog[];
  from: Date;
  to: Date;
}

function emptyWeek(weekStart: Date): WeekVolume {
  return {
    weekStart,
    strength: { sessions: 0, durationSeconds: 0, volumeKg: 0, workSets: 0 },
    mobility: { sessions: 0, durationSeconds: 0 },
    running: { runs: 0, distanceKm: 0, elevationGainM: 0, elevationIncomplete: false, durationSeconds: 0 },
  };
}

export function buildWeeklyVolume(input: WeeklyVolumeInput): WeekVolume[] {
  const first = startOfCalendarWeek(input.from);
  const last = startOfCalendarWeek(input.to);
  const weeks: WeekVolume[] = [];

  for (const cursor = new Date(first); cursor.getTime() <= last.getTime(); cursor.setDate(cursor.getDate() + 7)) {
    weeks.push(emptyWeek(new Date(cursor)));
  }

  const weekByStart = new Map(weeks.map((week) => [week.weekStart.getTime(), week]));
  const weekOf = (date: Date) => weekByStart.get(startOfCalendarWeek(date).getTime());

  const exercisesBySession = new Map<string, WorkoutSessionExercise[]>();

  for (const exercise of input.sessionExercises) {
    const bucket = exercisesBySession.get(exercise.sessionId);

    if (bucket) {
      bucket.push(exercise);
    } else {
      exercisesBySession.set(exercise.sessionId, [exercise]);
    }
  }

  const logsByExercise = new Map<string, WorkoutSetLog[]>();

  for (const log of input.setLogs) {
    if (log.setKind !== 'work' || !log.completed) {
      continue;
    }

    const bucket = logsByExercise.get(log.sessionExerciseId);

    if (bucket) {
      bucket.push(log);
    } else {
      logsByExercise.set(log.sessionExerciseId, [log]);
    }
  }

  for (const session of input.sessions) {
    if (session.status !== 'completed' || !session.completedAt) {
      continue;
    }

    const exercises = exercisesBySession.get(session.id) ?? [];
    const hasCompletedWorkSet = exercises.some((exercise) => (logsByExercise.get(exercise.id)?.length ?? 0) > 0);

    if (!hasCompletedWorkSet) {
      continue;
    }

    const completedAt = new Date(session.completedAt);
    const week = weekOf(completedAt);

    if (!week) {
      continue;
    }

    const durationSeconds = Math.max(
      0,
      Math.round((completedAt.getTime() - new Date(session.startedAt).getTime()) / 1000),
    );

    if (resolveWorkoutCategory(session.templateCategorySnapshot) === 'mobility') {
      week.mobility.sessions += 1;
      week.mobility.durationSeconds += durationSeconds;
      continue;
    }

    week.strength.sessions += 1;
    week.strength.durationSeconds += durationSeconds;

    for (const exercise of exercises) {
      const logs = logsByExercise.get(exercise.id) ?? [];

      week.strength.workSets += logs.length;

      if (supportsReps(exercise.trackingMode)) {
        week.strength.volumeKg += sumWorkVolume(logs);
      }
    }
  }

  for (const run of input.runs) {
    const date = parseLocalDate(run.date);
    const week = date ? weekOf(date) : undefined;

    if (!week) {
      continue;
    }

    week.running.runs += 1;
    week.running.distanceKm += run.distanceKm;
    week.running.durationSeconds += run.durationSeconds;

    if (typeof run.elevationGainM === 'number') {
      week.running.elevationGainM += run.elevationGainM;
    } else {
      week.running.elevationIncomplete = true;
    }
  }

  return weeks;
}

export function hasTraining(week: WeekVolume): boolean {
  return week.strength.sessions > 0 || week.mobility.sessions > 0 || week.running.runs > 0;
}

function unitCount(count: number, singular: string, plural: string) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

export function describeWeekVolume(week: WeekVolume): { strength?: string; mobility?: string; running?: string } {
  const result: { strength?: string; mobility?: string; running?: string } = {};
  const { strength, mobility, running } = week;

  if (strength.sessions > 0) {
    result.strength = [
      unitCount(strength.sessions, 'Einheit', 'Einheiten'),
      formatDurationHours(strength.durationSeconds),
      `${formatNumber(Math.round(strength.volumeKg))} kg`,
      unitCount(strength.workSets, 'Satz', 'Sätze'),
    ].join(' · ');
  }

  if (mobility.sessions > 0) {
    result.mobility = [
      unitCount(mobility.sessions, 'Einheit', 'Einheiten'),
      formatDurationHours(mobility.durationSeconds),
    ].join(' · ');
  }

  if (running.runs > 0) {
    const parts = [unitCount(running.runs, 'Lauf', 'Läufe'), `${formatNumber(running.distanceKm)} km`];

    // Ohne erfasste Höhenmeter gibt es nichts zu zeigen; "≥ 0 HM" wäre Lärm.
    if (running.elevationGainM > 0) {
      parts.push(`${running.elevationIncomplete ? '≥ ' : ''}${formatNumber(running.elevationGainM)} HM`);
    }

    parts.push(formatDurationHours(running.durationSeconds));
    result.running = parts.join(' · ');
  }

  return result;
}

export function describeWeekCounts(week: WeekVolume): string {
  const parts: string[] = [];

  if (week.strength.sessions > 0) {
    parts.push(`${week.strength.sessions} Kraft`);
  }

  if (week.mobility.sessions > 0) {
    parts.push(`${week.mobility.sessions} Mobility`);
  }

  if (week.running.runs > 0) {
    parts.push(unitCount(week.running.runs, 'Lauf', 'Läufe'));
  }

  return parts.join(' · ');
}
