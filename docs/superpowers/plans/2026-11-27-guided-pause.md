# Pausen im geführten Ablauf – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Wechsel mit geplant ≥ 15 s erscheint als helle „PAUSE“, ein Wechsel mit tatsächlich ≥ 15 s endet mit Countdown-Tönen, und der Pausieren-Knopf ist nur noch ⏸.

**Architecture:** Die Pause-Regel lebt einmal in `guided-steps.ts` (`isGuidedPause`, Feld `pause` an Wechsel-Abschnitten). Die Töne sind weitere fällige Signale aus `deriveGuidedRunState` (rein, ohne Uhr); der Run-Screen spielt sie je `kind`. Die Bühne bekommt zwei CSS-Variablen für Vorder- und Hintergrund, damit derselbe Run-Screen auf Tinte und auf Papier steht.

**Tech Stack:** React 18, TypeScript, Tailwind 3.4, Vitest (jsdom), Playwright (WebKit, iPhone SE + iPhone 13).

**Spec:** `docs/superpowers/specs/2026-11-27-guided-pause-design.md`

## Global Constraints

- Top rule: keine persönlichen Daten in Dateien. Testdaten erkennbar erfunden („Beispiel A“, „Beispiel B“); keine echten Übungsnamen aus Screenshots des Nutzers.
- UI-Texte und Kommentare deutsch mit echten Umlauten; Zahlen über `formatNumber` / `formatStepClock`.
- Touch-Ziele ≥ 44 px; Text-Kontrast ≥ 4,5:1 auf beiden Bühnen. Limette nie als Text auf Papier.
- `GUIDED_PAUSE_MIN_SECONDS = 15` – gegen die **geplante** Länge für die Pause, gegen die **tatsächliche** (`section.seconds`) für den Countdown.
- `GUIDED_COUNT_MAX_DELAY_MS = 600`; `GUIDED_GUIDANCE_PAD_SECONDS = 4`.
- Countdown-Ton ≈ 0,12 s, 880 Hz; Start-Ton ≈ 0,45 s, 1174,7 Hz. Übungsende-Signal bleibt 0,4 s, 784 Hz.
- Import-Format, Datenmodell, Dexie-Version, Backup-Schema, Ansagen-Texte bleiben unverändert.
- **Kein Commit, kein Push** ohne ausdrückliches Okay des Nutzers. Der Arbeitsbaum enthält bereits drei uncommittete Fixes und zwei unversionierte Spec/Plan-Paare; die „Commit“-Stellen der Tasks sind hier „Stand prüfen“ (`git status`, `npm run privacy`). Nie `--no-verify`.

## Review Focus

1. **„Sofort starten“ kurz vor Ablauf:** `startNow` springt auf den Anfang der Übung – genau dort liegt der Start-Ton-Zeitpunkt (Verspätung 0). Erwartet: kein Start-Ton. → Test in Task 2.
2. **Pausieren mitten im Countdown, Weiter nach Minuten:** Erwartet: die restlichen Töne kommen zur richtigen Restzeit, kein verpasster Ton wird nachgeholt. → Test in Task 2.
3. **„Zurück“ in einen schon gelaufenen Wechsel:** Erwartet: Countdown klingt erneut (neuer Schlüssel mit `rewinds`). → Test in Task 2.
4. **Erster Schritt pausiert (Einschränkung) auf dem Start-Screen:** Der erste *gespielte* Schritt hat fest 5 s Wechsel; eine Pausenzeile davor wäre falsch. → Test in Task 7.
5. **Pausiert in einer Pause, dann Hinweis-/Beenden-Dialog:** Erwartet: Bühne bleibt hell, Dialoge bleiben lesbar (sie sind dunkel und liegen über der Bühne). → e2e in Task 6.

---

### Task 1: Pause-Markierung an der Zeitachse

