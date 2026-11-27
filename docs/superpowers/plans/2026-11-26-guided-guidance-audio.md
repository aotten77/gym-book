# Gesprochene Anleitung für geführte Einheiten – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein geführter Schritt kann eine per Import gelieferte Anleitung tragen, die – eingeschaltet – im Wechsel vor der Übung gesprochen wird; der Wechsel ist so lang wie die gemessene Ansage.

**Architecture:** Neues Vorlagenfeld `GuidedStep.guidance` (Import, Backup) und Snapshot-Feld `guidanceSeconds` (nur `startGuidedSession`). Die Anleitung hängt als ein Satz an „Als Nächstes: …“; die erzeugte MP3 wird gemessen (`Announcement.durationMs`), beim Start wird daraus `guidanceSeconds` je Schritt, und `resolveGuidedSections` nimmt es als Wechsel. Der Player stoppt eine laufende Ansage bei jedem Abschnittswechsel.

**Tech Stack:** Vite, React, TypeScript, Dexie, Zod, Vitest (jsdom + fake-indexeddb), Playwright (WebKit), Web Audio.

**Spec:** `docs/superpowers/specs/2026-11-26-guided-guidance-audio-design.md`

## Global Constraints

- **Oberste Regel:** keine persönlichen Daten in Dateien. Neue Testdaten und Beispiele erkennbar erfunden („Beispiel A“, „Beispiel B“, „Beispiel-Mobility“); keine echten Übungsnamen aus einem Plan. Vorhandene Fixtures nicht umbenennen.
- **Commits nur nach Freigabe des Nutzers.** Jeder „Commit“-Schritt heißt: Diff zeigen, Freigabe abwarten, dann committen. Nie `--no-verify`; der Wächter (`scripts/privacy-guard.mjs`) läuft in `pre-commit`/`pre-push`. Vor jedem Commit `npm run privacy`.
- UI-Texte und Kommentare deutsch mit echten Umlauten; Fehlermeldungen aus `db/` und `domain/` sind nutzersichtbar deutsch.
- Jede gerenderte Zahl über `formatNumber`. Touch-Ziele ≥ 44 px (`min-h-touch`). Kontrast ≥ 4,5:1. Kein zusätzliches Lime auf dem Start-Screen.
- `src/domain/` bleibt rein (kein Dexie, kein React, kein `src/lib/sound.ts`).
- **Keine neue DB-Version:** alle neuen Felder sind additiv und ohne Index.
- Dexie `update` mit `undefined` löscht ein Feld – nur gemeinte Schlüssel übergeben.
- Im Trainingsablauf kein Netzzugriff; TTS nur in `generateAnnouncements`.
- Werte aus der Spec: Anleitung höchstens **600 Zeichen** (Code points, `countChars`); Puffer `GUIDED_GUIDANCE_PAD_SECONDS = 2`; Verzögerung nach dem Signal `GUIDED_ANNOUNCEMENT_DELAY_SECONDS = 0.7`; Anleitung nur vor der ersten (bzw. einzigen) Seite.
- Format und Import-Code ändern sich im selben Task (`docs/claude-projekt/import-format.md` wird von `src/domain/import-format.test.ts` geprüft).
- Am Ende grün: `npm run lint`, `npm run check`, `npm run check:strict`, `npm test`, `npm run build`, `npm run test:e2e` (vorher Dev-Server auf 5173 beenden).

## Review Focus

1. **Ansage ohne Dauer wird nie ersetzt** – `saveAnnouncement` überspringt heute einen vorhandenen Datensatz. Ist eine Messung gescheitert, muss ein zweiter Lauf den Anleitungssatz neu speichern *mit* Dauer. Test in Task 4.
2. **Alte Einheiten und Backups ohne `guidanceSeconds`** müssen exakt die heutigen Abschnitte ergeben (auch der feste 5-s-Erstwechsel). Test in Task 1.
3. **Schrittanpassung durch eine Einschränkung** ändert die Sekunden und damit den Satz mit Anleitung; Verfügbarkeit und Start müssen die wirksamen Schritte messen, nicht die der Vorlage. Test in Task 5 und Task 6.
4. **Beidseitiger erster Schritt:** Der Wechsel vor links nimmt `guidanceSeconds`, der Seitenwechsel bleibt 3 s, rechts ohne Anleitung im Satz. Test in Task 1 und Task 2.
5. **Lange Ansage läuft in den nächsten Abschnitt** (Sprung, „Jetzt starten“, Pause, „Nur Ton“, Screen verlassen) – sie muss stoppen, und eine neue Ansage stoppt die alte. Test in Task 7.

---

## Dateien

| Datei | Änderung |
|---|---|
| `src/domain/models.ts` | `GuidedStep.guidance`, `GuidedStep.guidanceSeconds`, `Announcement.durationMs`, `AppSettings.guidedGuidance` |
| `src/domain/guided-steps.ts` | `resolveGuidedSections` liest `guidanceSeconds` |
| `src/domain/guided-announcements.ts` | Satz mit Anleitung, `requiredGuidanceTexts`, `guidanceTransitionSeconds`, `applyGuidance`, Konstanten |
| `src/domain/library-import.ts` | Schema, `normalizeGuidedSteps` |
| `docs/claude-projekt/import-format.md` | Feld + Schreibanleitung + Beispiel |
| `src/lib/export.ts` | `guidedStepSchema`, Settings-Schema |
| `src/lib/announcement-audio.ts` | `measureAudioDuration` |
| `src/db/tts-actions.ts` | `saveAnnouncement` mit Dauer |
| `src/db/announcement-actions.ts` | Erzeugen, Messen, Verfügbarkeit, Dauern laden |
| `src/db/settings-actions.ts` | `setGuidedGuidance` |
| `src/db/guided-session-actions.ts` | Option `guidance` |
| `src/lib/sound.ts`, `src/pages/GuidedRunPage.tsx` | eine laufende Ansage, Stopp |
| `src/pages/GuidedStartPage.tsx`, `src/components/GuidedHintDialog.tsx` | Schalter, Dauer-Pill, „i“ |
| `e2e/helpers.ts`, `e2e/guided-guidance.spec.ts` | stille WAV, e2e |
| `docs/architecture/guided-templates.md`, `.claude/skills/gym-book-architect/SKILL.md`, `.trae/skills/gym-book-pwa-architect/SKILL.md`, `CLAUDE.md` | Doku |

