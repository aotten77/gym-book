import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GuidedStepsCard } from '@/components/GuidedStepsCard';
import type { GuidedStepRestriction } from '@/domain/restriction';

describe('GuidedStepsCard', () => {
  it('listet die Schritte nur lesend mit Dauer und Seiten', () => {
    render(
      <GuidedStepsCard
        steps={[
          { name: 'Kindhaltung', seconds: 60 },
          { name: 'Taube', seconds: 150, bothSides: true, hint: 'Hüfte sinken lassen.' },
        ]}
      />,
    );

    const rows = within(screen.getByRole('list', { name: 'Schritte' })).getAllByRole('listitem');

    expect(rows.map((row) => row.textContent)).toEqual(['Kindhaltung1:00', 'TaubeL · R2 × 1:15']);
    // Nur lesen: weder Knöpfe noch Felder.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('nennt eine Pause vor dem Schritt, dessen Wechsel eine ist', () => {
    render(
      <GuidedStepsCard
        steps={[
          { name: 'Beispiel A', seconds: 30 },
          { name: 'Beispiel B', seconds: 30, transitionSeconds: 45 },
          { name: 'Beispiel C', seconds: 30, transitionSeconds: 10 },
        ]}
      />,
    );

    const rows = within(screen.getByRole('list', { name: 'Schritte' })).getAllByRole('listitem');
    const pauses = document.querySelectorAll('[data-guided-step-pause]');

    expect(pauses).toHaveLength(1);
    expect(pauses[0].textContent).toBe('45 s Pause');
    expect(rows[1].contains(pauses[0])).toBe(true);
  });

  it('nennt keine Pause vor dem ersten gespielten Schritt, wenn der erste pausiert ist', () => {
    render(
      <GuidedStepsCard
        steps={[
          { name: 'Beispiel A', seconds: 30 },
          { name: 'Beispiel B', seconds: 30, transitionSeconds: 45 },
        ]}
        restrictions={
          new Map<number, GuidedStepRestriction>([
            [0, { kind: 'pausiert', label: 'Pausiert · Beispiel X', notes: [] }],
          ])
        }
      />,
    );

    expect(document.querySelectorAll('[data-guided-step-pause]')).toHaveLength(0);
  });
});
