import { createId } from '@/lib/id';

/**
 * Das Minimum, das eine Übung mitbringen muss, um gruppiert zu werden.
 *
 * Bewusst strukturell statt konkret: Template- und Session-Übungen sind
 * verschiedene Typen mit derselben Sortier- und Gruppenmechanik, und diese
 * Regeln zweimal zu schreiben hieße, sie zweimal zu pflegen.
 */
export interface GroupableExercise {
  id: string;
  orderIndex: number;
  supersetGroupId?: string;
}

export type SupersetBlock<T extends GroupableExercise> =
  | { kind: 'single'; exercise: T }
  | { kind: 'group'; groupId: string; exercises: T[] };

/** Eine zu schreibende Zuordnung. `undefined` löst die Gruppe auf. */
export interface SupersetAssignment {
  id: string;
  supersetGroupId?: string;
}

/**
 * Der zusammenhängende Lauf gleicher Gruppenkennung um eine Position herum.
 *
 * Nur benachbarte Einträge zählen: eine Gruppe ist per Definition ein Block in
 * der Reihenfolge, und eine zerrissene Gruppe wäre ein Datenfehler, den diese
 * Funktion nicht stillschweigend zusammenziehen soll.
 */
function groupRunAt<T extends GroupableExercise>(items: T[], index: number) {
  const groupId = items[index]?.supersetGroupId;

  if (!groupId) {
    return { start: index, end: index };
  }

  let start = index;
  let end = index;

  while (start > 0 && items[start - 1].supersetGroupId === groupId) {
    start -= 1;
  }

  while (end < items.length - 1 && items[end + 1].supersetGroupId === groupId) {
    end += 1;
  }

  return { start, end };
}

/**
 * Fasst eine bereits sortierte Liste zu Blöcken zusammen.
 *
 * Ein einzeln stehendes Mitglied wird als `single` ausgegeben: eine Gruppe aus
 * einer Übung ist kein Supersatz, und die Darstellung soll auch dann tragen,
 * wenn ein Datensatz aus einer früheren App-Version übrig geblieben ist.
 */
export function buildSupersetBlocks<T extends GroupableExercise>(items: T[]): SupersetBlock<T>[] {
  const blocks: SupersetBlock<T>[] = [];
  let index = 0;

  while (index < items.length) {
    const item = items[index];
    const { end } = groupRunAt(items, index);
    const members = items.slice(index, end + 1);

    if (item.supersetGroupId && members.length > 1) {
      blocks.push({ kind: 'group', groupId: item.supersetGroupId, exercises: members });
    } else {
      for (const member of members) {
        blocks.push({ kind: 'single', exercise: member });
      }
    }

    index = end + 1;
  }

  return blocks;
}

/**
 * Verbindet eine Übung mit ihrer Vorgängerin zu einem Supersatz.
 *
 * Hat die Vorgängerin schon eine Gruppe, tritt die Übung ihr bei - sonst
 * entsteht eine neue aus beiden. Ist die Übung selbst Kopf einer Gruppe,
 * verschmelzen beide Gruppen: sie liegen nebeneinander, das Ergebnis bleibt
 * also zusammenhängend.
 *
 * `null` heißt "nichts zu tun" - die Liste bleibt dann unangetastet.
 */
export function planGroupWithPrevious<T extends GroupableExercise>(
  items: T[],
  id: string,
): SupersetAssignment[] | null {
  const index = items.findIndex((item) => item.id === id);

  // Die erste Übung hat keine Vorgängerin, an die sie andocken könnte.
  if (index <= 0) {
    return null;
  }

  const item = items[index];
  const previous = items[index - 1];

  if (item.supersetGroupId && item.supersetGroupId === previous.supersetGroupId) {
    return null;
  }

  const targetGroupId = previous.supersetGroupId ?? createId();
  const assignments: SupersetAssignment[] = [];

  if (!previous.supersetGroupId) {
    assignments.push({ id: previous.id, supersetGroupId: targetGroupId });
  }

  const { end } = groupRunAt(items, index);

  for (const member of items.slice(index, end + 1)) {
    assignments.push({ id: member.id, supersetGroupId: targetGroupId });
  }

  return assignments;
}

/**
 * Löst eine Übung aus ihrer Gruppe.
 *
 * Trifft es ein mittleres Mitglied, zerfällt die Gruppe in zwei Läufe: der
 * vordere behält die Kennung, der hintere bekommt eine neue. Ohne diese
 * Teilung hätte eine Gruppe Mitglieder, zwischen denen eine fremde Übung
 * steht - genau der Zustand, den `areGroupsContiguous` ausschließt. Ein Lauf
 * mit nur noch einem Mitglied verliert seine Kennung ganz.
 */