---

### Task 1: Modell und Zeitachse

**Files:**
- Modify: `src/domain/models.ts` (`GuidedStep` ab Z. 88, `Announcement` ab Z. 795, `AppSettings` bei `guidedAudioMode` Z. 654)
- Modify: `src/domain/guided-steps.ts:82-117` (`resolveGuidedSections`)
- Test: `src/domain/guided-steps.test.ts`

**Interfaces:**
- Produces:
  - `GuidedStep.guidance?: string` – Anleitungstext (Vorlage, Import, Backup).
  - `GuidedStep.guidanceSeconds?: number` – nur im Snapshot `GuidedRun.steps`; Länge des Wechsels vor dem Schritt; vorhanden = Anleitung wird gesprochen. Kommentar wie in Spec Abschnitt 1.
  - `Announcement.durationMs?: number`
  - `AppSettings.guidedGuidance?: boolean`
  - `plannedTransitionSeconds(steps: readonly GuidedStep[], stepIndex: number): number` in `guided-steps.ts`, exportiert – der Wechsel ohne Anleitung (Index 0 → `GUIDED_START_TRANSITION_SECONDS`, sonst `transitionSeconds ?? GUIDED_DEFAULT_TRANSITION_SECONDS`). Die eine Regel für beide Leser.
  - `resolveGuidedSections(steps)`: Wechsel-`seconds` = `step.guidanceSeconds ?? plannedTransitionSeconds(steps, stepIndex)`.

- [ ] **Step 1: Failing tests** in `guided-steps.test.ts`, `describe('resolveGuidedSections mit Anleitung')`:

```ts
it('nimmt guidanceSeconds als Wechsel, auch beim ersten Schritt', () => {
  const sections = resolveGuidedSections([
    { name: 'Beispiel A', seconds: 40, guidanceSeconds: 18 },
    { name: 'Beispiel B', seconds: 30, transitionSeconds: 8, guidanceSeconds: 21 },
  ]);
  expect(sections.map((s) => [s.kind, s.seconds])).toEqual([
    ['transition', 18], ['exercise', 40], ['transition', 21], ['exercise', 30],
  ]);
});

it('legt bei einem beidseitigen Schritt die Anleitung nur vor links, der Seitenwechsel bleibt 3 s', () => {
  const sections = resolveGuidedSections([
    { name: 'Beispiel C', seconds: 60, bothSides: true, guidanceSeconds: 16 },
  ]);
  expect(sections.map((s) => [s.kind, s.side, s.seconds])).toEqual([
    ['transition', 'left', 16], ['exercise', 'left', 30],
    ['sideSwitch', 'right', 3], ['exercise', 'right', 30],
  ]);
});

it('ändert ohne guidanceSeconds nichts – auch ein guidance-Text allein nicht', () => {
  const plain = [
    { name: 'Beispiel A', seconds: 40, transitionSeconds: 9 },
    { name: 'Beispiel B', seconds: 30, transitionSeconds: 7 },
  ];
  const withText = plain.map((step) => ({ ...step, guidance: 'Erfundener Beispieltext.' }));
  expect(resolveGuidedSections(withText)).toEqual(resolveGuidedSections(plain));
  expect(resolveGuidedSections(plain)[0].seconds).toBe(5);
});
```

- [ ] **Step 2:** `npx vitest run src/domain/guided-steps.test.ts` → die ersten beiden FAIL (TS-Fehler bzw. 5 statt 18).
- [ ] **Step 3:** Felder in `models.ts` ergänzen, `resolveGuidedSections` anpassen. Den Kommentar in `guided-steps.ts` zur festen 5-s-Regel um „außer bei `guidanceSeconds`“ ergänzen.
- [ ] **Step 4:** `npx vitest run src/domain/guided-steps.test.ts src/domain/guided-run.test.ts` → PASS.
- [ ] **Step 5:** Commit (nach Freigabe): `feat: Wechsel mit Anleitung in der Zeitachse`.

---

### Task 2: Sätze mit Anleitung (domain)

**Files:**
- Modify: `src/domain/guided-announcements.ts`
- Modify: `src/lib/sound.ts:264` (Konstante entfernen), `src/pages/GuidedRunPage.tsx:55,241` (Import umstellen)
- Test: `src/domain/guided-announcements.test.ts`

