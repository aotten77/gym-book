import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLibraryImportPayload } from '@/domain/library-import';

/*
 * Die Formatbeschreibung für den Trainings-Assistenten
 * (`docs/claude-projekt/import-format.md`) ist die Vorlage, nach der er
 * Import-Dateien schreibt. Jeder ```json-Block darin ist deshalb eine
 * vollständige, gültige Importdatei - Ausschnitte stehen als ```text. Ändert
 * sich das Format, fällt ein veraltetes Beispiel hier auf und nicht erst in
 * der App.
 */

function jsonBlocks(): string[] {
  const markdown = readFileSync(resolve(process.cwd(), 'docs/claude-projekt/import-format.md'), 'utf8');

  return [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]);
}

describe('docs/claude-projekt/import-format.md', () => {
  it('jeder json-Block der Formatbeschreibung ist eine gültige Importdatei', () => {
    const blocks = jsonBlocks();

    expect(blocks.length).toBeGreaterThan(0);

    for (const [index, block] of blocks.entries()) {
      expect(() => parseLibraryImportPayload(block), `json-Block ${index + 1}`).not.toThrow();
    }
  });

  it('enthält mindestens einen Block mit restrictions', () => {
    expect(jsonBlocks().some((block) => 'restrictions' in JSON.parse(block))).toBe(true);
  });
});
