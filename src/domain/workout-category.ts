/**
 * Die Art eines Workouts: Kraft oder Mobility.
 *
 * Sie trennt nur die Wochenrechnung (Kraftvolumen gegen Mobility-Einheiten);
 * die Materialisierung und alles andere im Training kennt sie nicht.
 *
 * Additiv wie `tracksHeight`: ein fehlendes Feld heißt Kraft, und Kraft wird
 * nie geschrieben - "Kraft" hat genau eine Schreibweise, nämlich keine.
 */
export type WorkoutCategory = 'strength' | 'mobility';

export function normalizeWorkoutCategory(value?: WorkoutCategory | null): 'mobility' | undefined {
  return value === 'mobility' ? 'mobility' : undefined;
}

export function resolveWorkoutCategory(value?: WorkoutCategory): WorkoutCategory {
  return value === 'mobility' ? 'mobility' : 'strength';
}

export function describeWorkoutCategory(value?: WorkoutCategory): 'Kraft' | 'Mobility' {
  return value === 'mobility' ? 'Mobility' : 'Kraft';
}