**Interfaces:**
- Consumes: `GuidedStep.guidance`, `GuidedStep.guidanceSeconds`, `plannedTransitionSeconds` (Task 1).
- Produces (alle in `src/domain/guided-announcements.ts`):
  - `GUIDED_ANNOUNCEMENT_DELAY_SECONDS = 0.7`, `GUIDED_GUIDANCE_PAD_SECONDS = 2`
  - `buildNextAnnouncement(step: Pick<GuidedStep, 'name' | 'spokenName' | 'seconds' | 'bothSides' | 'guidance' | 'guidanceSeconds'>, side?: GuidedSide): string` – hängt `" " + guidance.trim()` an `"Als Nächstes: …"` an, wenn `guidanceSeconds !== undefined`, `guidance?.trim()` nicht leer und `side !== 'right'`. Der heutige Satz endet ohne Punkt; mit Anleitung wird ein Punkt davor gesetzt: `"Als Nächstes: Beispiel A, 40 Sekunden. {Anleitung}"`.
  - `requiredGuidanceTexts(steps: readonly GuidedStep[]): { stepIndex: number; text: string }[]` – je Schritt mit nicht leerer `guidance` ein Eintrag, Text = `buildNextAnnouncement({ ...step, guidanceSeconds: 1 }, step.bothSides ? 'left' : undefined)`, in Schrittreihenfolge.
  - `guidanceTransitionSeconds(plannedSeconds: number, durationMs: number): number` = `max(plannedSeconds, ceil(0.7 + durationMs / 1000 + 2))`.
  - `applyGuidance(steps: readonly GuidedStep[], durationsByText: ReadonlyMap<string, number>): GuidedStep[] | null` – Kopie der Schritte; jeder Schritt aus `requiredGuidanceTexts` bekommt `guidanceSeconds = guidanceTransitionSeconds(plannedTransitionSeconds(steps, i), durationsByText.get(text))`. `null`, wenn kein Schritt eine Anleitung hat oder eine Dauer fehlt.

- [ ] **Step 1: Failing tests** in `guided-announcements.test.ts`:

```ts
const GUIDE = 'Erfundener Beispieltext zum Einstieg.';

describe('buildNextAnnouncement mit Anleitung', () => {
  it('hängt die Anleitung nur mit guidanceSeconds an', () => {
    const step = { name: 'Beispiel A', seconds: 40, guidance: GUIDE };
    expect(buildNextAnnouncement(step)).toBe('Als Nächstes: Beispiel A, 40 Sekunden');
    expect(buildNextAnnouncement({ ...step, guidanceSeconds: 12 }))
      .toBe(`Als Nächstes: Beispiel A, 40 Sekunden. ${GUIDE}`);
  });
  it('spricht sie bei beidseitigen Schritten nur links', () => {
    const step = { name: 'Beispiel C', seconds: 60, bothSides: true, guidance: GUIDE, guidanceSeconds: 12 };
    expect(buildNextAnnouncement(step, 'left')).toBe(`Als Nächstes: Beispiel C, links, 30 Sekunden. ${GUIDE}`);
    expect(buildNextAnnouncement(step, 'right')).toBe('Als Nächstes: Beispiel C, rechts, 30 Sekunden');
  });
});

describe('requiredAnnouncementTexts mit Anleitung', () => {
  it('liefert für einen Snapshot mit guidanceSeconds die Sätze mit Anleitung', () => {
    expect(requiredAnnouncementTexts([{ name: 'Beispiel A', seconds: 40, guidance: GUIDE, guidanceSeconds: 12 }]))
      .toEqual([`Als Nächstes: Beispiel A, 40 Sekunden. ${GUIDE}`, 'Geschafft.']);
  });
});

describe('requiredGuidanceTexts', () => {
  it('ein Satz je Schritt mit Anleitung, leere Anleitung zählt nicht', () => {
    expect(requiredGuidanceTexts([
      { name: 'Beispiel A', seconds: 40 },
      { name: 'Beispiel C', seconds: 60, bothSides: true, guidance: GUIDE },
      { name: 'Beispiel B', seconds: 30, guidance: '  ' },
    ])).toEqual([{ stepIndex: 1, text: `Als Nächstes: Beispiel C, links, 30 Sekunden. ${GUIDE}` }]);
  });
});

describe('guidanceTransitionSeconds', () => {
  it('rundet 0,7 s + Dauer + 2 s auf und hält den geplanten Wechsel als Untergrenze', () => {
    expect(guidanceTransitionSeconds(5, 12_000)).toBe(15);   // 14,7 → 15
    expect(guidanceTransitionSeconds(5, 12_400)).toBe(16);   // 15,1 → 16
    expect(guidanceTransitionSeconds(20, 3_000)).toBe(20);
  });
});

describe('applyGuidance', () => {
  const steps = [
    { name: 'Beispiel A', seconds: 40, guidance: GUIDE },
    { name: 'Beispiel B', seconds: 30, transitionSeconds: 25, guidance: GUIDE },
    { name: 'Beispiel D', seconds: 20 },
  ];
  const texts = requiredGuidanceTexts(steps).map((entry) => entry.text);

  it('setzt guidanceSeconds nur an Schritten mit Anleitung', () => {
    const result = applyGuidance(steps, new Map([[texts[0], 12_000], [texts[1], 12_000]]));
    expect(result?.map((step) => step.guidanceSeconds)).toEqual([15, 25, undefined]);
    expect(steps[0]).not.toHaveProperty('guidanceSeconds');
  });
  it('gibt null zurück, wenn eine Dauer fehlt oder keine Anleitung da ist', () => {
    expect(applyGuidance(steps, new Map([[texts[0], 12_000]]))).toBeNull();
    expect(applyGuidance([{ name: 'Beispiel D', seconds: 20 }], new Map())).toBeNull();
  });
});
```