**Files:**
- Modify: `src/domain/guided-steps.ts` (Konstante, `isGuidedPause`, `GuidedSection.pause`, `resolveGuidedSections`)
- Test: `src/domain/guided-steps.test.ts`

**Interfaces:**
- Produces: `export const GUIDED_PAUSE_MIN_SECONDS = 15`; `export function isGuidedPause(steps: readonly GuidedStep[], stepIndex: number): boolean` (= `plannedTransitionSeconds(steps, stepIndex) >= GUIDED_PAUSE_MIN_SECONDS`); `GuidedSection.pause?: boolean` – gesetzt (`true`/`false`) nur bei `kind: 'transition'`.

- [ ] **Step 1: Failing tests** in `guided-steps.test.ts`, `describe('Pause-Markierung')`:

```ts
const steps = [
  { name: 'Beispiel A', seconds: 30 },
  { name: 'Beispiel B', seconds: 30, transitionSeconds: 14 },
  { name: 'Beispiel C', seconds: 30, transitionSeconds: 15 },
  { name: 'Beispiel D', seconds: 30, transitionSeconds: 45, bothSides: true },
  { name: 'Beispiel E', seconds: 30, guidanceSeconds: 25 },
];
it('markiert Wechsel ab geplant 15 s als Pause, den ersten nie', () => {
  const transitions = resolveGuidedSections(steps).filter((s) => s.kind === 'transition');
  expect(transitions.map((s) => s.pause)).toEqual([false, false, true, true, false]);
});
it('lässt Seitenwechsel und Übungen ohne Markierung', () => {
  const others = resolveGuidedSections(steps).filter((s) => s.kind !== 'transition');
  expect(others.every((s) => s.pause === undefined)).toBe(true);
});
it('isGuidedPause: der erste Schritt ist fest 5 s, auch mit transitionSeconds 45', () => {
  expect(isGuidedPause([{ name: 'Beispiel A', seconds: 30, transitionSeconds: 45 }], 0)).toBe(false);
});
```

- [ ] **Step 2:** `npx vitest run src/domain/guided-steps.test.ts` → FAIL (`isGuidedPause` nicht exportiert / `pause` undefined).
- [ ] **Step 3: Implementieren.** `GuidedSection.pause` mit Kommentar („nur am Wechsel; geplante Länge, nicht die Anleitung“); im `push` des Wechsels `pause: isGuidedPause(steps, stepIndex)`. Der Kommentar an `GuidedSectionKind` („wer nur zwischen Übung und Pause unterscheidet …“) wird auf die neue Bedeutung von „Pause“ angepasst. `layOut` in `guided-run.ts` kopiert Abschnitte per Spread – das Feld kommt mit, nichts zu tun.
- [ ] **Step 4:** Test grün; `npx vitest run src/domain` grün (bestehende `toEqual` auf ganze Abschnitte bekommen `pause: false` – solche Erwartungen anpassen, nicht die Implementierung).
- [ ] **Step 5: Stand prüfen** – `npm run check && npm run check:strict`.

### Task 2: Countdown- und Start-Signale

**Files:**
- Modify: `src/domain/guided-run.ts` (`GuidedDueSignal`, `Timeline`, `foldTimeline` Fall `startNow`, `findDueSignal`)
- Test: `src/domain/guided-run.test.ts`

**Interfaces:**
- Consumes: `GUIDED_PAUSE_MIN_SECONDS` (Task 1).
- Produces: `export type GuidedSignalKind = 'exercise-end' | 'count' | 'go'`; `GuidedDueSignal.kind: GuidedSignalKind`; `export const GUIDED_COUNT_MAX_DELAY_MS = 600`. Schlüssel: `pause-count:<sectionIndex>:<n>` (n = 3, 2, 1) und `pause-go:<sectionIndex>`, bei `rewinds > 0` jeweils mit `:<rewinds>` angehängt – wie `exercise-end`.

