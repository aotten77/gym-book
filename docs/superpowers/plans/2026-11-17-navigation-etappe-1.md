# Navigation Etappe 1: Tab-Leiste, Jetzt, Abgleich, Bestand – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die neue Tab-Leiste `Plan · Fortschritt · ▶ Jetzt · Abgleich · Bestand` mit Jetzt-Sheet, Abgleich-Seite und Bestand-Hub einführen, und jeder neue Trainingsstart öffnet direkt das Fokus-Sheet. Alle bestehenden Routen bleiben erreichbar.

**Architecture:** Etappe 1 baut die Hülle um, nicht die Inhalte. „Plan“ zeigt vorläufig weiter auf `/` (Home) und `/programs`, „Fortschritt“ auf `/history`. Neu sind zwei Seiten (`/sync`, `/library`), eine Bänder-Seite (`/bands`), ein globales Sheet (`NowSheet`, gemountet in `AppShell`) und ein Navigations-State, mit dem `SessionPage` beim frischen Start das Sheet öffnet. Die Etappen 2–5 (Zeitstrahl, Fortschritt, Bestand-Inhalte, Meditation) bekommen eigene Pläne, siehe Ende.

**Tech Stack:** React 18 + TypeScript, react-router (HashRouter), Dexie + dexie-react-hooks, Zustand, Tailwind, Vitest (jsdom + fake-indexeddb), Playwright WebKit.

**Spec:** `docs/superpowers/specs/2026-11-17-navigation-zeitstrahl-design.md`. Mockups: `~/Library/Application Support/orca/chat-scratch/1e1d241004e894a8ccab6115b3d8d2e8/finale-screens-e5.html` (Screens 6, 7, 10, 11).

## Global Constraints