- [ ] **Step 2:** `npx vitest run src/domain/guided-announcements.test.ts` → FAIL (Exporte fehlen).
- [ ] **Step 3:** Implementieren wie in Interfaces. `ANNOUNCEMENT_AFTER_SIGNAL_SECONDS` aus `sound.ts` entfernen (einziger Leser: `GuidedRunPage.tsx:55,241`); `GuidedRunPage` importiert `GUIDED_ANNOUNCEMENT_DELAY_SECONDS` aus dem domain.
- [ ] **Step 4:** `npx vitest run src/domain && npm run check` → PASS.
- [ ] **Step 5:** Commit (nach Freigabe): `feat: Ansagesätze mit Anleitung und Wechsellänge`.

---

### Task 3: Import, Format, Backup-Schema

**Files:**
- Modify: `src/domain/library-import.ts:107-126` (`importGuidedStepSchema`), `:610-623` (`normalizeGuidedSteps`)
- Modify: `docs/claude-projekt/import-format.md` (Abschnitt 6.1: Tabelle Z. ~177-184, neuer Absatz nach „Sprechnamen“, JSON-Beispiel Z. ~562)
- Modify: `src/lib/export.ts:74-81` (`guidedStepSchema`), Settings-Schema bei Z. 442
- Test: `src/domain/library-import.test.ts` (`describe('Import - geführte Schritte')`), `src/lib/export.test.ts`, `src/domain/import-format.test.ts` (unverändert, muss grün bleiben)

**Interfaces:**
- Consumes: `GuidedStep.guidance` (Task 1), `countChars` aus `src/domain/tts-quota.ts`.
- Produces: importierte Vorlagenschritte tragen `guidance` getrimmt; `guidanceSeconds` kommt nie in eine Vorlage. Backup liest/schreibt `guidance`, `guidanceSeconds`, `guidedGuidance`.

- [ ] **Step 1: Failing tests** in `library-import.test.ts`, im bestehenden `describe('Import - geführte Schritte')` (Helfer `parseWithSteps` existiert):

```ts
it('liest eine Anleitung, trimmt sie und lässt eine leere weg', () => {
  const payload = parseWithSteps([
    { name: 'Beispiel A', seconds: 40, guidance: '  Erfundener Beispieltext.  ' },
    { name: 'Beispiel B', seconds: 30, guidance: '   ' },
  ]);
  // Über den Plan prüfen, wie die Schritte gespeichert würden (Muster: 'legt eine neue geführte Vorlage mit bereinigten Schritten an').
  // Erwartet: steps[0].guidance === 'Erfundener Beispieltext.', 'guidance' in steps[1] === false
});

it('weist eine Anleitung über 600 Zeichen und eine Nicht-Text-Anleitung ab', () => {
  expect(() => parseWithSteps([{ name: 'A', seconds: 30, guidance: 'x'.repeat(601) }])).toThrow(
    'Schritt 1, Feld "guidance": Die Anleitung darf höchstens 600 Zeichen lang sein.',
  );
  expect(() => parseWithSteps([{ name: 'A', seconds: 30, guidance: 42 }])).toThrow(
    'Schritt 1, Feld "guidance": Die Anleitung muss Text sein.',
  );
  expect(() => parseWithSteps([{ name: 'A', seconds: 30, guidance: ` ${'x'.repeat(600)} ` }])).not.toThrow();
});

it('übernimmt guidanceSeconds aus einer Datei nicht in die Vorlage', () => {
  // Plan mit [{ name: 'A', seconds: 30, guidance: 'Text.', guidanceSeconds: 99 }] → gespeicherter Schritt ohne guidanceSeconds
});

it('zählt eine geänderte Anleitung als geänderte Schrittliste', () => {
  // Bestand mit guidance 'Alt.', Import mit 'Neu.' → Vorlage im Plan als geändert (Muster der bestehenden steps-Ersetzen-Tests)
});
```

Die beiden Plan-Tests nach dem Muster des vorhandenen Tests `'legt eine neue geführte Vorlage mit bereinigten Schritten an'` ausformulieren (dieselben Helfer, dieselbe Art der Erwartung).

In `export.test.ts`: Rundlauf einer Vorlage mit `steps: [{ name: 'Beispiel A', seconds: 40, guidance: 'Erfundener Beispieltext.' }]`, einer Session mit `guided.steps[0].guidanceSeconds: 15` und Settings mit `guidedGuidance: true` – alle drei Werte kommen unverändert zurück (Muster der vorhandenen `steps`-/`guidedAudioMode`-Rundläufe).

- [ ] **Step 2:** `npx vitest run src/domain/library-import.test.ts src/lib/export.test.ts` → FAIL.
- [ ] **Step 3:** Schema: `guidance: z.string({ invalid_type_error: 'Die Anleitung muss Text sein.' }).refine((v) => countChars(v.trim()) <= 600, 'Die Anleitung darf höchstens 600 Zeichen lang sein.').optional()`. `normalizeGuidedSteps`: `const guidance = optionalText(step.guidance)` und `...(guidance && { guidance })` nach `spokenName`. `export.ts`: `guidance: z.string().optional()`, `guidanceSeconds: z.number().int().positive().optional()` in `guidedStepSchema`; `guidedGuidance: z.boolean().optional()` im Settings-Schema.
- [ ] **Step 4: Format-Doku** – Tabellenzeile `guidance` · nein · Klartext · „Die gesprochene Anleitung, siehe unten. Kein Markdown, höchstens 600 Zeichen.“; neuer Absatz „**Anleitungen (`guidance`).**“ mit den Regeln aus Spec Abschnitt 2 (Reihenfolge Einstieg → worauf achten → was spüren → typischer Fehler; Regeln wie `spokenName`; kein Name/Seite/Dauer/„Als Nächstes“; bei beidseitig für die erste Seite; verlängert nur eingeschaltet den Wechsel, `seconds` bleibt Haltezeit; ganze Liste schicken, `guidance` steht in `bestand.json`). Im JSON-Beispiel bei „Herabschauender Hund“ (dort steht schon ein `hint`) ein `guidance` mit allgemeinem Text ergänzen.
- [ ] **Step 5:** `npx vitest run src/domain/library-import.test.ts src/lib/export.test.ts src/domain/import-format.test.ts src/domain/library-inventory.test.ts` → PASS. (`library-inventory.ts` kopiert Schritte ganz; `guidance` kommt ohne Änderung in `bestand.json` – falls es dort einen Snapshot-Test gibt, bleibt er grün.)
- [ ] **Step 6:** Commit (nach Freigabe): `feat: Anleitung im Import, im Format und im Backup`.

