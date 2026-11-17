import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { NowSheet } from '@/components/NowSheet';
import { useUiStore } from '@/store/ui-store';

let go: (path: string) => void = () => undefined;

function Navigator() {
  const navigate = useNavigate();
  go = (path) => navigate(path);
  return null;
}

describe('NowSheet', () => {
  afterEach(() => useUiStore.getState().setNowSheetOpen(false));

  it('schließt sich beim Routenwechsel, damit es auf dem nächsten Screen nicht wieder aufspringt', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Navigator />
        <NowSheet />
      </MemoryRouter>,
    );

    act(() => useUiStore.getState().setNowSheetOpen(true));
    expect(useUiStore.getState().isNowSheetOpen).toBe(true);

    act(() => go('/session/abc'));

    expect(useUiStore.getState().isNowSheetOpen).toBe(false);
  });
});