- [ ] **Step 1: Failing tests**, `describe('Countdown am Ende einer langen Pause')`. Testschritte: `[{ name: 'Beispiel A', seconds: 10 }, { name: 'Beispiel B', seconds: 10, transitionSeconds: 45 }, { name: 'Beispiel C', seconds: 10, transitionSeconds: 10 }]`. Zeitachse: Wechsel 0–5, A 5–15, Pause 15–60, B 60–70, Wechsel 70–80, C 80–90.

```ts
it('meldet 3, 2, 1 und Start', () => {
  expect(deriveGuidedRunState(S, START, at(57.1)).dueSignal).toMatchObject({ kind: 'count', key: 'pause-count:2:3' });
  expect(deriveGuidedRunState(S, START, at(58.1)).dueSignal).toMatchObject({ kind: 'count', key: 'pause-count:2:2' });
  expect(deriveGuidedRunState(S, START, at(59.1)).dueSignal).toMatchObject({ kind: 'count', key: 'pause-count:2:1' });
  expect(deriveGuidedRunState(S, START, at(60.1)).dueSignal).toMatchObject({ kind: 'go', key: 'pause-go:2' });
});
it('lässt einen Ton nach 600 ms fallen', () => {
  expect(deriveGuidedRunState(S, START, at(57.7)).dueSignal).toBeNull();
});
it('zählt einen 10-s-Wechsel nicht herunter', () => {
  expect(deriveGuidedRunState(S, START, at(77.1)).dueSignal).toBeNull();
  expect(deriveGuidedRunState(S, START, at(80.1)).dueSignal).toBeNull();
});
it('zählt einen durch die Anleitung auf 25 s gestreckten 5-s-Wechsel herunter', () => {
  const G = [{ name: 'Beispiel A', seconds: 10 }, { name: 'Beispiel B', seconds: 10, guidanceSeconds: 25 }];
  // Wechsel 0–5, A 5–15, Wechsel 15–40
  expect(deriveGuidedRunState(G, START, at(37.1)).dueSignal).toMatchObject({ kind: 'count' });
});
it('schweigt nach „Sofort starten“ – auch kein Start-Ton', () => {
  const events = [...START, { type: 'startNow', at: at(58.5) }];
  expect(deriveGuidedRunState(S, events, at(58.5)).dueSignal).toBeNull();
  expect(deriveGuidedRunState(S, events, at(58.9)).dueSignal).toBeNull();
});
it('trifft nach Pausieren und Weiter die richtige Restzeit und holt nichts nach', () => {
  const events = [...START, { type: 'pause', at: at(56.5) }, { type: 'resume', at: at(300) }];
  expect(deriveGuidedRunState(S, events, at(300.1)).dueSignal).toBeNull();
  expect(deriveGuidedRunState(S, events, at(300.6)).dueSignal).toMatchObject({ key: 'pause-count:2:3' });
});
it('klingt nach „Zurück“ erneut, mit rewinds im Schlüssel', () => {
  const events = [...START, { type: 'back', at: at(65) }]; // aus B zurück an den Anfang von Schritt A
  // nach back: Wechsel A 65–70, A 70–80, Pause 80–125 → 3 s vor Ende bei 122
  expect(deriveGuidedRunState(S, events, at(122.1)).dueSignal).toMatchObject({ key: 'pause-count:2:3:1' });
});
it('das Übungsende-Signal hat kind exercise-end', () => {
  expect(deriveGuidedRunState(S, START, at(15.1)).dueSignal).toMatchObject({ kind: 'exercise-end', key: 'exercise-end:1' });
});
```

(`back` aus Schritt B springt laut `foldTimeline` an den ersten Abschnitt von Schritt A, also auf dessen Wechsel bei Abfolge-Position 0; die Pause endet dann auf der Abfolge wieder bei 60 s, real bei 65 + 60 = 125.)