---

### Task 4: Messen und Speichern

**Files:**
- Modify: `src/lib/announcement-audio.ts` (neue Funktion)
- Modify: `src/db/tts-actions.ts:181-200` (`saveAnnouncement`)
- Modify: `src/db/announcement-actions.ts` (`loadGuidedTexts`, `findMissingTexts`, `generateAnnouncements`, Optionen)
- Test: `src/db/announcement-actions.test.ts`, `src/db/tts-actions.test.ts`

**Interfaces:**
- Consumes: `requiredGuidanceTexts` (Task 2), `Announcement.durationMs` (Task 1).
- Produces:
  - `measureAudioDuration(data: ArrayBuffer): Promise<number | null>` in `src/lib/announcement-audio.ts` – dekodiert eine **Kopie** (`data.slice(0)`) mit `new OfflineAudioContext(1, 1, 44_100)`; Ergebnis `Math.round(buffer.duration * 1000)`; `null` ohne `OfflineAudioContext` oder bei Fehler. Wirft nie.
  - `saveAnnouncement(text: string, voice: string, blob: Blob, durationMs?: number): Promise<void>` – wie heute, mit `durationMs` im Datensatz, wenn übergeben. Ein vorhandener Datensatz **ohne** `durationMs` wird ersetzt, wenn jetzt eine Dauer übergeben wird; sonst bleibt er.
  - `GenerateAnnouncementsOptions.measure?: (data: ArrayBuffer) => Promise<number | null>` (Standard `measureAudioDuration`).
  - intern `loadGuidedTexts(templateIds, now): Promise<{ texts: string[]; guidanceTexts: string[] }>` – `texts` wie heute; `guidanceTexts` = `requiredGuidanceTexts` der Vorlagenschritte **und** der am Tag wirksamen Schritte (`resolveGuidedSteps`), dedupliziert.
  - intern `findMissingTexts(texts, voice, guidanceTexts = [])` – fehlend ist: kein Datensatz; bei `guidanceTexts` zusätzlich: Datensatz ohne `durationMs`.

- [ ] **Step 1: Failing tests** in `announcement-actions.test.ts`, neues `describe('Anleitung')` (Fixtures dort: `seed`, `blob`, `KEY`, `ONLINE`):

```ts
const GUIDE = 'Erfundener Beispieltext zum Einstieg.';
const G: GuidedStep[] = [
  { name: 'Beispiel A', seconds: 40, guidance: GUIDE },
  { name: 'Beispiel B', seconds: 30 },
];
const GUIDED_TEXT = `Als Nächstes: Beispiel A, 40 Sekunden. ${GUIDE}`;

it('erzeugt beide Varianten und speichert die gemessene Dauer', async () => {
  await seed('g', G);
  await saveApiKey(KEY);
  const result = await generateAnnouncements(['g'], {
    synth: async () => blob(), isOnline: ONLINE, measure: async () => 12_000,
  });
  // 2 Sätze ohne Anleitung + Geschafft. + 1 Satz mit Anleitung
  expect(result).toMatchObject({ status: 'complete', generated: 4 });
  expect((await db.announcements.get(announcementKey(GUIDED_TEXT, VOICE)))?.durationMs).toBe(12_000);
});

it('erzeugt einen Anleitungssatz ohne Dauer beim nächsten Lauf neu und speichert ihn mit Dauer', async () => {
  await seed('g', G);
  await saveApiKey(KEY);
  await generateAnnouncements(['g'], { synth: async () => blob(), isOnline: ONLINE, measure: async () => null });
  expect((await db.announcements.get(announcementKey(GUIDED_TEXT, VOICE)))?.durationMs).toBeUndefined();

  const second = await generateAnnouncements(['g'], {
    synth: async () => blob(), isOnline: ONLINE, measure: async () => 9_000,
  });
  expect(second).toMatchObject({ status: 'complete', generated: 1 });
  expect((await db.announcements.get(announcementKey(GUIDED_TEXT, VOICE)))?.durationMs).toBe(9_000);
});

it('braucht für Sätze ohne Anleitung keine Dauer', async () => {
  await seed('a', A);                     // vorhandene Fixture ohne guidance
  await saveApiKey(KEY);
  await generateAnnouncements(['a'], { synth: async () => blob(), isOnline: ONLINE, measure: async () => null });
  expect(await generateAnnouncements(['a'], { synth: async () => blob(), isOnline: ONLINE }))
    .toMatchObject({ status: 'complete', generated: 0 });
});
```

In `tts-actions.test.ts`: `saveAnnouncement` ersetzt einen Datensatz ohne `durationMs`, wenn eine Dauer kommt; ein Datensatz **mit** Dauer bleibt beim zweiten Speichern unverändert.

