import { describe, expect, it } from 'vitest';

import {
  areGroupsContiguous,
  buildSupersetBlocks,
  moveSupersetBlock,
  moveWithinGroup,
  planGroupWithPrevious,
  planUngroup,
  type GroupableExercise,
} from '@/domain/superset';

/** Kurzschreibweise: "a", "b(g1)" - Id und optionale Gruppe in einem String. */
function buildList(...entries: string[]): GroupableExercise[] {
  return entries.map((entry, index) => {
    const match = /^(?<id>[^(]+)(\((?<group>[^)]+)\))?$/.exec(entry);

    return {
      id: match?.groups?.id ?? entry,
      orderIndex: index + 1,
      supersetGroupId: match?.groups?.group,
    };
  });
}

/** Wendet die geplanten Zuordnungen an, damit Folgezustände prüfbar sind. */
function applyAssignments(
  items: GroupableExercise[],
  assignments: ReturnType<typeof planUngroup>,
): GroupableExercise[] {
  const byId = new Map((assignments ?? []).map((entry) => [entry.id, entry.supersetGroupId]));

  return items.map((item) =>
    byId.has(item.id) ? { ...item, supersetGroupId: byId.get(item.id) } : item,
  );
}

describe('buildSupersetBlocks', () => {
  it('gibt einzelne Übungen als eigene Blöcke aus', () => {
    const blocks = buildSupersetBlocks(buildList('a', 'b'));

    expect(blocks).toEqual([
      { kind: 'single', exercise: expect.objectContaining({ id: 'a' }) },
      { kind: 'single', exercise: expect.objectContaining({ id: 'b' }) },
    ]);
  });

  it('fasst benachbarte Mitglieder zu einem Gruppenblock zusammen', () => {
    const blocks = buildSupersetBlocks(buildList('a', 'b(g1)', 'c(g1)', 'd'));

    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toMatchObject({ kind: 'group', groupId: 'g1' });
    expect(blocks[1].kind === 'group' && blocks[1].exercises.map((item) => item.id)).toEqual([
      'b',
      'c',
    ]);
  });

  it('trennt zwei aufeinanderfolgende Gruppen', () => {
    const blocks = buildSupersetBlocks(buildList('a(g1)', 'b(g1)', 'c(g2)', 'd(g2)'));

    expect(blocks.map((block) => block.kind === 'group' && block.groupId)).toEqual(['g1', 'g2']);
  });

  it('behandelt ein allein stehendes Mitglied wie eine einzelne Übung', () => {
    const blocks = buildSupersetBlocks(buildList('a(g1)', 'b'));

    expect(blocks[0]).toMatchObject({ kind: 'single' });
  });
});

describe('planGroupWithPrevious', () => {
  it('lehnt die erste Übung ab - sie hat keine Vorgängerin', () => {
    expect(planGroupWithPrevious(buildList('a', 'b'), 'a')).toBeNull();
  });

  it('legt aus zwei einzelnen Übungen eine neue Gruppe an', () => {
    const items = buildList('a', 'b');
    const assignments = planGroupWithPrevious(items, 'b') ?? [];
    const groupIds = new Set(assignments.map((entry) => entry.supersetGroupId));

    expect(assignments.map((entry) => entry.id).sort()).toEqual(['a', 'b']);
    expect(groupIds.size).toBe(1);
    expect([...groupIds][0]).toBeTruthy();
  });

  it('lässt eine Übung einer bestehenden Gruppe beitreten', () => {
    const assignments = planGroupWithPrevious(buildList('a(g1)', 'b(g1)', 'c'), 'c');

    expect(assignments).toEqual([{ id: 'c', supersetGroupId: 'g1' }]);
  });

  it('verschmilzt zwei benachbarte Gruppen', () => {
    const items = buildList('a(g1)', 'b(g1)', 'c(g2)', 'd(g2)');
    const next = applyAssignments(items, planGroupWithPrevious(items, 'c'));

    expect(next.map((item) => item.supersetGroupId)).toEqual(['g1', 'g1', 'g1', 'g1']);
    expect(areGroupsContiguous(next)).toBe(true);
  });

  it('tut nichts, wenn beide bereits in derselben Gruppe liegen', () => {
    expect(planGroupWithPrevious(buildList('a(g1)', 'b(g1)'), 'b')).toBeNull();
  });
});