- UI-Texte deutsch mit echten Umlauten, in Strings **und** Kommentaren. Zahlen über `formatNumber`.
- Eine Lime-Fläche pro Screen. Lime (`highlight`) heißt „jetzt dran“, Waldgrün (`success`) heißt „erledigt“, Tinte (`accent`) heißt Aktion.
- Touch-Ziele mindestens 44px (`min-h-touch`). Sichtbarer Fokusring, kein `outline-none` ohne Ersatz.
- UI schreibt nie direkt in `db`, nur über `*-actions`. Neue Settings-Felder sind additiv (`.optional()` in `export.ts`, kein `SNAPSHOT_SCHEMA_VERSION`-Bump, keine Dexie-Version).
- `HashRouter` bleibt. Bestehende Routen bleiben gültig, die E2E-Tests springen direkt per `goto('./#/…')`.
- Commits direkt auf `main` (Projektregel), Meldungen deutsch, mit Zeile `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- E2E immer als `caffeinate -i npm run test:e2e`, Dev-Server vorher neu starten (`reuseExistingServer`).
- Jede Aufgabe aktualisiert die betroffenen Abschnitte in `CLAUDE.md` mit (Konvention des Repos).

## Review Focus

1. **Zwischenablage auf iOS:** „Analyse kopieren“ auf der neuen Seite darf vor `copyAnalysisSnapshot()` kein `await` haben, sonst scheitert es auf dem iPhone stumm. → Task 2 übernimmt den Handler wörtlich, die Review prüft das ausdrücklich.
2. **Reload nach Start:** Nach einem Start mit offenem Fokus-Sheet darf ein Reload das Sheet **nicht** wieder öffnen (bestehender Vertrag). → Test in Task 5.
3. **Zurück in eine laufende Session** (Streifen, „Läuft gerade“) darf das Sheet nicht öffnen, nur ein frischer Start. → Test in Task 5.
4. **Aktiver Tab auf Unterseiten:** `/templates/:id`, `/history/session/:id`, `/runs/:id` und `/programs/manage` müssen den richtigen Tab hervorheben. → Unit-Test in Task 4.
5. **Jetzt-Sheet bei laufender Session:** Ein Tap auf ein Workout führt in die laufende Session zurück (`startSessionFromTemplate` liefert deren Id) und darf das Fokus-Sheet dort öffnen, aber keine zweite Session anlegen. → Test in Task 3.

---

### Task 1: Zeitstempel „zuletzt an Claude gesendet“ und Abgleich-Status

**Files:**
- Create: `src/domain/sync-status.ts`, `src/domain/sync-status.test.ts`
- Modify: `src/domain/models.ts` (`AppSettings`), `src/lib/export.ts` (`appSettingsSchema`, `copyAnalysisSnapshot`), `src/db/settings-actions.ts`, `src/db/settings-actions.test.ts` (anlegen, falls nicht vorhanden)

**Interfaces:**
- Produces: `AppSettings.lastAnalysisCopiedAt?: string` (ISO)
- Produces: `markAnalysisCopied(copiedAt?: string): Promise<void>` in `settings-actions.ts`
- Produces: `describeSyncStatus(input: { lastCopiedAt?: string; sessionsCompletedAt: string[]; runDates: string[]; testRecordedAt: string[] }): { neverSent: boolean; sessions: number; runs: number; tests: number; text: string }` in `sync-status.ts`

- [ ] **Step 1: Failing tests in `sync-status.test.ts`**

```ts
it('zählt nur, was nach dem letzten Senden passiert ist', () => {
  const s = describeSyncStatus({
    lastCopiedAt: '2026-11-12T18:00:00.000Z',
    sessionsCompletedAt: ['2026-11-11T10:00:00.000Z', '2026-11-13T10:00:00.000Z', '2026-11-17T09:00:00.000Z'],
    runDates: ['2026-11-15'],
    testRecordedAt: ['2026-11-15T08:00:00.000Z'],
  });
  expect(s).toMatchObject({ neverSent: false, sessions: 2, runs: 1, tests: 1 });
  expect(s.text).toBe('Seitdem: 2 Einheiten, 1 Lauf, 1 Test.');
});
it('sagt „Noch nie gesendet.“ ohne Zeitstempel', () => {
  expect(describeSyncStatus({ sessionsCompletedAt: [], runDates: [], testRecordedAt: [] }).text)
    .toBe('Noch nie gesendet.');
});
it('sagt „Seitdem nichts Neues.“ bei null überall', () => { /* lastCopiedAt gesetzt, alle Listen leer */ });
```

Läufe: `date` ist ein lokaler Tag (`YYYY-MM-DD`). Er zählt, wenn der Tag **nach** dem lokalen Tag von `lastCopiedAt` liegt oder gleich ist. Vergleich über `parseLocalDate`, nie `new Date('YYYY-MM-DD')`. Singular/Plural: `1 Einheit`/`n Einheiten`, `1 Lauf`/`n Läufe`, `1 Test`/`n Tests`. Teile mit 0 entfallen.

- [ ] **Step 2:** `npx vitest run src/domain/sync-status.test.ts` → FAIL (Modul fehlt)
- [ ] **Step 3:** `describeSyncStatus` implementieren, rein und ohne Uhr.
- [ ] **Step 4:** Test für `markAnalysisCopied`: Danach ist `lastAnalysisCopiedAt` gesetzt und `lastBackupAt` **unverändert**. Implementieren wie `markBackupCreated` (eigenes Feld), Feld in `models.ts` mit Kommentar („kein Backup, siehe Analyse-Export“), `appSettingsSchema` um `lastAnalysisCopiedAt: z.string().optional()` ergänzen.
- [ ] **Step 5:** In `copyAnalysisSnapshot` nach erfolgreichem Schreiben `markAnalysisCopied()` aufrufen, **innerhalb** der zurückgegebenen Promise-Kette. Die Funktion bleibt nicht-`async`, der synchrone Aufruf von `clipboard.write` bleibt unangetastet.
- [ ] **Step 6:** `npx vitest run src/domain/sync-status.test.ts src/db/settings-actions.test.ts` → PASS, `npm run check:strict` → grün.
- [ ] **Step 7:** Commit `Abgleich: Zeitstempel und Status seit dem letzten Senden`

### Task 2: Abgleich-Seite `/sync`

**Files:**
- Create: `src/pages/SyncPage.tsx`, `e2e/sync.spec.ts`
- Modify: `src/App.tsx` (Route), `src/pages/SettingsPage.tsx` (Analyse-Export, Analyse kopieren und `<LibraryImportSection />` **entfernen**, samt State und Handlern), `e2e/analysis-export.spec.ts` und `e2e/library-import.spec.ts` (`goto('./#/settings')` → `goto('./#/sync')`)

**Interfaces:**
- Consumes: `describeSyncStatus`, `AppSettings.lastAnalysisCopiedAt` (Task 1), `copyAnalysisSnapshot`, `exportAnalysisSnapshot`, `listLibraryImports(limit)`, `LibraryImportSection`
- Produces: Route `/sync`, Seitentitel „Abgleich“

Aufbau nach Screen 10, von oben nach unten:
1. `SectionCard` „Stand an Claude senden“. Untertitel: `Zuletzt kopiert am {formatDateTime}.` plus `describeSyncStatus(...).text`. Primärer `Button` „Analyse kopieren“ (fullWidth). Der Handler wird **wörtlich** aus `SettingsPage.handleCopyAnalysis` übernommen, mit dem Kommentar zur Nutzergeste. Die Meldung erscheint darunter. Ghost-`Button` „Als ZIP teilen“ ruft `exportAnalysisSnapshot({ preferShare: true })`.
2. `<LibraryImportSection />` unverändert (Titel „Bibliothek importieren“ bleibt, die E2E-Selektoren hängen daran).
3. „Letzte Importe“: `useLiveQuery(() => listLibraryImports(5))`. Der neueste als `DoneRow`, ältere als weiße Zeilen mit Datum und Zählern aus dem Log.

Daten für den Status: abgeschlossene Sessions (`completedAt`, `status === 'completed'`), Läufe (`date`) und Tests (`recordedAt`) über bestehende Queries oder `db` in einer neuen Lesefunktion `loadSyncActivitySince(since?: string)` in `src/db/history-queries.ts`. Die Seite liest nur, sie schreibt nicht direkt.

- [ ] **Step 1:** `e2e/sync.spec.ts`: `goto('./#/sync')` zeigt die Überschriften „Stand an Claude senden“ und „Bibliothek importieren“ sowie den Knopf „Analyse kopieren“. Mit `seedSampleData` steht `Seitdem: 1 Einheit` (die Beispieldaten haben eine abgeschlossene Session) bzw. `Noch nie gesendet.`. Den genauen Text vorher aus den Seed-Daten ablesen.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** `SyncPage` und Route bauen, die Teile aus den Einstellungen entfernen, die Specs auf `/sync` umstellen.
- [ ] **Step 4:** `caffeinate -i npx playwright test e2e/sync.spec.ts e2e/analysis-export.spec.ts e2e/library-import.spec.ts` → PASS. Im Spec `library-import` den Test „…zeigt sie im Programm-Tab“ prüfen, er navigiert danach weiter auf `/programs`.
- [ ] **Step 5:** CLAUDE.md: Abschnitte „analysis export“ und „library import“ nennen `/sync` als Ort. Die Begründung „ein Tap, dann in claude.ai einfügen“ in einem Satz ergänzen.
- [ ] **Step 6:** Commit `Abgleich: eigene Seite für Analyse kopieren und Import`

### Task 3: Jetzt-Sheet

**Files:**
- Create: `src/components/NowSheet.tsx`
- Modify: `src/domain/today-units.ts` + `src/domain/today-units.test.ts`, `src/store/ui-store.ts`, `src/components/AppShell.tsx` (mounten), `src/pages/ProgramsPage.tsx` / `src/components/PlanWeekSection.tsx` (Aufrufer von `TodayUnitSheet` auf `setNowSheetOpen(true)` umstellen), `src/pages/Home.tsx` („Lauf eintragen“ bleibt vorerst. „Weitere Workouts“ bleibt bis Etappe 2.)
- Delete: `src/components/TodayUnitSheet.tsx` (geht in `NowSheet` auf)

**Interfaces:**
- Produces in `today-units.ts`:
  - `SHORT_WORKOUT_MAX_MINUTES = 15`
  - `estimateTemplateMinutes(items: { workSetCount: number; targetReps?: number; targetSeconds?: number; restSeconds?: number; includeWarmup?: boolean; unilateral: boolean }[]): number`
  - `TodayUnitOption` erweitert um `minutes: number`
  - `type NowFilter = 'all' | 'short' | 'mobility' | 'strength'`
  - `filterNowOptions(options: TodayUnitOption[], filter: NowFilter): TodayUnitOption[]`
  - `buildTodayUnitOptions` bekommt `minutesByTemplate: Record<string, number>` als zusätzlichen Input
- Produces in `ui-store.ts`: `isNowSheetOpen: boolean`, `setNowSheetOpen(open: boolean): void` (ephemer)
- Produces: `NowSheet` ohne Props, liest selbst. Gemountet einmal in `AppShell`, nicht unter `/session/`.

Schätzregel `estimateTemplateMinutes` (grob, nur für den Filter „Kurz“; Konstanten aus `session-estimate.ts`):
- Arbeitszeit pro Zeile = `targetSeconds ?? (targetReps ? targetReps * SECONDS_PER_REP : FALLBACK_WORK_SECONDS)` + `ROW_OVERHEAD_SECONDS`
- Unilateral: zwei Zeilen pro Satz + `SIDE_SWITCH_SECONDS`
- Aufwärmrunde (wenn `includeWarmup !== false`): eine Runde mit gleichen Zeilenkosten, Pause × `WARMUP_REST_FACTOR`
- Pause `restSeconds ?? 0` nach jeder Runde außer der allerletzten des Workouts
- Ergebnis: `Math.ceil(sekunden / 60)`

- [ ] **Step 1: Failing tests**

```ts
it('schätzt 3 × 10 Wdh, 60 s Pause, ohne Aufwärmen, auf 5 min', () => {
  expect(estimateTemplateMinutes([{ workSetCount: 3, targetReps: 10, restSeconds: 60, includeWarmup: false, unilateral: false }])).toBe(5);
}); // 3 × (30+20) + 2 × 60 = 270 s
it('rechnet unilateral beide Seiten plus Seitenwechsel', () => {
  expect(estimateTemplateMinutes([{ workSetCount: 2, targetSeconds: 30, restSeconds: 0, includeWarmup: false, unilateral: true }])).toBe(4);
}); // 2 × (2 × (30+20) + 20) = 240 s
it('filtert „Kurz“ auf höchstens 15 min, „Mobility“ auf die Art', () => { /* drei Optionen: 8 min mobility, 15 min strength, 40 min strength */ });
```

- [ ] **Step 2:** `npx vitest run src/domain/today-units.test.ts` → FAIL
- [ ] **Step 3:** Domain implementieren, `buildTodayUnitOptions` erweitern. Bestehende Tests anpassen (`minutesByTemplate: {}` ergibt `minutes: 0`).
- [ ] **Step 4:** `NowSheet` nach Screen 6 bauen, auf Basis von `TodayUnitSheet` (Startlogik, `describeLastTrained`, `loadTemplateRecency`, heute offene Einträge):
  - Titel „Jetzt trainieren“. Oben der erste heute geplante offene Eintrag als Lime-Zeile (einzige Lime-Fläche), weitere geplante weiß.
  - Filter-Chips `Alle · Kurz · Mobility · Kraft` als `role="radiogroup"`, jeweils 44px hoch. Die Auswahl ist ephemerer `useState`, Start auf „Alle“.
  - „Kurz & spontan“: Kacheln (2 Spalten) für Optionen mit `minutes <= SHORT_WORKOUT_MAX_MINUTES && minutes > 0`, Text `{n} min · {k} Übungen`. Darunter die übrigen als Zeilen mit `zuletzt …`.
  - „Erfassen“: „Lauf eintragen“ schließt dieses Sheet und öffnet dann `RunLogSheet`, nie zwei Sheets übereinander. „Test erfassen“ navigiert vorerst nach `/tests`.
  - Ein Start ruft `startSessionFromTemplate(id)` (geplante Einträge mit `{ planEntryId }`), schließt das Sheet und navigiert über `navigateToStartedSession` (Task 5). Bis Task 5 fertig ist, ein schlichtes `navigate`.
  - `minutesByTemplate` aus Template-Übungen plus `Exercise.unilateral` in einer Lesefunktion `loadTemplateMinutes(): Promise<Record<string, number>>` in `src/db/history-queries.ts`.
- [ ] **Step 5:** E2E in `e2e/now-sheet.spec.ts`: Der Jetzt-Knopf (Task 4) öffnet das Sheet. Filter „Mobility“ blendet „Einheit A“ aus. Ein Tap auf „Einheit A“ führt nach `#/session/`. Ein zweiter Start bei laufender Session führt in **dieselbe** Session-URL (Review Focus 5). Läuft vor Task 4 noch nicht, deshalb in Task 4 grün machen.
- [ ] **Step 6:** `npm test` → PASS. CLAUDE.md: Abschnitt zu `TodayUnitSheet` auf `NowSheet` umschreiben (Ort: global, Filter, Schätzregel als Grobwert).
- [ ] **Step 7:** Commit `Jetzt-Sheet: spontan starten mit Filter und Kurz-Kacheln`