- [ ] **Step 2:** `npx vitest run src/db/announcement-actions.test.ts src/db/tts-actions.test.ts` → FAIL.
- [ ] **Step 3:** Implementieren. In `generateAnnouncements` nach der Synthese: `const audio = await readBlobBuffer(blob)` ist heute in `saveAnnouncement` – messen auf `await blob.arrayBuffer()` **vor** `saveAnnouncement`, Ergebnis als `durationMs` übergeben (nur wenn nicht `null`). Messen nur für `guidanceTexts` ist nicht nötig – alle neu erzeugten Sätze werden gemessen. Kontingent und Rückfrage rechnen wie heute über `missing`.
- [ ] **Step 4:** `npx vitest run src/db` → PASS (die bestehenden Tests ohne `measure` laufen in jsdom mit `null`-Messung weiter).
- [ ] **Step 5:** Commit (nach Freigabe): `feat: Anleitungsansagen erzeugen und messen`.

---

### Task 5: Verfügbarkeit mit Anleitung

**Files:**
- Modify: `src/db/announcement-actions.ts` (`AnnouncementAvailability`, `describeAvailability`, `getAnnouncementAvailability`; neue Funktion)
- Test: `src/db/announcement-actions.test.ts`

**Interfaces:**
- Consumes: `applyGuidance`, `requiredGuidanceTexts` (Task 2), `resolveGuidedSections`, `sumGuidedSeconds` (`guided-steps.ts`), `loadGuidedTexts` (Task 4).
- Produces:
  - `AnnouncementAvailability.guidance: { available: boolean; complete: boolean; totalSeconds?: number }` – `available`: ein wirksamer Schritt hat eine Anleitung; `complete`: alle Anleitungssätze der **wirksamen** Schritte da und mit Dauer; `totalSeconds`: nur bei `complete`, `sumGuidedSeconds(resolveGuidedSections(applyGuidance(wirksam, dauern)))`.
  - `loadGuidanceDurations(texts: readonly string[], voice: string): Promise<Map<string, number>>` (exportiert; nur Sätze mit Datensatz **und** `durationMs`).
  - `getStepsAnnouncementAvailability(steps)` liefert `guidance: { available: false, complete: false }` (der Snapshot braucht ihn nicht; seine Sätze enthalten die Anleitung schon).

- [ ] **Step 1: Failing tests**:

```ts
it('meldet die Anleitung als verfügbar, vollständig und mit Gesamtdauer', async () => {
  await seed('g', G);
  expect((await getAnnouncementAvailability('g')).guidance).toEqual({ available: true, complete: false });
  await saveApiKey(KEY);
  await generateAnnouncements(['g'], { synth: async () => blob(), isOnline: ONLINE, measure: async () => 12_000 });
  // Wechsel 15 + 40 + Wechsel 5 + 30 = 90
  expect((await getAnnouncementAvailability('g')).guidance).toEqual({ available: true, complete: true, totalSeconds: 90 });
});

it('kennt keine Anleitung bei Vorlagen ohne guidance', async () => {
  await seed('a', A);
  expect((await getAnnouncementAvailability('a')).guidance).toEqual({ available: false, complete: false });
});

it('misst bei einer Schrittanpassung den wirksamen Satz', async () => {
  // Muster aus describe('Ansagen bei einer Schrittanpassung'): Einschränkung setzt Beispiel A am Tag auf 20 s.
  // Nach generateAnnouncements (measure 12_000) ist guidance.complete true und totalSeconds = 15 + 20 + 5 + 30 = 70.
});
```

- [ ] **Step 2:** `npx vitest run src/db/announcement-actions.test.ts` → FAIL.
- [ ] **Step 3:** Implementieren; `getAnnouncementAvailability` braucht dafür die wirksamen Schritte – `loadGuidedTexts` gibt sie für eine einzelne Vorlage zusätzlich zurück (`effectiveSteps`), statt sie ein zweites Mal aufzulösen.
- [ ] **Step 4:** `npx vitest run src/db` → PASS.
- [ ] **Step 5:** Commit (nach Freigabe): `feat: Verfügbarkeit der Anleitung`.

---

### Task 6: Start mit Anleitung

**Files:**
- Modify: `src/db/guided-session-actions.ts:38-41` (`StartGuidedOptions`), `:72-150` (`startGuidedSession`)
- Modify: `src/db/settings-actions.ts` (neben `setGuidedAudioMode`)
- Test: `src/db/guided-session-actions.test.ts`

**Interfaces:**
- Consumes: `applyGuidance`, `requiredGuidanceTexts` (Task 2), `loadGuidanceDurations` (Task 5), `readTtsSettings`.
- Produces:
  - `StartGuidedOptions.guidance?: boolean` – gewünscht; fehlt es, gilt `AppSettings.guidedGuidance ?? false`.
  - `setGuidedGuidance(enabled: boolean): Promise<void>` in `settings-actions.ts` (schreibt immer explizit).
  - Snapshot: Ist `audioMode === 'voice'`, die Anleitung gewünscht und `applyGuidance(steps, dauern)` nicht `null`, sind `guided.steps` die Schritte daraus; sonst wie heute (ohne `guidanceSeconds`). Die Dauern werden **vor** der Transaktion geladen.
  - Gemerkt wird `guidedGuidance` nur, wenn `options.guidance` übergeben **und** erfüllt wurde – dieselbe Regel wie `audioMode` (`options.audioMode && audioMode === wanted`).