describe('planUngroup', () => {
  it('tut nichts bei einer Übung ohne Gruppe', () => {
    expect(planUngroup(buildList('a', 'b'), 'b')).toBeNull();
  });

  it('löst ein Paar vollständig auf - eine Gruppe zu zweit hat keinen Rest', () => {
    const items = buildList('a(g1)', 'b(g1)');
    const next = applyAssignments(items, planUngroup(items, 'b'));

    expect(next.map((item) => item.supersetGroupId)).toEqual([undefined, undefined]);
  });

  it('teilt eine Gruppe, wenn ein mittleres Mitglied herausgelöst wird', () => {
    const items = buildList('a(g1)', 'b(g1)', 'c(g1)', 'd(g1)');
    const next = applyAssignments(items, planUngroup(items, 'b'));

    // a bleibt allein zurück und verliert die Kennung, c und d bilden eine neue.
    expect(next[0].supersetGroupId).toBeUndefined();
    expect(next[1].supersetGroupId).toBeUndefined();
    expect(next[2].supersetGroupId).toBeTruthy();
    expect(next[2].supersetGroupId).toBe(next[3].supersetGroupId);
    expect(next[2].supersetGroupId).not.toBe('g1');
    expect(areGroupsContiguous(next)).toBe(true);
  });

  it('lässt den vorderen Lauf bestehen, wenn er groß genug bleibt', () => {
    const items = buildList('a(g1)', 'b(g1)', 'c(g1)', 'd(g1)');
    const next = applyAssignments(items, planUngroup(items, 'd'));

    expect(next.map((item) => item.supersetGroupId)).toEqual(['g1', 'g1', 'g1', undefined]);
  });

  it('rührt eine benachbarte fremde Gruppe nicht an', () => {
    const items = buildList('a(g1)', 'b(g1)', 'c(g2)', 'd(g2)');
    const next = applyAssignments(items, planUngroup(items, 'b'));

    expect(next.map((item) => item.supersetGroupId)).toEqual([undefined, undefined, 'g2', 'g2']);
  });
});

describe('moveSupersetBlock', () => {
  it('verschiebt eine Gruppe am Stück über die nächste Übung', () => {
    const items = buildList('a(g1)', 'b(g1)', 'c');

    expect(moveSupersetBlock(items, 'a', 1)).toEqual(['c', 'a', 'b']);
  });

  it('springt über eine ganze Gruppe statt in sie hinein', () => {
    const items = buildList('a', 'b(g1)', 'c(g1)');

    expect(moveSupersetBlock(items, 'a', 1)).toEqual(['b', 'c', 'a']);
  });

  it('gibt am Rand null zurück', () => {
    expect(moveSupersetBlock(buildList('a', 'b'), 'a', -1)).toBeNull();
    expect(moveSupersetBlock(buildList('a', 'b'), 'b', 1)).toBeNull();
  });
});

describe('moveWithinGroup', () => {
  it('tauscht zwei Mitglieder derselben Gruppe', () => {
    const items = buildList('a', 'b(g1)', 'c(g1)');

    expect(moveWithinGroup(items, 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('lässt niemanden die Gruppe verlassen', () => {
    const items = buildList('a', 'b(g1)', 'c(g1)', 'd');

    expect(moveWithinGroup(items, 'b', -1)).toBeNull();
    expect(moveWithinGroup(items, 'c', 1)).toBeNull();
  });

  it('tut nichts bei einer Übung ohne Gruppe', () => {
    expect(moveWithinGroup(buildList('a', 'b'), 'a', 1)).toBeNull();
  });
});

describe('areGroupsContiguous', () => {
  it('akzeptiert zusammenhängende Gruppen', () => {
    expect(areGroupsContiguous(buildList('a(g1)', 'b(g1)', 'c', 'd(g2)', 'e(g2)'))).toBe(true);
  });

  it('erkennt eine zerrissene Gruppe', () => {
    expect(areGroupsContiguous(buildList('a(g1)', 'b', 'c(g1)'))).toBe(false);
  });
});