### Task 4: Neue Tab-Leiste und Bestand-Hub

**Files:**
- Create: `src/lib/navigation.ts`, `src/lib/navigation.test.ts`, `src/pages/LibraryPage.tsx`, `src/pages/BandsPage.tsx`
- Modify: `src/components/AppShell.tsx` (Navigation), `src/App.tsx` (Routen `/library`, `/bands`), `src/pages/SettingsPage.tsx` (`<BandLevelsSection />` entfernen), `e2e/bands.spec.ts` (`goto` auf `/bands`), `e2e/accessibility.spec.ts` falls dort Tab-Namen stehen

**Interfaces:**
- Produces in `navigation.ts`:
  - `type NavTab = 'plan' | 'progress' | 'sync' | 'library'`
  - `activeNavTab(pathname: string): NavTab | null`
- Produces: Routen `/library` (Titel „Bestand“), `/bands` (Titel „Bänder“)

Zuordnung in `activeNavTab`:
- `plan`: `/`, `/programs`
- `progress`: `/history`, `/history/*`, `/runs/*`
- `sync`: `/sync`
- `library`: `/library`, `/templates`, `/templates/*`, `/exercises`, `/programs/manage`, `/bands`, `/tests`
- `/settings`: `null`

`/programs/manage` muss vor `/programs` geprüft werden.