- [ ] **Step 2:** `npx vitest run src/domain/guided-run.test.ts` → FAIL.
- [ ] **Step 3: Implementieren.**
  - `Timeline.cutShort: ReadonlySet<number>` – Wechsel, die `startNow` beendet hat; im Fall `startNow` vor `jumpTo(index + 1)` `cutShort.add(index)`. `back` entfernt Einträge ≥ Ziel wie bei `skipped`.
  - `findDueSignal` sammelt Kandidaten: Übungsende (wie heute, Frische `GUIDED_SIGNAL_MAX_DELAY_MS`, `kind: 'exercise-end'`) und für jeden Abschnitt mit `kind === 'transition' && seconds >= GUIDED_PAUSE_MIN_SECONDS && !cutShort.has(i)` die Zeitpunkte Ende − 3/2/1 s (`count`) und Ende (`go`), Frische `GUIDED_COUNT_MAX_DELAY_MS`. Rückgabe: der Kandidat mit der kleinsten Verspätung.
  - Kommentar an `findDueSignal` um die neuen Signale ergänzen.
- [ ] **Step 4:** Tests grün; `npx vitest run src/domain` grün (bestehende `toEqual` auf `dueSignal` um `kind: 'exercise-end'` ergänzen).
- [ ] **Step 5: Stand prüfen** – `npm run check:strict`.

### Task 3: Mehr Ruhe nach der Anleitung

**Files:**
- Modify: `src/domain/guided-announcements.ts:25`
- Test: `src/domain/guided-announcements.test.ts:116-120, 131-140`; `e2e/guided-guidance.spec.ts:172`

- [ ] **Step 1: Tests umstellen** (RED): `guidanceTransitionSeconds(5, 12_000)` → `17` (16,7 → 17); `(5, 12_400)` → `18` (17,1 → 18); `(20, 3_000)` → `20`; Testname „0,7 s + Dauer + 4 s“. In `applyGuidance`: `[17, 25, undefined]`.
- [ ] **Step 2:** `npx vitest run src/domain/guided-announcements.test.ts` → FAIL.
- [ ] **Step 3:** `GUIDED_GUIDANCE_PAD_SECONDS = 4`; Kommentar: „Ruhe nach der Anleitung – lässt Platz für den Countdown, damit er nie in die Stimme fällt.“
- [ ] **Step 4:** Unit grün. In `e2e/guided-guidance.spec.ts` die Restzeit-Erwartung an Zeile 172 aus der Zeitachse des Tests neu ableiten (die Wechsel werden 2 s länger) und `npx playwright test e2e/guided-guidance.spec.ts` grün.
- [ ] **Step 5: Stand prüfen.**

### Task 4: Klänge und Abspielen je Signal-Art

**Files:**
- Modify: `src/lib/sound.ts` (zwei Ton-Listen, zwei Funktionen), `src/pages/GuidedRunPage.tsx:207-217` (Signal-Wirkung)
- Test: `src/lib/sound.test.ts`

**Interfaces:**
- Consumes: `GuidedDueSignal.kind` (Task 2).
- Produces: `export function playGuidedCountTone(): void`, `export function playGuidedGoTone(): void` – beide wie `playGuidedSignal` (`setAmbientAudioSession()` + `playTonesWhenAwake`).

- [ ] **Step 1: Failing tests** in `sound.test.ts`, nach dem Muster von `describe('playGuidedSignal')`: je Funktion „setzt ambient und spielt genau einen Ton“ (`startedOscillators === 1`). Wenn `FakeAudioContext` die Frequenz nicht festhält, ergänzt der Test-Fake `frequencies: number[]` und die Tests prüfen `880` bzw. `1174.7`.
- [ ] **Step 2:** `npx vitest run src/lib/sound.test.ts` → FAIL.
- [ ] **Step 3:** `GUIDED_COUNT_TONES = [{ offsetSeconds: 0, durationSeconds: 0.12, frequency: 880 }]`, `GUIDED_GO_TONES = [{ offsetSeconds: 0, durationSeconds: 0.45, frequency: 1174.7 }]` mit Kommentar (unterscheidbar vom Übungsende und vom Timer-Doppelton). In `GuidedRunPage` merkt sich die Wirkung weiter den Schlüssel und ruft je `state.dueSignal.kind` `playGuidedSignal` / `playGuidedCountTone` / `playGuidedGoTone` (Abhängigkeit bleibt der Schlüssel; die Art aus demselben Signal lesen).
- [ ] **Step 4:** `npx vitest run src/lib` grün; `npm run lint && npm run check`.
- [ ] **Step 5: Stand prüfen.**

