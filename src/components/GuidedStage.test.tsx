import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GuidedStage } from '@/components/GuidedStage';

let meta: HTMLMetaElement;

beforeEach(() => {
  meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = '#f2f2ef';
  document.head.append(meta);
});

afterEach(() => {
  document.head.innerHTML = '';
});

describe('GuidedStage', () => {
  it('ist standardmäßig hell und hängt an body, nicht in den Container', () => {
    const { container } = render(
      <GuidedStage label="Yoga" screen="start">
        Inhalt
      </GuidedStage>,
    );
    const stage = screen.getByRole('main', { name: 'Yoga' });

    expect(stage.parentElement).toBe(document.body);
    expect(container.contains(stage)).toBe(false);
    expect(stage.getAttribute('data-guided-tone')).toBe('light');
    expect(stage.className).toContain('bg-app');
    expect(meta.content).toBe('#f2f2ef');
  });

  it('dunkel: Tinte als Grund und Leistenfarbe, danach wieder Papier', () => {
    const { unmount } = render(
      <GuidedStage label="Yoga" screen="run" tone="dark">
        Inhalt
      </GuidedStage>,
    );
    const stage = screen.getByRole('main', { name: 'Yoga' });

    expect(stage.getAttribute('data-guided-tone')).toBe('dark');
    expect(stage.className).toContain('bg-accent');
    expect(meta.content).toBe('#0c1210');

    unmount();

    expect(meta.content).toBe('#f2f2ef');
  });

  it('dunkel: setzt die Bühnenfarben auf Papier vor Tinte', () => {
    render(
      <GuidedStage label="Yoga" screen="run" tone="dark">
        Inhalt
      </GuidedStage>,
    );
    const stage = screen.getByRole('main', { name: 'Yoga' });

    expect(stage.style.getPropertyValue('--stage-fg')).toBe('242 242 239');
    expect(stage.style.getPropertyValue('--stage-bg')).toBe('12 18 16');
  });

  it('hell: setzt die Bühnenfarben auf Tinte vor Papier', () => {
    render(
      <GuidedStage label="Yoga" screen="run" tone="light">
        Inhalt
      </GuidedStage>,
    );
    const stage = screen.getByRole('main', { name: 'Yoga' });

    expect(stage.style.getPropertyValue('--stage-fg')).toBe('12 18 16');
    expect(stage.style.getPropertyValue('--stage-bg')).toBe('242 242 239');
  });
});
