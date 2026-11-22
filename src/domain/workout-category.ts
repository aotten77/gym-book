/**
 * Die Art eines Workouts: Kraft, Mobility, Yoga oder Faszien.
 *
 * Sie trennt nur die Wochenrechnung (Kraftvolumen gegen Einheiten) und
 * bestimmt Icon und Filter; die Materialisierung und alles andere im Training
 * kennt sie nicht. Mobility, Yoga und Faszien zählen in der Wochenrechnung
 * gleich: als Einheiten mit Dauer, nie als Kraftvolumen.
 *
 * Additiv wie `tracksHeight`: ein fehlendes Feld heißt Kraft, und Kraft wird
 * nie geschrieben - "Kraft" hat genau eine Schreibweise, nämlich keine.
 */
export const WORKOUT_CATEGORIES = ['strength', 'mobility', 'yoga', 'faszien'] as const;

export type WorkoutCategory = (typeof WORKOUT_CATEGORIES)[number];

/** Die Arten, die tatsächlich gespeichert werden - alles außer Kraft. */
export type StoredWorkoutCategory = Exclude<WorkoutCategory, 'strength'>;

const CATEGORY_LABELS: Record<WorkoutCategory, 'Kraft' | 'Mobility' | 'Yoga' | 'Faszien'> = {
  strength: 'Kraft',
  mobility: 'Mobility',
  yoga: 'Yoga',
  faszien: 'Faszien',
};

export function normalizeWorkoutCategory(value?: WorkoutCategory | null): StoredWorkoutCategory | undefined {
  return value === 'mobility' || value === 'yoga' || value === 'faszien' ? value : undefined;
}

export function resolveWorkoutCategory(value?: WorkoutCategory): WorkoutCategory {
  return normalizeWorkoutCategory(value) ?? 'strength';
}

export function describeWorkoutCategory(value?: WorkoutCategory): 'Kraft' | 'Mobility' | 'Yoga' | 'Faszien' {
  return CATEGORY_LABELS[resolveWorkoutCategory(value)];
}