### Task 5: Bühnenfarben als Variablen (ohne sichtbare Änderung)

**Files:**
- Modify: `tailwind.config.js` (Farbe `stage`), `src/components/GuidedStage.tsx`, `src/pages/GuidedRunPage.tsx` (Klassen)
- Test: `src/components/GuidedStage.test.tsx`

**Interfaces:**
- Produces: Tailwind-Farben `stage-fg` = `rgb(var(--stage-fg) / <alpha-value>)`, `stage-bg` = `rgb(var(--stage-bg) / <alpha-value>)`. `GuidedStage` setzt beide als Inline-Style: `dark` → fg `242 242 239`, bg `12 18 16`; `light` → fg `12 18 16`, bg `242 242 239`. Die Bühnen-Grundklassen bleiben (`bg-accent text-accent-contrast` bzw. `bg-app text-content`), damit der Start-Screen unverändert ist.

- [ ] **Step 1: Failing tests** in `GuidedStage.test.tsx`: dunkel → `stage.style.getPropertyValue('--stage-fg')` ist `'242 242 239'`, `--stage-bg` `'12 18 16'`; hell umgekehrt.
- [ ] **Step 2:** `npx vitest run src/components/GuidedStage.test.tsx` → FAIL.
- [ ] **Step 3: Implementieren.** Konstanten `STAGE_INK_RGB = '12 18 16'`, `STAGE_PAPER_RGB = '242 242 239'` in `GuidedStage.tsx` (Kommentar: dieselben Werte wie `accent` / `accent-contrast`). In `GuidedRunPage.tsx` **alle** `accent-contrast` → `stage-fg` und `accent` (als Grund/Ring-Offset) → `stage-bg`, auch in den Klassen-Konstanten (`PAPER_BUTTON_CLASSES`, `PLUS_CLASSES`, `ROUND_ICON_CLASSES`, `SOFT_BUTTON_CLASSES`, `CAPTION_CLASSES`, `RunTop`, `AudioPill`, `ProgressSegments`, `InfoButton`, `CountdownRing`). `highlight` bleibt. `GuidedHintDialog`, `GuidedEndDialog` und der Abschluss-Screen bleiben bei den festen Tokens (dunkle Dialoge auf jeder Bühne).
- [ ] **Step 4:** Unit grün; `npx playwright test e2e/guided-run.spec.ts e2e/guided-controls.spec.ts e2e/guided-pause.spec.ts` grün (keine sichtbare Änderung erwartet).
- [ ] **Step 5: Stand prüfen** – `npm run lint && npm run build`.

### Task 6: Der Pausen-Screen

**Files:**
- Modify: `src/pages/GuidedRunPage.tsx` (Ton der Bühne, `PauseLeft`, Ring, `describeMeta`, Pausieren-Knopf, Pausiert-Caption)
- Modify: `e2e/guided-pause.spec.ts` (Knopfname)
- Create: `e2e/guided-break.spec.ts`
- Modify: `docs/architecture/guided-templates.md`, `CLAUDE.md` (Anker)

**Interfaces:**
- Consumes: `GuidedSection.pause` (Task 1), `stage-fg`/`stage-bg` (Task 5).
- Produces: Anker `data-guided-pause="true"` am `data-guided-run`-Element, solange `current.pause` (laufend und pausiert); Bühne `data-guided-tone="light"` dann.