- [ ] **Step 1:** `navigation.test.ts` mit je einem Fall pro Zeile oben, dazu `/templates/abc` → `library`, `/programs/manage` → `library`, `/programs` → `plan`, `/runs/x` → `progress`, `/settings` → `null`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** implementieren. **Step 4:** PASS.
- [ ] **Step 5:** `AppShell`: `navigationItems` ersetzen durch `Plan (/, CalendarRange)`, `Fortschritt (/history, BarChart3)`, Mitte **Jetzt** (`button`, kein Link, `aria-label="Jetzt trainieren"`, Icon `Play`, 48px Tinte auf Papier, ragt 16px über die Leiste, öffnet `setNowSheetOpen(true)`), `Abgleich (/sync, ArrowLeftRight)`, `Bestand (/library, Library)`. Das Raster wird `grid-cols-5`. Aktiv-Zustand über `activeNavTab(location.pathname)` statt `NavLink`-`isActive`, mit `aria-current="page"` am aktiven Link. Die Kommentare zur 6-Spalten-Breite entfallen.
- [ ] **Step 6:** `LibraryPage` nach Screen 11: Zeilen-Links (je ≥44px, `SectionCard` oder `Link`-Zeilen wie `ExercisesPage`) zu Workouts (`/templates`, Anzahl), Übungen (`/exercises`, Anzahl), Programm (`/programs/manage`, Name des aktiven Programms + `W{n}` via `resolveWeekControl`), Bänder (`/bands`, Anzahl), Tests (`/tests`, Anzahl). Kein Lime. `BandsPage` rendert nur `<BandLevelsSection />` in `AppShell title="Bänder"`.
- [ ] **Step 7:** E2E: `now-sheet.spec.ts` aus Task 3 grün. Neuer Test in `e2e/navigation.spec.ts`: Fünf Einträge in „Hauptnavigation“, auf `/templates/<id>` hat „Bestand“ `aria-current="page"`, auf 320px Breite überläuft nichts (Breite der Liste ≤ Viewport, wie die bestehenden 320px-Prüfungen).
- [ ] **Step 8:** `caffeinate -i npm run test:e2e` → alle grün. Fehlschläge durch alte Tab-Namen beheben (die Specs nutzen `goto`, Treffer sind also unwahrscheinlich).
- [ ] **Step 9:** CLAUDE.md: Kommentar und Abschnitt zur Bottom-Nav (sechs Tabs) ersetzen. Bänder sitzen unter `/bands` statt in den Einstellungen.
- [ ] **Step 10:** Commit `Navigation: fünf Einträge mit Jetzt, Abgleich und Bestand`

