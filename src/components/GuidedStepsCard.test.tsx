import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GuidedStepsCard } from '@/components/GuidedStepsCard';

describe('GuidedStepsCard', () => {
  it('listet die Schritte nur lesend mit Dauer und Seiten', () => {
    render(
      <GuidedStepsCard
        steps={[
          { name: 'Kindhaltung', seconds: 60 },
          { name: 'Taube', seconds: 75, bothSides: true, hint: 'Hüfte sinken lassen.' },
        ]}
      />,
    );

    const rows = within(screen.getByRole('list', { name: 'Schritte' })).getAllByRole('listitem');

    expect(rows.map((row) => row.textContent)).toEqual(['Kindhaltung1:00', 'TaubeL · R2 × 1:15']);
    // Nur lesen: weder Knöpfe noch Felder.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