- [ ] **Step 1: Failing e2e** `e2e/guided-break.spec.ts` (Aufbau wie `guided-pause.spec.ts`: Import per JSON, Termin heute, `page.clock`). Vorlage „Beispiel-Pausen“: `[{ name: 'Beispiel A', seconds: 4 }, { name: 'Beispiel B', seconds: 4, transitionSeconds: 20 }, { name: 'Beispiel C', seconds: 4 }]` → Wechsel 0–5, A 5–9, Pause 9–29, B 29–33, Wechsel 33–38, C 38–42.
  - `test('eine lange Pause steht hell mit PAUSE, ein kurzer Wechsel bleibt dunkel')`: bei 2 s `data-guided-tone` `dark`, kein `data-guided-pause`, Text „PAUSE“ fehlt; bei 12 s `data-guided-tone` `light`, `data-guided-pause="true"`, Bühne enthält „PAUSE“, „Danach“, „Beispiel B“, Meta „Pause · noch“; bei 35 s wieder `dark`, Meta „Wechsel · noch“.
  - `test('Pausieren in der Pause friert ein und bleibt hell')`: bei 12 s `getByRole('button', { name: 'Pausieren' })` klicken → Phase `paused`, Tone `light`, `data-guided-pause="true"`, Text „Pausiert“ (sr-only) vorhanden; Hinweis-Dialog öffnen, falls B einen `hint` trägt (im Fixture `hint: 'Erfundener Beispieltext.'` an B setzen) – Dialogtext sichtbar; „Weiter“ → Tone `light`, Phase `transition`.
  - `test('der Pausieren-Knopf zeigt nur das Symbol')`: in der Übung (6 s) hat der Knopf den Namen „Pausieren“ und keinen sichtbaren Text (`toHaveText('')`).
- [ ] **Step 2:** `npx playwright test e2e/guided-break.spec.ts` → FAIL.
- [ ] **Step 3: Implementieren.**
  - `tone = current?.pause ? 'light' : 'dark'` für Run- und Pausiert-Screen.
  - `PauseLeft` (neben `TransitionLeft`, gewählt bei `current.pause`): „PAUSE“ in Display-Schrift, extrabold, `text-[72px]`, darunter `CAPTION` „Danach“, Name (`data-guided-name`) mit Seite und `InfoButton`, Dauer wie `TransitionLeft`.
  - `CountdownRing` bekommt `tone: 'highlight' | 'ink'`; in der Pause `stroke-stage-fg` statt `stroke-highlight`.
  - `describeMeta`: `transition` mit `current.pause` → `Pause · ${rest}`.
  - Hauptknopf der Übung: nur `<Pause />`-Symbol, `aria-label="Pausieren"`; runder Knopf im Wechsel `label="Pausieren"`.
  - Pausiert-Screen: Caption „Pausiert“ → `<Pause aria-hidden />` + `<span className="sr-only">Pausiert</span>`.
  - `e2e/guided-pause.spec.ts`: `{ name: 'Pause' }` → `{ name: 'Pausieren' }` (Zeilen 80, 137, 175); die Prüfung `toContainText('Pausiert')` bleibt (sr-only-Text).
  - Doku: `guided-templates.md` – Abschnitt „Screens, lime and colour“ (helle Bühne in der Pause, Ring in Tinte, `stage-fg/-bg`) und Signale (count/go, Frische 600 ms, `cutShort`, Pad 4 s); `CLAUDE.md` – `data-guided-pause` in die Ankerliste, Hinweis „pause screen is light“ bei den Guided-Ausnahmen.
- [ ] **Step 4:** `npx playwright test e2e/guided-break.spec.ts e2e/guided-pause.spec.ts e2e/guided-run.spec.ts e2e/guided-controls.spec.ts` grün auf beiden iPhones.
- [ ] **Step 5: Kontrast prüfen** – Caption/Meta `stage-fg/60` auf Papier ≥ 4,5:1 (Tinte 60 % auf `#f2f2ef` ≈ `#686b69`, ≈ 4,8:1); falls ein Element darunter liegt, dort `/70`.