- [ ] **Step 1: Failing tests** (neues `describe("startGuidedSession mit Anleitung")`; Ansagen mit `generateAnnouncements(…, { measure: async () => 12_000 })` vorbereiten, Vorlage mit `{ name: 'Beispiel A', seconds: 40, guidance: GUIDE }, { name: 'Beispiel B', seconds: 30 }`):
  - mit `{ audioMode: 'voice', guidance: true }` → `guided.steps[0].guidanceSeconds === 15`, `'guidanceSeconds' in guided.steps[1] === false`, `settings.guidedGuidance === true`.
  - mit `{ audioMode: 'tone', guidance: true }` → kein `guidanceSeconds`, `guidedGuidance` bleibt unverändert.
  - ohne Messung (`measure: async () => null`) und `{ audioMode: 'voice', guidance: true }` → `audioMode: 'voice'`, kein `guidanceSeconds`, `guidedGuidance` unverändert.
  - ohne Option, `guidedGuidance: true` in den Settings → Anleitung an.
  - mit einer Schrittanpassung (Muster aus `describe("Einschränkungen beim Start")`, Beispiel A auf 20 s) → `guidanceSeconds` 15, `seconds` 20.
  - `getStepsAnnouncementAvailability(session.guided.steps).complete === true` (die Pille im Ablauf findet die Sätze mit Anleitung).
- [ ] **Step 2:** `npx vitest run src/db/guided-session-actions.test.ts` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `npx vitest run src/db` → PASS; die bestehenden `toEqual`-Snapshots in `startGuidedSession` bleiben unverändert (kein neues Feld ohne Anleitung).
- [ ] **Step 5:** Commit (nach Freigabe): `feat: geführte Einheit mit Anleitung starten`.

---

### Task 7: Eine laufende Ansage, Stopp im Ablauf

**Files:**
- Modify: `src/lib/sound.ts:270-283` (`playAudioBufferWhenAwake`), `src/lib/announcement-audio.ts` (`playDecodedAnnouncement`, neue Funktion)
- Modify: `src/pages/GuidedRunPage.tsx` (Effekte bei Z. ~221-247)
- Test: `src/lib/sound.test.ts`

**Interfaces:**
- Produces:
  - `sound.ts` hält höchstens eine laufende Ansage (`AudioBufferSourceNode`); `playAudioBufferWhenAwake` stoppt eine laufende, bevor es startet.
  - `stopAnnouncement(): void` in `sound.ts` (re-exportiert aus `announcement-audio.ts` neben `playDecodedAnnouncement`) – stoppt die laufende Ansage, still bei Fehlern.
  - `GuidedRunPage` ruft `stopAnnouncement()`, wenn sich `state.sectionIndex` ändert, bei `state.phase === 'paused'` oder `'finished'`, bei `audioMode === 'tone'` und im Cleanup beim Verlassen.

- [ ] **Step 1: Failing tests** in `sound.test.ts` – `FakeAudioContext.createBufferSource` um `stop` (zählt Aufrufe) erweitern; Kontext `running`:
  - zweite `playAudioBufferWhenAwake` stoppt die erste Quelle (`stop` 1-mal an Quelle 1).
  - `stopAnnouncement()` stoppt die laufende; ein zweiter Aufruf tut nichts.
  - wirft `stop` (Quelle schon beendet), bleibt es still.
- [ ] **Step 2:** `npx vitest run src/lib/sound.test.ts` → FAIL.
- [ ] **Step 3:** Implementieren; im Ablauf eigenes `useEffect` auf `[state.sectionIndex, state.phase, audioMode]` mit `stopAnnouncement()` **vor** dem Ansage-Effekt deklarieren, damit beim Abschnittswechsel erst gestoppt und dann die neue Ansage gespielt wird; Cleanup-Effekt `useEffect(() => () => stopAnnouncement(), [])`.
- [ ] **Step 4:** `npx vitest run src/lib/sound.test.ts && npm run check` → PASS; `npx playwright test e2e/guided-voice.spec.ts e2e/guided-controls.spec.ts` → PASS (Regression).
- [ ] **Step 5:** Commit (nach Freigabe): `feat: laufende Ansage beim Abschnittswechsel stoppen`.

---

### Task 8: Start-Screen und „i“

**Files:**
- Modify: `src/pages/GuidedStartPage.tsx` (Ton-Wahl ab Z. ~300, Fakten Z. ~283, `handleStart` Z. 96-125, Info-Knopf-Bedingung Z. ~240, Dialog Z. ~430)
- Modify: `src/components/GuidedHintDialog.tsx` (Props, Inhalt Z. ~91)
- Modify: `src/pages/GuidedRunPage.tsx` (Z. 311 `hint`, Z. 523, Z. 739 Info-Knopf-Bedingung)
- Modify: `src/domain/guided-steps.ts` (`describeGuidedFacts`)
- Test: `src/domain/guided-steps.test.ts`

