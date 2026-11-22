import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { GuidedStartPage } from '@/pages/GuidedStartPage';

const STAMP = '2026-11-01T08:00:00.000Z';

function renderStart(templateId: string) {
  return render(
    <MemoryRouter initialEntries={[`/guided/${templateId}`]}>
      <Routes>
        <Route path="/guided/:templateId" element={<GuidedStartPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  const meta = document.createElement('meta');

  meta.name = 'theme-color';
  meta.content = '#f2f2ef';
  document.head.append(meta);
});

afterEach(() => {
  document.head.innerHTML = '';
});

async function addGuidedTemplate() {
  await db.workoutTemplates.add({
    id: 'g1',
    name: 'Yoga Abendflow',
    category: 'yoga',
    steps: [
      { name: 'Kindhaltung', seconds: 60 },
      { name: 'Taube', seconds: 75, bothSides: true, hint: 'Hüfte sinken lassen.' },
    ],
    createdAt: STAMP,
    updatedAt: STAMP,
  });
}

describe('GuidedStartPage', () => {
  it('zeigt die Schritte links und die Kennzahlen rechts', async () => {
    await addGuidedTemplate();
    renderStart('g1');

    const steps = await screen.findByRole('list', { name: 'Schritte' });
    const rows = within(steps).getAllByRole('listitem');

    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Kindhaltung');
    expect(rows[0].textContent).toContain('1:00');
    expect(rows[1].textContent).toContain('Taube');
    expect(rows[1].textContent).toContain('2 × 1:15');

    const facts = screen.getByRole('list', { name: 'Kennzahlen' });

    expect(within(facts).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '2 Schritte',
      '≈ 4 min',
      '1 beidseitig',
    ]);
    expect(screen.getByRole('heading', { name: 'Yoga Abendflow' })).toBeTruthy();
    expect(screen.getByText('Geführt · Yoga')).toBeTruthy();
  });

  it('hat noch keinen Startknopf, der etwas tut', async () => {
    await addGuidedTemplate();
    renderStart('g1');

    const start = await screen.findByRole('button', { name: 'Einheit starten' });

    expect((start as HTMLButtonElement).disabled).toBe(true);
  });

  it('bietet ein „i“ nur an Schritten mit Hinweis und öffnet ihn im Info-Fenster', async () => {
    await addGuidedTemplate();
    renderStart('g1');

    await screen.findByRole('list', { name: 'Schritte' });

    expect(screen.queryByRole('button', { name: 'Hinweis: Kindhaltung' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Hinweis: Taube' }));

    const dialog = screen.getByRole('dialog', { name: 'Hinweis · Taube' });

    expect(dialog.textContent).toContain('Hüfte sinken lassen.');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('schließt das Info-Fenster auch über den Knopf', async () => {
    await addGuidedTemplate();
    renderStart('g1');

    fireEvent.click(await screen.findByRole('button', { name: 'Hinweis: Taube' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hinweis schließen' }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('färbt die Leiste dunkel, solange er steht, und stellt Papier wieder her', async () => {
    await addGuidedTemplate();

    const { unmount } = renderStart('g1');
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!;

    await screen.findByRole('list', { name: 'Schritte' });

    expect(meta.content).toBe('#0c1210');

    await act(async () => unmount());

    expect(meta.content).toBe('#f2f2ef');
  });

  it('sagt es, wenn es die Vorlage nicht gibt', async () => {
    renderStart('weg');

    expect(await screen.findByText('Diese Vorlage gibt es nicht mehr.')).toBeTruthy();
  });

  it('sagt es, wenn die Vorlage nicht geführt ist', async () => {
    await db.workoutTemplates.add({ id: 'k1', name: 'Einheit A', createdAt: STAMP, updatedAt: STAMP });
    renderStart('k1');

    expect(await screen.findByText('Einheit A ist keine geführte Vorlage.')).toBeTruthy();
  });
});
