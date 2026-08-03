/**
 * Welches Workout als Nächstes ansteht.
 *
 * Es gibt keinen Ablaufplan, aus dem sich das ablesen ließe: `WorkoutTemplate`
 * kennt kein Programm, und ein `ProgramWeek` kennt keine Templates - ein
 * Programm ist heute ein Progressions-Overlay, keine Reihenfolge. Statt dafür
 * eine Tabelle zu erfinden, entscheidet eine Heuristik, die man erklären kann
 * und die deshalb auch so beschriftet wird ("Am längsten her"):
 *
 * 1. Nie trainierte Workouts zuerst - was noch nie dran war, ist am längsten
 *    überfällig.
 * 2. Sonst das mit dem ältesten Abschluss.
 * 3. Bei Gleichstand nach Namen, damit die Auswahl bei jedem Aufruf und in
 *    jedem Test dieselbe ist.
 */
export function pickNextTemplate<T extends { id: string; name: string }>(
  templates: T[],
  lastCompletedByTemplateId: Record<string, string>,
): T | undefined {
  if (templates.length === 0) {
    return undefined;
  }

  return [...templates].sort((left, right) => {
    const leftCompletedAt = lastCompletedByTemplateId[left.id];
    const rightCompletedAt = lastCompletedByTemplateId[right.id];

    if (leftCompletedAt && !rightCompletedAt) {
      return 1;
    }

    if (!leftCompletedAt && rightCompletedAt) {
      return -1;
    }

    if (leftCompletedAt && rightCompletedAt && leftCompletedAt !== rightCompletedAt) {
      return leftCompletedAt.localeCompare(rightCompletedAt);
    }

    return left.name.localeCompare(right.name, 'de');
  })[0];
}
