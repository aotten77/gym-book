# Übungsinfo als Modal, Anleitung als Markdown – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bild und Anleitung einer Übung stehen in der Session gemeinsam in einem Vollbild-Modal; `Exercise.instructions` wird überall als kleine Markdown-Teilmenge gerendert.

**Architecture:** Ein reiner Parser in `src/lib/markdown-lite.ts` liefert einen Blockbaum, `MarkdownText` rendert ihn ohne HTML-Strings. `buildExerciseGuide` trägt die Blöcke statt Zeilen und leitet den Teaser daraus ab. Die Ausführungszeile im Sheet und das Thumbnail öffnen `ExerciseInfoDialog`, das `MediaLightbox` ersetzt und Escape in der Capture-Phase abfängt.

**Tech Stack:** React 18, TypeScript, Tailwind, Dexie, vitest (jsdom), Playwright (WebKit).

**Spec:** `docs/superpowers/specs/2026-10-03-exercise-info-modal-design.md`

## Global Constraints

- Keine neue Abhängigkeit; kein `dangerouslySetInnerHTML`.
- Keine Dexie-Version, kein `SNAPSHOT_SCHEMA_VERSION`-Bump, keine Änderung an `export.ts` oder am Bibliotheks-Import.
- Markdown nur für `Exercise.instructions`; Workout-Notizen bleiben Klartext.
- UI-Texte und Kommentare deutsch mit echten Umlauten; Imports über `@/`.
- Keine Limette im Modal (Tinte auf Papier, `bg-app`); Touch-Ziele `min-h-touch` (44px); sichtbarer Fokusring.
- `src/lib` und `src/domain` müssen `npm run check:strict` bestehen.
- Kein echtes Trainings- oder Befundmaterial ins Repo – Beispiele in Repo-Dateien sind synthetisch.
- Direkt auf `main` committen, nicht pushen.

## Review Focus