### Task 5: Frischer Start öffnet direkt das Fokus-Sheet

**Files:**
- Create: `src/lib/session-navigation.ts`, `e2e/session-start-focus.spec.ts`
- Modify: `src/pages/SessionPage.tsx`, alle Start-Aufrufer (`Home.tsx:199`, `PlanWeekSection.tsx:114`, `TemplatesPage.tsx:78`, `TemplateDetailPage.tsx:461`, `NowSheet.tsx`), `e2e/helpers.ts`

**Interfaces:**
- Produces: `navigateToStartedSession(navigate: NavigateFunction, sessionId: string): void`. Navigiert nach `/session/${sessionId}` mit `state: { openFocus: true }`.
- Produces: `readOpenFocusState(state: unknown): boolean` (Typwächter, unit-getestet).
- **Nicht** verwenden in `ActiveSessionBar` und bei „Läuft gerade“-Links. Das ist Rückkehr, kein Start.

`SessionPage`: ein Effekt, der wartet, bis `blockProgress.length > 0` ist. Dann, wenn `readOpenFocusState(location.state)` gilt und `openSessionBlockKey` leer ist: `findNextOpenBlock(blockProgress, '')` (mit `''` fängt die Suche oben an). Bei Treffer `handleOpenExerciseSheet(result.exercise.id)` aufrufen. Danach **in jedem Fall** `navigate(location.pathname, { replace: true, state: null })`, damit weder Reload noch Zurück das Sheet erneut öffnen. Der Ruhemodus ist unberührt, da nichts abgehakt ist.