### Task 7: Pausenzeile auf Start-Screen und Detailseite

**Files:**
- Modify: `src/domain/guided-steps.ts` (Text), `src/pages/GuidedStartPage.tsx:197-260`, `src/components/GuidedStepsCard.tsx`
- Modify: `docs/claude-projekt/import-format.md` (Satz bei `transitionSeconds`)
- Test: `src/domain/guided-steps.test.ts`, `src/components/GuidedStepsCard.test.tsx`, `e2e/guided-break.spec.ts`

**Interfaces:**
- Consumes: `isGuidedPause` (Task 1).
- Produces: `export function describeGuidedPause(seconds: number): string` → `'45 s Pause'` unter 60 s, ab 60 s `'1:30 Pause'` (`formatNumber` bzw. `formatStepClock`). Anker `data-guided-step-pause` an der Zeile.

- [ ] **Step 1: Failing tests.**
  - Unit: `describeGuidedPause(45)` → `'45 s Pause'`, `(15)` → `'15 s Pause'`, `(90)` → `'1:30 Pause'`.
  - `GuidedStepsCard.test.tsx`: Schritte `[A 30 s, B 30 s transitionSeconds 45, C 30 s transitionSeconds 10]` → genau eine `[data-guided-step-pause]` mit „45 s Pause“, im Eintrag von B.
  - e2e in `guided-break.spec.ts`, `test('Start-Screen zeigt die Pause vor dem Schritt')`: auf dem Start-Screen genau eine `[data-guided-step-pause]` „20 s Pause“ im `[data-guided-step="1"]`.
  - Review Focus 4, Unit auf der Seite oder im Domain-Helfer: wenn Schritt 0 pausiert ist und Schritt 1 `transitionSeconds: 45` hat, zeigt Schritt 1 **keine** Pausenzeile (er ist der erste gespielte, fest 5 s). Dafür den Spielindex nutzen: neben `effectiveSteps` ein Array `playedIndexes` (Vorlagen-Position → Index in `resolved.steps` oder `null`) und `isGuidedPause(resolved.steps, playedIndex)`.
- [ ] **Step 2:** Tests laufen lassen → FAIL.
- [ ] **Step 3: Implementieren.** Zeile über dem Namen im `<li>` (Start-Screen und `GuidedStepsCard`): `<span data-guided-step-pause className="block text-[11px] text-content-muted">`; pausierte Schritte ohne Zeile. `GuidedStepsCard` kennt keine Einschränkungs-Auflösung – dort `isGuidedPause(steps, index)` auf den Vorlagenschritten, Zeile weg, wenn `restrictions.get(index)?.kind === 'pausiert'`. `import-format.md`: bei `transitionSeconds` „Ab 15 s gilt der Wechsel als Pause: heller Screen, Countdown-Töne am Ende.“ und das Stand-Datum der Datei aktualisieren.
- [ ] **Step 4:** `npx vitest run src/domain/guided-steps.test.ts src/components/GuidedStepsCard.test.tsx` und `npx playwright test e2e/guided-break.spec.ts` grün.
- [ ] **Step 5: Stand prüfen.**

### Task 8: Gesamtprüfung

- [ ] `npm run lint && npm run check && npm run check:strict && npm test && npm run build && npm run privacy` – alles grün, Zahlen notieren.
- [ ] Volle e2e-Suite im Hintergrund: `npm run test:e2e > <scratchpad>/e2e-pause.log 2>&1` (`run_in_background`, Timeout 2 h); Ergebnis mit Namen jedes Fehlschlags berichten.
- [ ] `git diff --stat` und Diff gezielt auf persönliche Daten prüfen; nichts committen. Dem Nutzer melden: was gebaut ist, was nur auf dem echten iPhone prüfbar ist (Klang und Lautstärke der Töne, Helligkeitswechsel abends, Statusleiste).