1. **Sternchen und Unterstriche im Fließtext** („3 * 5“, „Kurzhantel_rechts“) – erwartet: bleiben wörtlich, werden nicht kursiv. → Test in Task 1.
2. **Anleitung, die nur aus einer Überschrift besteht** („### Achtung“) – erwartet: Teaser fällt auf Notiz, dann Tempo, dann den Überschriftentext zurück; der Guide ist nicht `null`. → Test in Task 2.
3. **Liste, direkt gefolgt von Fließtext ohne Leerzeile** – erwartet: die Liste endet, der Text wird ein eigener Absatz statt ein angeklebter Listenpunkt. → Test in Task 1.
4. **Sehr langes Wort ohne Leerzeichen bei 320px** – erwartet: kein horizontaler Überlauf im Modal und in der Bibliothekskarte. → e2e in Task 3.
5. **Nummerierte Liste, die nicht bei 1 beginnt** („3. Dann …“) – erwartet: Nummerierung beginnt bei 3 (`start`). → Test in Task 1.

---

### Task 1: Parser `markdown-lite`

**Files:**
- Create: `src/lib/markdown-lite.ts`
- Test: `src/lib/markdown-lite.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Inline { text: string; strong?: true; emphasis?: true }
  export type MarkdownBlock =
    | { kind: 'paragraph'; lines: Inline[][] }
    | { kind: 'heading'; content: Inline[] }
    | { kind: 'list'; ordered: boolean; start: number; items: Inline[][] };
  export function parseMarkdownLite(text: string): MarkdownBlock[];
  export function toPlainText(content: Inline[]): string;
  ```
  (`start` ist gegenüber der Spec ergänzt, Review Focus 5; bei ungeordneten Listen immer `1`.)

- [ ] **Step 1: Failing tests schreiben** – `describe('parseMarkdownLite')` mit diesen Fällen (Erwartungen exakt so):
  - `'Knie ca. 90 Grad. Fuß nah am Körper.'` → `[{ kind: 'paragraph', lines: [[{ text: 'Knie ca. 90 Grad. Fuß nah am Körper.' }]] }]`
  - `'Erste Zeile\nZweite Zeile'` → ein Absatz mit zwei `lines`.
  - `'Absatz eins\n\n\nAbsatz zwei'` → zwei Absätze.
  - `'a\r\nb'` → ein Absatz, zwei Zeilen `'a'`, `'b'`.
  - `'- eins\n* zwei'` → `{ kind: 'list', ordered: false, start: 1, items: [[{text:'eins'}],[{text:'zwei'}]] }`.
  - `'3. drei\n4. vier'` → `{ kind: 'list', ordered: true, start: 3, … }`.
  - `'# A'`, `'## A'`, `'### A'` → je `{ kind: 'heading', content: [{ text: 'A' }] }`; `'###A'` und `'#### A'` → Absatz mit wörtlichem Text.
  - `'- eins\nText danach'` → Liste mit einem Punkt, danach Absatz `'Text danach'`.
  - `'### Steigerung\nStart 10 kg'` → Überschrift, dann Absatz.
  - `'- Ellbogen **hoch** halten'` → Punkt `[{text:'Ellbogen '},{text:'hoch',strong:true},{text:' halten'}]`.
  - `'*kursiv* und _auch_'` → `[{text:'kursiv',emphasis:true},{text:' und '},{text:'auch',emphasis:true}]`.
  - `'**fett *beides* fett**'` → mittleres Stück `{ text: 'beides', strong: true, emphasis: true }`.
  - wörtlich bleiben (ein einziges `Inline` mit dem Originaltext): `'nur **offen'`, `'3 * 5 * 2'`, `'Kurzhantel_rechts_unten'`, `'** fett **'`, `'<b>x</b>'`, `'[Link](http://x)'`, `'-ohne Leerzeichen'`.
  - `''` und `' \n \n'` → `[]`.
  - `describe('toPlainText')`: Spans aus dem Fett-Beispiel → `'Ellbogen hoch halten'`.

- [ ] **Step 2: Laufen lassen, Fehlschlag prüfen**
  Run: `npx vitest run src/lib/markdown-lite.test.ts` – Expected: FAIL (Modul fehlt).

- [ ] **Step 3: Implementieren**
  Zeilenweise: `\r\n` → `\n`, jede Zeile `trimEnd`. Leerzeile beendet den laufenden Block. `^(#{1,3}) (.+)$` → Überschrift (beendet Liste/Absatz). `^[-*] (.+)$` → ungeordneter Punkt, `^(\d+)\. (.+)$` → geordneter Punkt (`start` = erste Zahl); ein Punkt anderer Art oder eine Nicht-Punkt-Zeile beendet die Liste. Sonst Zeile an den laufenden Absatz hängen. Inline: `**…**` und `*…*`/`_…_` nur, wenn direkt nach dem öffnenden und direkt vor dem schließenden Zeichen kein Leerzeichen steht; `_` zusätzlich nur an Wortgrenzen (kein Buchstabe/Ziffer davor bzw. danach). Ohne passenden Abschluss bleibt das Zeichen Text. Benachbarte Spans gleicher Auszeichnung zusammenfassen. Kurzer Kopfkommentar im Stil von `zip.ts`: warum eigene Teilmenge, warum nie HTML.

- [ ] **Step 4: Tests grün**
  Run: `npx vitest run src/lib/markdown-lite.test.ts && npm run check:strict` – Expected: PASS, keine Fehler.

- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/markdown-lite.ts src/lib/markdown-lite.test.ts
  git commit -m "Ein kleiner Markdown-Parser für Anleitungen"
  ```

---

### Task 2: Markdown überall rendern, Guide auf Blöcke umstellen

**Files:**
- Create: `src/components/MarkdownText.tsx`
- Modify: `src/domain/exercise-guide.ts`, `src/domain/exercise-guide.test.ts`
- Modify: `src/components/ExerciseGuideBlock.tsx` (Panel rendert `MarkdownText`, bleibt vorerst Aufklapper)
- Modify: `src/pages/ExercisesPage.tsx:106-110` (Karte), `:396-403` (Hinweis am `TextArea`)
- Modify: `src/pages/TemplateDetailPage.tsx:925-927`
- Modify: `src/db/bootstrap.ts:108` (Beispieldaten)
- Modify: `e2e/exercise-guide.spec.ts`
- Create: `e2e/exercise-markdown.spec.ts`
- Modify: `CLAUDE.md` (Satz zu `whitespace-pre-line`, neuer Satz zu `markdown-lite.ts`)

**Interfaces:**
- Consumes: `parseMarkdownLite`, `toPlainText`, `MarkdownBlock` aus Task 1.
- Produces:
  ```ts
  // src/domain/exercise-guide.ts
  export interface ExerciseGuide { blocks: MarkdownBlock[]; tempo?: string; notes?: string; teaser: string }
  export function buildExerciseGuide(input: ExerciseGuideInput): ExerciseGuide | null; // Signatur unverändert
  // src/components/MarkdownText.tsx
  export function MarkdownText(props: { blocks: MarkdownBlock[]; compact?: boolean; className?: string }): JSX.Element;
  ```

- [ ] **Step 1: Unit-Tests anpassen** – in `exercise-guide.test.ts` alle `lines`-Erwartungen durch `blocks` ersetzen; neu:
  - `instructions: '### Ausführung\n- Ellbogen **hoch** halten\n- Sauber tief'` → `teaser === 'Ellbogen hoch halten'`.
  - `instructions: 'Langsam absenken, **kein Schwung**\nOben halten'` → `teaser === 'Langsam absenken, kein Schwung'`.
  - `instructions: '### Achtung', notes: 'RPE 7'` → `teaser === 'RPE 7'`; `instructions: '### Achtung'` allein → `teaser === 'Achtung'`, Guide nicht `null`.
  - Notiz-/Tempo-Rückfall und `null`-Fall wie bisher.

- [ ] **Step 2: Fehlschlag prüfen** – `npx vitest run src/domain/exercise-guide.test.ts` → FAIL.

- [ ] **Step 3: `buildExerciseGuide` umstellen** – `blocks = parseMarkdownLite(instructions ?? '')`; Teaser = `toPlainText` des ersten Listenpunkts bzw. der ersten Absatzzeile des ersten Nicht-Überschrift-Blocks, sonst Notiz, sonst `Tempo …`, sonst erster Überschriftentext, sonst `null`. Kopfkommentar „Zeilen und nicht Sätze“ auf die neue Regel umschreiben (die Regel steht jetzt im Markdown: eine Liste ist eine Regel pro Punkt).

- [ ] **Step 4: Unit grün** – `npx vitest run src/domain/exercise-guide.test.ts && npm run check:strict` → PASS.

- [ ] **Step 5: `MarkdownText` bauen und einsetzen** – rendert `p` (Zeilen mit `<br />`), `h4` (`font-display font-bold text-content`, uppercase-tracking wie das Label „Ausführung“ ist erlaubt), `ul.list-disc` / `ol.list-decimal start={start}` mit `pl-5`, `strong`, `em`; Wurzel `space-y-2` bzw. `space-y-1` bei `compact`, immer `[overflow-wrap:anywhere]`. Einsetzen: Panel in `ExerciseGuideBlock` (statt `lines`), Bibliothekskarte (`compact`, Kommentar „pre-line …“ entfernen), Übungsauswahl (`compact`). Am `TextArea` „Anleitung“: `hint="**fett**, - Liste, ### Überschrift"`.

- [ ] **Step 6: Beispieldaten** – Front Squat `instructions` auf `'- Ellbogen **hoch** halten\n- Sauber tief, keine Grind-Reps'`.

- [ ] **Step 7: e2e** – `exercise-guide.spec.ts`: Panel-Erwartung `'Ellbogen hoch halten, sauber tief, keine Grind-Reps.'` ersetzen durch `panel.locator('li')` mit Anzahl 2 und `panel.locator('strong')` mit Text `'hoch'`; Teaser-Erwartung `'Ellbogen hoch halten'` bleibt. Neu `exercise-markdown.spec.ts` („Bibliothek rendert Markdown“): nach `resetDatabase` + `seedSampleData` die Übungen-Seite öffnen, Front Squat aufklappen; Karte enthält `strong` mit `'hoch'`, zwei `li`, und ihr Text enthält weder `'**'` noch `'- '` am Zeilenanfang.

- [ ] **Step 8: Alles grün** – Dev-Server neu starten (siehe CLAUDE.md, „reuseExistingServer“), dann `npm run lint && npm run check && npm test && npx playwright test e2e/exercise-guide.spec.ts e2e/exercise-markdown.spec.ts` → PASS.

- [ ] **Step 9: CLAUDE.md** – im Absatz „How the exercise goes …“ den Satz „It splits on **line breaks, never on full stops** …“ und den Satz zu `whitespace-pre-line` ersetzen: Anleitungen sind die Markdown-Teilmenge aus `markdown-lite.ts` (Liste = eine Regel pro Punkt, nie HTML, `MarkdownText` an allen drei Stellen); Teaser = erster Nicht-Überschrift-Block als Klartext.

- [ ] **Step 10: Commit**
  ```bash
  git add src/components/MarkdownText.tsx src/domain/exercise-guide.ts src/domain/exercise-guide.test.ts \
    src/components/ExerciseGuideBlock.tsx src/pages/ExercisesPage.tsx src/pages/TemplateDetailPage.tsx \
    src/db/bootstrap.ts e2e/exercise-guide.spec.ts e2e/exercise-markdown.spec.ts CLAUDE.md
  git commit -m "Anleitungen werden als Markdown dargestellt"
  ```

---

### Task 3: Info-Modal in der Session, Lightbox weg

**Files:**
- Create: `src/components/ExerciseInfoDialog.tsx`
- Modify: `src/components/ExerciseGuideBlock.tsx` (wird Auslösezeile)
- Modify: `src/components/SessionExerciseStage.tsx:860-1061` (Prop `onOpenMedia` → `onOpenInfo`, Thumbnail-Label, Guide-Zeile)
- Modify: `src/pages/SessionPage.tsx:204-207` (State), `:1420` (Callback), `:1931-1935` (Dialog statt Lightbox)
- Delete: `src/components/MediaLightbox.tsx`
- Delete: `e2e/exercise-guide.spec.ts` → Create: `e2e/exercise-info.spec.ts`
- Modify: `CLAUDE.md` (Absatz „How the exercise goes …“, Erwähnungen der Lightbox)

**Interfaces:**
- Consumes: `ExerciseGuide`, `MarkdownText` aus Task 2.
- Produces:
  ```ts
  // ExerciseInfoDialog.tsx
  export function ExerciseInfoDialog(props: {
    open: boolean; name: string; mediaAsset?: MediaAsset; guide: ExerciseGuide | null; onClose: () => void;
  }): JSX.Element | null;
  // ExerciseGuideBlock.tsx
  export function ExerciseGuideBlock(props: { guide: ExerciseGuide; onOpen: () => void }): JSX.Element;
  // SessionExerciseStage props
  onOpenInfo: (sessionExerciseId: string) => void;
  ```

- [ ] **Step 1: e2e zuerst** – `e2e/exercise-info.spec.ts`, `beforeEach` wie bisher (Reset, Seed, Session, `openExerciseSheet(page, 'Front Squat')`), `const row = page.locator('[data-sheet] [data-exercise-guide]').getByRole('button', { name: /Ausführung/ })`:
  - **Zeile:** hat `aria-haspopup="dialog"`, enthält `'Ellbogen hoch halten'`, nicht `'**'`, Höhe ≥ 44.
  - **Öffnen:** `row.click()` → `page.locator('[data-exercise-info]')` sichtbar, `getByRole('dialog', { name: 'Front Squat' })`; enthält zwei `li`, `strong` `'hoch'`, `'Tempo 3-1-1'`, `'In diesem Workout: RPE 7-8'`; „Schließen“-Knopf hat Fokus.
  - **Escape schließt nur das Modal:** `page.keyboard.press('Escape')` → `[data-exercise-info]` Anzahl 0, `[data-sheet]` sichtbar, `row` hat Fokus.
  - **✕ schließt:** erneut öffnen, Knopf „Schließen“ im Modal klicken → Modal weg, Sheet da.
  - **Kein Überlauf (Review Focus 4):** vorher über die Übungen-Seite Front Squat bearbeiten und an die Anleitung `'\n- ' + 'Hüftbeugerdehnungsvariante'.repeat(4)` anhängen, speichern; dann Session wie oben, Modal öffnen; `document.documentElement.scrollWidth <= window.innerWidth` und `scrollWidth <= clientWidth` des `[data-exercise-info]`-Rumpfs. Gleiche Prüfung auf der Bibliothekskarte.
  - **Wertefelder bleiben im Bild:** bisheriger Test `input[id$="-reps"]` `toBeInViewport()` übernehmen.

- [ ] **Step 2: Fehlschlag prüfen** – `npx playwright test e2e/exercise-info.spec.ts` → FAIL (kein `aria-haspopup`, kein Dialog).

- [ ] **Step 3: `ExerciseInfoDialog`** – Portal nach `document.body`, `role="dialog"`, `aria-modal="true"`, `aria-labelledby` auf die `h2` mit dem Namen, `data-exercise-info=""`, `fixed inset-0 z-50 flex flex-col bg-app` mit Safe-Area-Padding wie die alte Lightbox. Kopf: Name (`font-display`), `IconButton label="Schließen"` mit `X`. Rumpf `overflow-y-auto`: Bild (`ExerciseMedia`, `max-h-[40dvh] w-full`, `object-contain`) wenn vorhanden; `MarkdownText` der `guide.blocks`; `Tempo {tempo}`; Notiz mit Trenner `border-t` und „In diesem Workout:“ (Klartext). Effekte nur solange `open`: `window.addEventListener('keydown', h, true)` – bei `Escape` `event.stopPropagation()` und `onClose()`; `body.style.overflow` sichern/setzen/zurück; beim Öffnen `document.activeElement` merken und ✕ fokussieren, beim Schließen den gemerkten Auslöser fokussieren. Kommentar: warum Capture-Phase (Sheet hört auf `document`), warum hell statt dunkel (gelesen, nicht betrachtet).

- [ ] **Step 4: `ExerciseGuideBlock` als Auslöser** – ein `button` (`aria-haspopup="dialog"`, `onClick={onOpen}`), Label „Ausführung“, Teaser `truncate`, rechts `ChevronRight`; `data-exercise-guide` bleibt am Wrapper; Panel, `useState`, `aria-expanded` entfallen. Kopfkommentar auf „Zeile öffnet das Info-Modal“ umschreiben.

- [ ] **Step 5: Bühne verdrahten** – Thumbnail-`aria-label` `Übung ansehen: ${exercise.exerciseNameSnapshot}`, `onClick={() => onOpenInfo(exercise.id)}`; Guide-Zeile `onOpen={() => onOpenInfo(exercise.id)}`. Prop-Doku anpassen.

- [ ] **Step 6: `SessionPage`** – `mediaPreview` ersetzen durch `const [infoExerciseId, setInfoExerciseId] = useState<string | null>(null)`; `infoExercise` per `orderedSessionExercises.find`; `<ExerciseInfoDialog open={Boolean(infoExercise)} name={infoExercise?.exerciseNameSnapshot ?? ''} mediaAsset={mediaAssetForExercise(infoExercise)} guide={infoExercise ? buildExerciseGuide({ instructions: availableExerciseById[infoExercise.exerciseId]?.instructions, tempo: availableExerciseById[infoExercise.exerciseId]?.tempo, notes: infoExercise.notes }) : null} onClose={() => setInfoExerciseId(null)} />` an der Stelle der Lightbox. `MediaLightbox`-Import und Datei löschen.

- [ ] **Step 7: Alles grün** – `npm run lint && npm run check && npm run check:strict && npm test && npm run build` → PASS; Dev-Server neu starten, dann `npm run test:e2e` → PASS (komplett, weil Sheet-Tests betroffen sein können). `grep -rn MediaLightbox src` → keine Treffer.

- [ ] **Step 8: Bildfall von Hand prüfen** – `npm run dev`, Beispieldaten laden, in der Bibliothek Front Squat ein Bild geben, Session starten: Thumbnail öffnet dasselbe Modal mit Bild oben; Übung nur mit Bild (Anleitung leeren) → keine Zeile, Thumbnail öffnet Modal nur mit Bild. Ergebnis im Commit-Text nennen.

- [ ] **Step 9: CLAUDE.md** – Absatz „How the exercise goes …“ neu: Auslösezeile mit Teaser statt Aufklapper; Thumbnail und Zeile öffnen `ExerciseInfoDialog` (Bild + Markdown + Tempo + Notiz, hell, keine Limette, `z-50`); Escape in Capture-Phase auf `window`, damit das Sheet offen bleibt; Zustand ephemer in `SessionPage`; Test-Anker `data-exercise-info`, gelesen von `exercise-info.spec.ts`. Satz zum Rendern von `MediaAsset` in der Session ggf. anpassen; `key={exercise.id}`-Satz entfällt.

- [ ] **Step 10: Commit**
  ```bash
  git add -A src/components src/pages/SessionPage.tsx e2e/exercise-guide.spec.ts e2e/exercise-info.spec.ts CLAUDE.md
  git commit -m "Bild und Anleitung stehen zusammen in einem Modal"
  ```

---

### Task 4: Datei fürs Projektwissen (außerhalb des Repos)

**Files:**
- Create: `~/Documents/gym-book-daten/anleitungstexte.md` – **nicht** committen.

**Interfaces:**
- Consumes: Grammatik aus Task 1, Teaser-Regel aus Task 2.

- [ ] **Step 1: Datei schreiben** mit den Abschnitten aus Spec §3: (1) wo der Text erscheint, Teaser nach ca. 40 Zeichen abgeschnitten; (2) Syntax-Tabelle und Nicht-Erlaubtes, Zeilenumbruch im JSON als `\n`; (3) Schreibreihenfolge Ausführung-Liste → `### Steigerung` → `### Achtung` → `### Warum` → Verlauf kursiv am Ende; (4) Fett statt Großbuchstaben, höchstens eine Betonung pro Punkt; (5) Workout-Notiz Klartext; (6) Vorher/Nachher am Couch Stretch – „Vorher“ ist die `instructions` aus `~/Documents/gym-book-daten/import/2026-08-28-plan-update.json`, „Nachher“ die Umschreibung nach (3)/(4) als JSON-String und gerendert; (7) Auftragstext zum Kopieren: alle Anleitungen nach dieser Regel als Plan-Update neu liefern, ausschließlich `instructions` ändern, Namen exakt beibehalten, im Dry-Run dürfen nur `AKTUALISIERT`-Einträge erscheinen.

- [ ] **Step 2: Prüfen** – den „Nachher“-String durch `parseMarkdownLite` schicken (`npx tsx -e` oder kurzer vitest-Einzeiler im Scratchpad) und den erwarteten Teaser in der Datei bestätigen. `git status` im Repo zeigt nichts Neues.

---

### Abschluss

- [ ] `npm run lint && npm run check && npm run check:strict && npm test && npm run build` und `npm run test:e2e` auf dem letzten Stand → PASS.
- [ ] Nicht pushen; dem Nutzer die Commits nennen und fragen, ob gepusht (= deployt) werden soll.