**Interfaces:**
- Consumes: `AnnouncementAvailability.guidance` (Task 5), `StartGuidedOptions.guidance` (Task 6), `AppSettings.guidedGuidance`.
- Produces:
  - `describeGuidedFacts(steps, options?: { totalSeconds?: number; withGuidance?: boolean }): string[]` – mit `totalSeconds` ersetzt es die gerechnete Dauer; mit `withGuidance` heißt die Pill `≈ {n} min mit Anleitung`.
  - `GuidedHintDialog` Props: `hint?: string; guidance?: string` (mindestens eins gesetzt). Ohne `hint` steht nur die Anleitung. Überschrift „Anleitung“: `text-[10px] font-bold uppercase tracking-[0.16em] text-accent-contrast/60`, Text `text-[15px] leading-[1.4]`, Anker `data-guided-guidance-text`. Die Karte scrollt als Ganzes, wenn der Text lang ist.
  - Info-Knopf (Start-Screen und Ablauf): sichtbar bei `step.hint || step.guidance`.
  - Schalter: `<button role="switch" aria-checked data-guided-guidance>` direkt nach der Ton-Wahl; Text „Mit Anleitung“ / „erklärt jede Übung vorher“; Optik wie im bestätigten Mock-up (Klassen von `ToggleField` in `src/components/ui/Field.tsx`, kompakt: `mt-1 min-h-touch rounded-control bg-surface-sunken px-3 py-1 text-xs`). Sichtbar nur bei `voiceSelected && availability.guidance.available`; `disabled` ohne `availability.guidance.complete`. Lokale Wahl wie `choice`, vorbelegt aus `guidedGuidance ?? false`.
  - `handleStart` übergibt `guidance: guidanceSelected` nur, wenn der Schalter sichtbar und wählbar ist.

- [ ] **Step 1: Failing test** in `guided-steps.test.ts`:

```ts
it('nennt die Dauer mit Anleitung', () => {
  const steps = [{ name: 'Beispiel A', seconds: 300 }];
  expect(describeGuidedFacts(steps, { totalSeconds: 480, withGuidance: true }))
    .toEqual(['1 Schritt', '≈ 8 min mit Anleitung']);
});
```

- [ ] **Step 2:** `npx vitest run src/domain/guided-steps.test.ts` → FAIL.
- [ ] **Step 3:** `describeGuidedFacts` erweitern; Start-Screen, Dialog und Ablauf wie in Interfaces umbauen. Der Ablauf übergibt `guidance={step.guidance}` an den Dialog.
- [ ] **Step 4:** `npx vitest run && npm run check && npm run lint` → PASS.
- [ ] **Step 5:** Commit (nach Freigabe): `feat: Schalter „Mit Anleitung“ und Anleitung hinter dem „i“`.

---

### Task 9: e2e und Doku

**Files:**
- Modify: `e2e/helpers.ts` (neuer Helfer)
- Create: `e2e/guided-guidance.spec.ts`
- Modify: `docs/architecture/guided-templates.md`, `.claude/skills/gym-book-architect/SKILL.md`, `.trae/skills/gym-book-pwa-architect/SKILL.md`, `CLAUDE.md` (Anker-Liste der geführten Bühne)

**Interfaces:**
- Consumes: alles aus Task 1–8; Anker `data-guided-guidance`, `data-guided-guidance-text`, `data-guided-remaining`, `data-guided-section`.
- Produces: `silentWavBase64(seconds: number): string` in `e2e/helpers.ts` – eine stille WAV (PCM, mono, 8 kHz, 8 bit) als Base64. WebKit dekodiert WAV mit `decodeAudioData`, also liefert die abgefangene Google-Antwort eine echte, messbare Dauer, ohne Test-Hook im Produktcode.

- [ ] **Step 1: Spec schreiben** – `e2e/guided-guidance.spec.ts` nach dem Muster von `guided-voice.spec.ts` (Schlüssel-Platzhalter, Google abfangen, Import über `#/sync`, Start über das Jetzt-Sheet), Google antwortet mit `{ audioContent: silentWavBase64(10) }`; Vorlage „Beispiel-Mobility“ mit `[{ name: 'Beispiel A', seconds: 4, guidance: 'Erfundener Beispieltext.' }, { name: 'Beispiel B', seconds: 4 }]`:
  - Start-Screen: bei „Nur Ton“ kein `[data-guided-guidance]`; bei „Stimme + Ton“ sichtbar, wählbar, Höhe ≥ 44 px; eingeschaltet zeigt die Dauer-Pill „mit Anleitung“.
  - Ohne Schlüssel (keine Ansagen): „Stimme + Ton“ gesperrt und kein `[data-guided-guidance]` (der Schalter erscheint nur bei gewählter Stimme).
  - Ablauf mit Anleitung: erster Abschnitt `data-guided-section="transition"` mit `data-guided-remaining` > 5 (Wechsel 13 s = ⌈0,7 + 10 + 2⌉, die Uhr läuft schon); „Jetzt starten“ wechselt sofort zu `exercise`.
  - „i“ bei Beispiel A zeigt `[data-guided-guidance-text]` mit dem Text – auch wenn der Schritt keinen `hint` hat.
- [ ] **Step 2:** Dev-Server auf 5173 beenden (`lsof -i :5173`), dann `npx playwright test e2e/guided-guidance.spec.ts` → PASS auf beiden iPhone-Größen.
- [ ] **Step 3: Doku** – `guided-templates.md`: neuer Abschnitt „Gesprochene Anleitung“ (Feld `guidance`, Snapshot-Feld `guidanceSeconds`, Messung `durationMs`, Formel, Zeitachse, Stopp im Player, Schalter, Anker). Architekturvertrag in `.claude/` **und** `.trae/`: v1-Umfang „guided session (… optional spoken announcements and spoken guidance)“. `CLAUDE.md`: `data-guided-guidance-text` in die Anker-Liste.
- [ ] **Step 4: Gesamtprüfung** – `npm run lint && npm run check && npm run check:strict && npm test && npm run build && npm run test:e2e && npm run privacy` → alles grün, Wächter ohne Treffer.
- [ ] **Step 5:** Commit (nach Freigabe): `test: Anleitung im Ablauf; docs: gesprochene Anleitung`.