export function planUngroup<T extends GroupableExercise>(
  items: T[],
  id: string,
): SupersetAssignment[] | null {
  const index = items.findIndex((item) => item.id === id);

  if (index === -1 || !items[index].supersetGroupId) {
    return null;
  }

  const { start, end } = groupRunAt(items, index);
  const assignments: SupersetAssignment[] = [{ id, supersetGroupId: undefined }];

  const before = items.slice(start, index);
  const after = items.slice(index + 1, end + 1);

  if (before.length === 1) {
    assignments.push({ id: before[0].id, supersetGroupId: undefined });
  }

  if (after.length === 1) {
    assignments.push({ id: after[0].id, supersetGroupId: undefined });
  } else if (after.length > 1) {
    const splitGroupId = createId();

    for (const member of after) {
      assignments.push({ id: member.id, supersetGroupId: splitGroupId });
    }
  }

  return assignments;
}

/**
 * Räumt Gruppen auf, von denen nur noch ein Mitglied übrig ist.
 *
 * Nötig, nachdem eine Übung aus der Mitte gelöscht wurde: eine Gruppe zu
 * zweit verliert dabei ihren Partner, und ein Supersatz aus einer Übung ist
 * keiner. Gibt nur die tatsächlich zu ändernden Einträge zurück.
 */
export function planNormalizeGroups<T extends GroupableExercise>(
  items: T[],
): SupersetAssignment[] {
  const assignments: SupersetAssignment[] = [];
  let index = 0;

  while (index < items.length) {
    const { end } = groupRunAt(items, index);

    if (items[index].supersetGroupId && end === index) {
      assignments.push({ id: items[index].id, supersetGroupId: undefined });
    }

    index = end + 1;
  }

  return assignments;
}

/**
 * Verschiebt einen ganzen Block über seinen Nachbarn.
 *
 * Der Block ist die Einheit, in der sortiert wird: ein Supersatz, der beim
 * Verschieben zerrissen wird, ist keiner mehr. `null` heißt "am Rand
 * angekommen", damit der Aufrufer sich den Schreibvorgang spart.
 */
export function moveSupersetBlock<T extends GroupableExercise>(
  items: T[],
  id: string,
  direction: -1 | 1,
): string[] | null {
  const blocks = buildSupersetBlocks(items);
  const blockIndex = blocks.findIndex((block) =>
    block.kind === 'group'
      ? block.exercises.some((exercise) => exercise.id === id)
      : block.exercise.id === id,
  );
  const targetIndex = blockIndex + direction;

  if (blockIndex === -1 || targetIndex < 0 || targetIndex >= blocks.length) {
    return null;
  }

  const nextBlocks = [...blocks];
  const [moved] = nextBlocks.splice(blockIndex, 1);
  nextBlocks.splice(targetIndex, 0, moved);

  return nextBlocks.flatMap((block) =>
    block.kind === 'group' ? block.exercises.map((exercise) => exercise.id) : [block.exercise.id],
  );
}

/**
 * Sortiert eine Übung innerhalb ihres Supersatzes um.
 *
 * Bewegt sich bewusst nur innerhalb des Laufs: die Reihenfolge im Supersatz
 * ist die Reihenfolge der Ausführung, das Verlassen der Gruppe dagegen ist
 * "Verbindung lösen" und keine Sortierung.
 */
export function moveWithinGroup<T extends GroupableExercise>(
  items: T[],
  id: string,
  direction: -1 | 1,
): string[] | null {
  const index = items.findIndex((item) => item.id === id);

  if (index === -1 || !items[index].supersetGroupId) {
    return null;
  }

  const { start, end } = groupRunAt(items, index);
  const targetIndex = index + direction;

  if (targetIndex < start || targetIndex > end) {
    return null;
  }

  const nextIds = items.map((item) => item.id);
  const [moved] = nextIds.splice(index, 1);
  nextIds.splice(targetIndex, 0, moved);

  return nextIds;
}

/**
 * Ob jede Gruppe einen zusammenhängenden Block bildet.
 *
 * Wächter für die Sortier-Actions: eine zerrissene Gruppe ließe sich weder
 * darstellen noch am Stück bewegen, und sie entstünde stumm.
 */
export function areGroupsContiguous<T extends GroupableExercise>(items: T[]) {
  const seenGroupIds = new Set<string>();
  let previousGroupId: string | undefined;

  for (const item of items) {
    const groupId = item.supersetGroupId;

    if (groupId && groupId !== previousGroupId) {
      if (seenGroupIds.has(groupId)) {
        return false;
      }

      seenGroupIds.add(groupId);
    }

    previousGroupId = groupId;
  }

  return true;
}
