import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from './ui-store';

describe('planPosition', () => {
  beforeEach(() => {
    useUiStore.setState({ planPosition: null });
  });

  it('startet leer', () => {
    expect(useUiStore.getState().planPosition).toBeNull();
  });

  it('merkt sich die oberste sichtbare Woche und ihre Lage', () => {
    const position = {
      todayKey: '2026-11-22',
      firstMondayKey: '2026-09-28',
      anchorKey: '2026-10-19',
      anchorTop: 12.5,
    };

    useUiStore.getState().setPlanPosition(position);

    expect(useUiStore.getState().planPosition).toEqual(position);
  });

  it('lässt sich wieder leeren', () => {
    useUiStore.getState().setPlanPosition({
      todayKey: '2026-11-22',
      firstMondayKey: '2026-09-28',
      anchorKey: '2026-10-19',
      anchorTop: 0,
    });
    useUiStore.getState().setPlanPosition(null);

    expect(useUiStore.getState().planPosition).toBeNull();
  });
});