- [ ] **Step 1:** Unit-Test für `readOpenFocusState` (`{openFocus:true}` → true; `null`, `{}`, `'x'` → false).
- [ ] **Step 2:** `session-start-focus.spec.ts`:
  - Start von Home („Einheit A“) → `[data-sheet]` sichtbar, Überschrift ist die erste Übung.
  - Danach `page.reload()` → `[data-sheet]` nicht sichtbar (Review Focus 2).
  - Sheet schließen, Session minimieren, über den Streifen zurück → `[data-sheet]` nicht sichtbar (Review Focus 3).
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implementieren und alle fünf Aufrufer umstellen.
- [ ] **Step 5:** `e2e/helpers.ts`: `startSampleSession` schließt nach `waitForURL` ein offenes Sheet (`closeExerciseSheet`, nur wenn `[data-sheet]` sichtbar), damit alle bestehenden Specs vom Stand „Liste“ aus arbeiten. Den Kommentar an `openExerciseSheet` („Bewusst kein automatisches Öffnen…“) auf die neue Regel umschreiben: Start öffnet, Reload nicht.
- [ ] **Step 6:** `caffeinate -i npm run test:e2e` → alle grün.
- [ ] **Step 7:** CLAUDE.md, Abschnitt „The session screen“: „**Never automatically on session start**“ ersetzen durch: Ein *frischer* Start öffnet das Sheet auf dem ersten offenen Block (Entscheidung vom 17.11.2026: der Umweg über die Liste kostete bei kurzen Einheiten mehr, als das Lesen des Plans brachte). Rückkehr, Reload und Ablauf eines Timers öffnen es weiterhin nie.
- [ ] **Step 8:** Commit `Session: frischer Start öffnet direkt das Fokus-Sheet`

### Task 6: Abschluss

- [ ] **Step 1:** `npm run lint && npm run check && npm run check:strict && npm test && npm run build` → alles grün.
- [ ] **Step 2:** Dev-Server neu starten, `caffeinate -i npm run test:e2e` → grün.
- [ ] **Step 3:** In der Spec-Datei den Status auf „Etappe 1 umgesetzt“ setzen und die erledigten offenen Punkte streichen (Punkt 1 ist beantwortet: jeder frische Start).
- [ ] **Step 4:** Commit und Push (`git push`, notfalls über den in der Memory beschriebenen `gh`-Weg). Push löst den Pages-Deploy aus.

---

## Folge-Etappen (je ein eigener Plan)

- **Etappe 2 – Plan-Zeitstrahl:** `/` wird die Zeitstrahl-Liste (Screens 1–3), das Wochen-Sheet ersetzt den unteren Teil von `/programs` (Screens 4–5, nur lesen). Home-Karten, Kalenderraster und `PlanWeekSection` entfallen. `/programs` leitet auf `/` um. Wiederverwendung: `buildCalendarWeeks`, `describeCalendarUnitDetail`, `countWeekProgress`, `buildWeekPlan`. Offen: Reichweite nach vorn, Termine nur lesen oder minimal verschieben.
- **Etappe 3 – Fortschritt:** `/history` wird zu Screen 8, Übungsdetail als eigene Route (Screen 9) aus `ExerciseDetail`. Tests-Ergebnisse wandern hierher.
- **Etappe 4 – Bestand und Einstellungen:** Programm-Einstellungen (aktives Programm, Startdatum, Override als einziger Schreiber) nach `/programs/manage` ziehen. Startknopf aus dem Workout-Detail entfernen. „Verlauf anzeigen“ aus der Übungsliste entfernen. Test-Erfassen ins Jetzt-Sheet. Einstellungen auf App-Themen kürzen.
- **Etappe 5 – Meditation:** dritte Workout-Art. Kategorie, Icon in `UnitKindIcon`, Spalte in `buildWeeklyVolume`, Filter-Chip im Jetzt-Sheet.
