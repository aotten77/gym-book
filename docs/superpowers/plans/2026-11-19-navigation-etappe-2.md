# Navigation Etappe 2: Plan-Zeitstrahl – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` wird der Zeitstrahl aus Protokoll, heute und künftigen Terminen, mit einem Wochen-Sheet zum Lesen. Home, Kalenderraster, Tagesliste und jedes Bearbeiten von Terminen entfallen, `/programs` leitet auf `/` um.

**Architecture:** Die Regeln bleiben rein in `src/domain/`. `training-calendar.ts` bekommt Reichweite, Wochenkopf und die Wahl der Lime-Einheit, ein neues `week-sheet.ts` liefert Kacheln und Vorgaben-Blöcke. Die Seite `PlanPage` lädt den ganzen sichtbaren Zeitraum einmal und baut daraus mit `buildCalendarWeeks` die Wochen. Das Wochen-Sheet lädt seine eine Woche selbst und kann deshalb frei blättern. Termine entstehen nur noch über den Bibliothek-Import. Die Schreib-API für einzelne Termine und Serien wird entfernt.

**Tech Stack:** React 18 + TypeScript, react-router (HashRouter), Dexie + dexie-react-hooks, Zustand, Tailwind, Vitest (jsdom + fake-indexeddb), Playwright WebKit.

**Spec:** `docs/superpowers/specs/2026-11-17-navigation-zeitstrahl-design.md`, Abschnitte „Plan (View 1)“, „Wochen-Sheet (View 3)“ und „Entschieden am 19.11.2026“. Mockups (nur lesen): `~/Library/Application Support/orca/chat-scratch/1e1d241004e894a8ccab6115b3d8d2e8/finale-screens-e5.html`, Screens 1–5.

## Global Constraints

- UI-Texte deutsch mit echten Umlauten, in Strings **und** Kommentaren. Jede gerendete Zahl läuft über `formatNumber`.
- Eine Lime-Fläche pro Screen. Lime (`highlight`) heißt „jetzt dran“, Waldgrün (`success`) heißt „erledigt“, Tinte (`accent`) heißt Aktion. Der Streifen `ActiveSessionBar` ist selbst Lime.
- Touch-Ziele mindestens 44px (`min-h-touch`). Sichtbarer Fokusring, kein `outline-none` ohne Ersatz.
- Die UI schreibt nie direkt in `db`. `weekOverride` hat genau einen Schreiber, die Einstellungen. Was der Zeitstrahl und das Wochen-Sheet auswählen, ist ephemerer `useState`.
- Der Session-Screen wird nicht umgebaut. Vor Clipboard-Aufrufen steht kein `await`.
- `HashRouter` bleibt. E2E-Tests springen per `goto('./#/…')`.
- Termine sind in der App nur lesbar. Kein Code-Pfad außer dem Bibliothek-Import und der Wochentags-Datenkorrektur legt `planEntries` an, ändert oder löscht sie.
- Commits gehen direkt auf `main`, ohne Branch und ohne Worktree. Meldungen sind deutsch, die letzte Zeile lautet exakt `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Nicht pushen**, das entscheidet der Nutzer.
- E2E-Lauf: Zuerst `lsof -ti :5173 | xargs kill` (alter Dev-Server), dann `caffeinate -i npx playwright test <dateien>` im Vordergrund, aufgeteilt nach Spec-Dateien. Niemals mit „läuft noch“ zurückmelden, nur mit Ergebnis.
- Jede Aufgabe aktualisiert die Abschnitte in `CLAUDE.md`, die sie nennt.

## Review Focus

1. **Laufende Session und Lime:** Solange eine Session `active` ist, liegt die eine Lime-Fläche auf dem Streifen. Der Zeitstrahl zeigt dann keine Lime-Karte. Heute offene Termine starten nicht, ein Tap öffnet nur die Anzeige. → E2E in Task 5.
2. **Blättern schreibt nichts:** ‹ › im Wochen-Sheet setzt nie `weekOverride`. → E2E in Task 6, prüft danach die Einstellungen.
3. **Override sichtbar:** Ist die Woche von Hand gesetzt, nennt der Plan das in einer Kopfzeile. Das Wochen-Sheet der laufenden Woche sagt, dass ein Start die gesetzte Woche trainiert und nicht die gezeigte. → E2E in Task 5 (`week-control.spec.ts`) und Task 6.
4. **Tageswechsel bei offener App:** Über Nacht offen gelassen, folgen am Morgen „heute“, die Lime-Karte und die Reichweite dem neuen Tag. → E2E mit `page.clock` in Task 5.
5. **Nachladen früherer Wochen springt nicht:** Safari kennt kein `overflow-anchor`. Die Woche, die vor dem Tap oben stand, bleibt danach an derselben Stelle. → E2E in Task 5.

---

### Task 1: Zeitstrahl-Regeln in `training-calendar.ts`

**Files:**
- Modify: `src/domain/training-calendar.ts`, `src/domain/training-calendar.test.ts`

**Interfaces:**
- Produces:
  - `TIMELINE_INITIAL_PAST_WEEKS = 4`, `TIMELINE_LOAD_STEP_WEEKS = 4`
  - `timelineFirstMonday(today: Date): Date`: der Montag der laufenden Woche minus `TIMELINE_INITIAL_PAST_WEEKS` Wochen, gerechnet über `shiftWindow`
  - `timelineLastMonday(today: Date, lastPlanDate?: string): Date`: der spätere von „Montag der nächsten Woche“ und „Montag der Woche von `lastPlanDate`“. Ein ungültiges oder fehlendes Datum wird ignoriert, gelesen wird nur über `parseLocalDate`.
  - `timelineWeekCount(firstMonday: Date, lastMonday: Date): number`: Wochen einschließlich beider Enden, über `Math.round` auf Wochen, damit eine Woche mit 167 oder 169 Stunden (Zeitumstellung) nicht verrutscht
  - `describeTimelineWeekHead(week: CalendarWeek): { title: string; done: number; planned: number; label: string }`. `done` und `planned` kommen aus `countWeekProgress`.
  - `pickTodayNowEntryId(day: CalendarWeekDay, hasActiveSession: boolean): string | undefined`: die `planEntryId` der ersten Einheit mit `ref.type === 'entry'`, aber nur an `day.isToday` und nur ohne laufende Session
  - `describeCalendarUnitDetail(unit, context)`: `context` wird erweitert zu `{ volumeKg?: number; exerciseCount?: number; minutes?: number; activeProgress?: { completedCount: number; totalCount: number } }`

Texte, wörtlich:
- `title`: `describeWeekRange(start, end)`, dann `· W{n}`, falls eine Programmwoche auf den Montag fällt, dann `· {describeWeekKind(kind)}`, falls die Woche eine Art hat, und `· diese Woche` für die laufende Woche.
- `label`: `title`, dazu ` · {done} von {planned} erledigt`, falls `planned > 0`.
- Erledigt ohne Termin: Statt `nicht geplant` heißt es jetzt `spontan`. Begründung: Die Spec sagt beim Jetzt-Sheet „ohne Termin als ‚spontan‘“, und Screen 1 zeigt es so. Screen 3 zeigt noch „nicht geplant“, das ist der ältere Stand.
- Geplantes Workout: `{n} Übungen` bzw. `1 Übung`, dazu ` · ~{m} min`, falls `minutes > 0`. Das Wort „Kraft“/„Mobility“ entfällt, denn das Icon trägt die Art.
- Laufende Session (`ref.type === 'active-session'`): `läuft · Satz {min(completedCount + 1, totalCount)} von {totalCount}`, wenn `activeProgress.totalCount > 0`, sonst wie bisher `Läuft gerade`.

- [ ] **Step 1: Failing tests** in `training-calendar.test.ts` (lokale Daten, `new Date(2026, 10, 19)` ist Mittwoch, 19.11.2026):

```ts
it('reicht nach vorn mindestens bis Ende nächster Woche', () => {
  expect(toDateInputValue(timelineLastMonday(new Date(2026, 10, 19)))).toBe('2026-11-23');
  expect(toDateInputValue(timelineLastMonday(new Date(2026, 10, 19), '2026-11-20'))).toBe('2026-11-23');
  expect(toDateInputValue(timelineLastMonday(new Date(2026, 10, 19), 'kaputt'))).toBe('2026-11-23');
});
it('reicht bis zur Woche des letzten Termins', () => {
  expect(toDateInputValue(timelineLastMonday(new Date(2026, 10, 19), '2027-02-10'))).toBe('2027-02-08');
});
it('beginnt vier Wochen vor der laufenden', () => {
  expect(toDateInputValue(timelineFirstMonday(new Date(2026, 10, 19)))).toBe('2026-10-19');
});
it('zählt Wochen über die Zeitumstellung', () => {
  expect(timelineWeekCount(new Date(2026, 9, 19), new Date(2026, 10, 23))).toBe(6);
  expect(timelineWeekCount(new Date(2026, 9, 19), new Date(2026, 10, 2))).toBe(3);
});
```

Dazu folgende Tests:
- `describeTimelineWeekHead` für eine laufende Woche mit `W3`, vier datierten Terminen und einem erledigten: `title` `'16.–22.11. · W3 · diese Woche'`, `label` `'16.–22.11. · W3 · diese Woche · 1 von 4 erledigt'`.
- Eine künftige Deload-Woche ergibt `'23.–29.11. · W4 · Deload'`.
- Eine Woche ohne Termine hat ein `label` ohne Zähler.
- `pickTodayNowEntryId`: Heute mit einer erledigten Einheit und zwei Termin-Einheiten liefert die erste Termin-Id. Mit laufender Session liefert es `undefined`, ebenso an einem anderen Tag.
- `describeCalendarUnitDetail`:
  - Erledigte Session ohne `planEntryId` endet auf `'spontan'`.
  - Geplantes Workout mit `{ exerciseCount: 6, minutes: 55 }` ergibt `'6 Übungen · ~55 min'`.
  - Laufende Session mit `{ activeProgress: { completedCount: 6, totalCount: 18 } }` ergibt `'läuft · Satz 7 von 18'`.

Die bestehenden Erwartungen `'nicht geplant'` (Zeile ~236) und `'Kraft · 5 Übungen'` (Zeile ~461) werden auf die neuen Texte umgestellt.

- [ ] **Step 2:** `npx vitest run src/domain/training-calendar.test.ts`. Erwartet: FAIL, weil die neuen Exporte fehlen.
- [ ] **Step 3:** Implementieren. `describeWeekKind` wird aus `program-plan.ts` importiert. Die Raster-Funktionen (`cellMarks`, `CALENDAR_WINDOW_*`, `defaultFirstMonday`, `keepSelectionInWindow`, `rollCalendarToToday`) bleiben bis Task 7 stehen, weil `ProgramsPage` sie noch nutzt.
- [ ] **Step 4:** `npx vitest run src/domain/training-calendar.test.ts && npm run check:strict`. Erwartet: PASS.
- [ ] **Step 5:** Commit `Zeitstrahl: Reichweite, Wochenkopf und Lime-Wahl als reine Regeln`

### Task 2: Seitenvergleiche als erledigte Einheiten

Screen 3 zeigt im Protokoll einen Test („Knie zur Wand · Seitenvergleich · 8 %“), und die Spec sagt „Erledigtes steht immer da“.

**Files:**
- Modify: `src/domain/training-calendar.ts` + Test, `src/db/history-queries.ts` + `history-queries.test.ts`, `src/components/icons/UnitKindIcon.tsx`, `src/pages/ProgramsPage.tsx` (Aufrufer bis Task 7)

**Interfaces:**
- Produces:
  - `CalendarUnitKind = 'strength' | 'mobility' | 'run' | 'test'`
  - `CalendarUnitTarget` erweitert um `{ type: 'test'; testId: string }`
  - `CalendarTest = Pick<ExerciseTest, 'id' | 'recordedAt' | 'exerciseNameSnapshot' | 'asymmetryPercent'>`
  - `BuildCalendarWeeksInput.tests: CalendarTest[]` **ersetzt** `testDates: string[]`. `testDone` wird daraus abgeleitet, mit unveränderter Regel.
  - `loadTestsBetween(fromIso: string, toIso: string): Promise<CalendarTest[]>` **ersetzt** `loadTestDatesBetween`, über den `recordedAt`-Index
- Ein Test wird eine Einheit mit `state: 'erledigt'` am lokalen Tag von `recordedAt`, Name `exerciseNameSnapshot`. Die Reihenfolge am Tag: Sessions, dann Läufe, dann Tests nach `recordedAt`. Detail: `Seitenvergleich · {formatNumber(asymmetryPercent)} %`. Icon: `Scale` aus lucide. Ein Tap führt nach `/tests`, eine Detailseite gibt es nicht.

- [ ] **Step 1:** Failing tests:
  - `buildCalendarWeeks` mit einem Test am Dienstag 18.11. um 08:00 Uhr: Am Dienstag steht eine Einheit `{ kind: 'test', state: 'erledigt', name: 'Knie zur Wand' }`, `day.state === 'erledigt'`, `testDone === true`.
  - `describeCalendarUnitDetail` dieser Einheit mit `asymmetryPercent: 8.3` ergibt `'Seitenvergleich · 8,3 %'`.
  - `loadTestsBetween` liefert nur Tests im Zeitraum, mit den vier Feldern.
- [ ] **Step 2:** Run. Erwartet: FAIL.
- [ ] **Step 3:** Implementieren und `ProgramsPage` auf `loadTestsBetween`/`tests` umstellen. `TrainingCalendar` braucht keine Änderung, weil `UnitKindIcon` die neue Art kennt.
- [ ] **Step 4:** `npx vitest run src/domain/training-calendar.test.ts src/db/history-queries.test.ts && npm run check && npm run check:strict`. Erwartet: PASS.
- [ ] **Step 5:** Commit `Zeitstrahl: Seitenvergleiche stehen als erledigte Einheit im Plan`

### Task 3: Regeln des Wochen-Sheets in `week-sheet.ts`

**Files:**
- Create: `src/domain/week-sheet.ts`, `src/domain/week-sheet.test.ts`

**Interfaces:**
- Consumes: `CalendarWeek` (Task 1/2), `WeekVolume`, `WeekPlanBlock`/`WeekPlanEntry` aus `program-plan.ts`, `PlanEntry`, `PlanEntryLink`, `planEntryState`, `resolveWorkoutCategory`, `weekdayShortLabel`, `isoWeekday`
- Produces:
  - `interface WeekSheetTile { kind: 'strength' | 'mobility' | 'run'; title: 'Kraft' | 'Mobility' | 'Laufen'; count: string; detail?: string; done: boolean }`
  - `buildWeekSheetTiles(input: { week: CalendarWeek; entries: PlanEntry[]; templates: Pick<WorkoutTemplate, 'id' | 'category'>[]; volume?: WeekVolume; todayKey: string }): WeekSheetTile[]`, immer in der Reihenfolge Kraft, Mobility, Laufen
  - `interface WeekSheetBlock { block: WeekPlanBlock; days: string }`
  - `selectWeekSheetBlocks(input: { blocks: WeekPlanBlock[]; entries: PlanEntry[]; links: Record<string, PlanEntryLink>; todayKey: string }): WeekSheetBlock[]`
  - `splitWeekPlanEntries(entries: WeekPlanEntry[]): { shown: WeekPlanEntry[]; hidden: WeekPlanEntry[] }`. `shown` sind die mit `overriddenFields.length > 0`, in Originalreihenfolge.

Regeln:
- **Geplant** je Art: die in der Woche datierten Termine dieser Art, in jedem Zustand. Ein Workout zählt nach `resolveWorkoutCategory(template?.category)`. **Erledigt** je Art: die Einheiten mit `state === 'erledigt'` dieser Art in `week.days`, auch ungeplante. Tests zählen nicht. Das deckt sich mit Screen 4 (Mobility `1 / 1`: eine spontane erledigt, eine geplant).
- **Künftige Woche** (`week.key > todayKey`): `count` lautet `{geplant} geplant`, `done` ist `false`. `detail` gibt es nur bei Laufen mit geplanten km (`{km} km`).
- **Sonst**: `count` lautet `{erledigt} / {geplant}`, `done` ist `erledigt > 0`. `detail`:
  - Kraft: `{formatNumber(Math.round(volume.strength.volumeKg))} kg`, falls größer als 0.
  - Mobility: `formatDurationHours(volume.mobility.durationSeconds)`, falls `sessions > 0`.
  - Laufen mit geplanten km: `{erledigte km} / {geplante km} km`. Ohne geplante km, aber mit erledigten: `{erledigte km} km`. Sonst nichts.
  - Geplante km sind die Summe von `targetDistanceKm` der Lauf-Termine, erledigte km die Summe von `distanceKm` der erledigten Lauf-Einheiten.
- **Blöcke**: Gezeigt werden nur Workouts mit Termin in der Woche, sortiert nach dem frühesten Termin. Hat die Woche keinen Workout-Termin, erscheinen alle Blöcke in der Reihenfolge von `buildWeekPlan` mit `days: ''`.
- `days` sind die Termine dieses Workouts, durch `, ` getrennt. Jeder Termin wird als `{Wochentagskürzel}` geschrieben, mit ` · erledigt` bei `planEntryState === 'erledigt'`, sonst mit ` · heute`, wenn das Datum `todayKey` ist.

- [ ] **Step 1: Failing tests** mit den Werten aus Screen 4 (Woche 16.–22.11.2026, `todayKey = '2026-11-19'`, ein Mittwoch):
  - Einheit B erledigt am Montag, 4.180 kg.
  - Einheit A offen am Mittwoch.
  - Mobility geplant am Samstag, eine spontane Mobility erledigt mit 540 s.
  - Lauf mit 8 km geplant am Donnerstag.

  Daraus folgt:
  - Kacheln: `[{ title: 'Kraft', count: '1 / 2', detail: '4.180 kg', done: true }, { title: 'Mobility', count: '1 / 1', detail: '0:09 h', done: true }, { title: 'Laufen', count: '0 / 1', detail: '0 / 8 km', done: false }]`.
  - Dieselben Termine eine Woche später ergeben `'2 geplant'`, `'1 geplant'` und `'1 geplant'` mit `detail: '8 km'`.
  - Blöcke: Einheit B mit `'Mo · erledigt'` vor Einheit A mit `'Mi · heute'`.
  - Ohne Workout-Termine stehen alle Blöcke mit `days: ''` da.
  - `splitWeekPlanEntries` mit drei Einträgen, davon der zweite überschrieben: `shown` hat einen Eintrag, `hidden` zwei.
- [ ] **Step 2:** `npx vitest run src/domain/week-sheet.test.ts`. Erwartet: FAIL.
- [ ] **Step 3:** Implementieren, rein, ohne Uhr.
- [ ] **Step 4:** Run + `npm run check:strict`. Erwartet: PASS.
- [ ] **Step 5:** Commit `Wochen-Sheet: Kacheln und Vorgaben-Blöcke als reine Regeln`

### Task 4: Termine nur lesen

**Files:**
- Modify: `src/components/PlanEntrySheet.tsx` (wird reine Anzeige), `src/components/PlanWeekSection.tsx` (entfernen: „+ Termin“, „Serie anlegen“, ↑/↓ und die Sheets dazu), `src/db/plan-actions.ts` + `plan-actions.test.ts`, `e2e/helpers.ts`, `e2e/plan-entries.spec.ts`, `e2e/run-log.spec.ts`, `e2e/program-calendar.spec.ts`
- Delete: `src/components/PlanSeriesSheet.tsx`, `src/components/PlanKindSwitch.tsx`, `src/components/PlanRunTargetFields.tsx`, `src/components/WeekdayPicker.tsx`, `src/domain/plan-entry-form.ts` + `.test.ts`

**Interfaces:**
- Produces: `PlanEntrySheet({ open, entry, onClose }: { open: boolean; entry?: PlanEntry; onClose: () => void })`. `defaultDate` entfällt.
- Produces in `e2e/helpers.ts`: `importPlan(page: Page, planEntries: unknown[]): Promise<void>`. Die Funktion geht nach `#/sync`, füllt „Oder JSON einfügen“ mit `{ schemaVersion: 1, planEntries }`, klickt „Vorschau erzeugen“ und dann „Import bestätigen“ und wartet auf den Status „Eingespielt“. Ohne `planRange`, also ohne Entfernen und ohne Sicherungs-Download. `clearPlanEntries` wandert aus `plan-entries.spec.ts` in die Helfer.
- In `plan-actions.ts` entfallen `createPlanEntry`, `updatePlanEntry`, `deletePlanEntry`, `movePlanEntryInDay`, `createPlanSeries` und ihre privaten Helfer (`assertNotTaken`, `assertValid`, `displayName`, `assertNoDuplicate`). Es bleiben `nextOrderInDay`, `loadTakenPlanEntryIds` und `renumberPlanDay`. In `plan.ts` bleibt alles, was der Import nutzt (`PLAN_MESSAGES`, `validatePlanEntryValues`, `toPlanEntryFields`, `expandSeries` für die Beispieldaten).

Anzeige im Sheet: Titel „Termin“, `closeLabel` „Termin schließen“, keine Felder, kein Fuß. Von oben nach unten:
1. Name (`planEntryName`), darunter `formatRunDate(entry.date)`.
2. Bei einem Lauf `describeRunTarget(entry)`, falls nicht leer, und `entry.instructions` über `MarkdownText`. Bei einem Workout `{n} Übungen` und ein Link „Workout ansehen“ nach `/templates/{templateId}`, solange das Workout existiert.
3. `entry.notes`, falls vorhanden.
4. Der bestehende Block für belegte Termine bleibt unverändert: „Erledigt am …“ bzw. „Läuft gerade“ mit dem Link „Zur Session“ bzw. „Zum Lauf“.
5. Ein Satz in `text-content-muted`: „Termine kommen per Import aus dem Projekt.“

Die Regel „rendert nichts, bis die Verweise geladen sind“ bleibt.

- [ ] **Step 1:** E2E zuerst umstellen. `plan-entries.spec.ts` und `run-log.spec.ts` legen Termine nur noch über `importPlan` an, nicht mehr über das Sheet.
  - Ersatzlos entfallen die Tests, die das Formular prüfen: „Serie legt Termine an …“, „Doppelter Termin …“, „Fehler einer Dauer von 0“ und in `program-calendar.spec.ts` „+ Termin belegt das Datum vor“. Die Regeln dahinter prüft `plan-import.test.ts`.
  - „legt einen Lauf-Termin an …“ wird zu „ein importierter Lauf-Termin öffnet nur die Anzeige“: Tap auf den künftigen Termin, im `[data-sheet]` stehen Titel und Vorgabe, und es gibt **keinen** Knopf „Termin speichern“ und keinen „Termin löschen“.
  - „passt bei 320px“ prüft das Anzeige-Sheet.
- [ ] **Step 2:** `caffeinate -i npx playwright test e2e/plan-entries.spec.ts`. Erwartet: FAIL am neuen Test, weil noch Formular-Knöpfe da sind.
- [ ] **Step 3:** Sheet umbauen, Schreib-UI und Schreib-API entfernen, die Dateien löschen.
  - In `plan-actions.test.ts` entfallen die Fälle, die nur die gelöschten Funktionen prüfen.
  - Fälle für `loadTakenPlanEntryIds`, `renumberPlanDay` und `nextOrderInDay` bleiben und legen ihre Termine direkt per `db.planEntries.bulkAdd` an.
  - Prüfen mit `grep -rn "createPlanEntry\|updatePlanEntry\|deletePlanEntry\|movePlanEntryInDay\|createPlanSeries\|PlanSeriesSheet\|WeekdayPicker\|plan-entry-form" src e2e`. Erwartet: keine Treffer.
- [ ] **Step 4:** `npm run lint && npm run check && npm run check:strict && npm test`. Danach `caffeinate -i npx playwright test e2e/plan-entries.spec.ts`, `… e2e/run-log.spec.ts` und `… e2e/program-calendar.spec.ts`. Erwartet: alles grün.
- [ ] **Step 5:** CLAUDE.md, Abschnitt „The dated plan“:
  - `PlanEntrySheet` ist reine Anzeige. `PlanSeriesSheet`, „+ Termin“ und ↑/↓ sind entfallen.
  - Der Punkt „A series is a copy, not a rule“ beschreibt nur noch die Beispieldaten (`expandSeries`). Neue Termine kommen über den Import.
  - Der Punkt „Writes follow the run rules“ gilt jetzt für den Import und die Datenkorrektur.
  - Der Satz zu `fieldNavigation` der beiden Sheets entfällt.
- [ ] **Step 6:** Commit `Termine nur lesen: Anzeige statt Formular, Schreib-API entfernt`

### Task 5: Der Zeitstrahl ersetzt Home

**Files:**
- Create: `src/pages/PlanPage.tsx`, `src/components/TimelineWeek.tsx` (Wochenkopf + Tage), `src/components/TimelineUnitRow.tsx` (eine Einheit in allen Zuständen), `src/hooks/useTodayKey.ts`, `e2e/plan-timeline.spec.ts`
- Modify: `src/App.tsx` (`/` zeigt `PlanPage`), `src/db/plan-queries.ts` + Test, `src/db/history-queries.ts` + Test, `e2e/helpers.ts`, `e2e/session-start-focus.spec.ts`, `e2e/run-log.spec.ts`, `e2e/plan-entries.spec.ts`, `e2e/week-control.spec.ts`, `e2e/library-and-tests.spec.ts`, `e2e/session-logging.spec.ts`, `e2e/accessibility.spec.ts` (Eintrag `['Heute', './']` → `['Plan', './']`)
- Delete: `src/pages/Home.tsx`

**Interfaces:**
- Consumes: Task 1 (`timeline*`, `describeTimelineWeekHead`, `pickTodayNowEntryId`, `describeCalendarUnitDetail`), Task 2 (`loadTestsBetween`, Art `test`), Task 4 (`PlanEntrySheet`), sowie `navigateToStartedSession`, `startSessionFromTemplate`, `RunLogSheet`, `useUiStore.setNowSheetOpen`, `pickNextTemplate`, `loadTemplateRecency`, `loadTemplateExerciseCounts`, `loadTemplateMinutes`, `loadSessionVolumes`, `evaluateBackupStatus`, `exportDatabaseSnapshot`, `resolveWeekControl`, `countTemplatesWithWeekdays`
- Produces:
  - `useTodayKey(): string`: der lokale Tag (`YYYY-MM-DD`). Er wird neu gelesen bei `visibilitychange` → `visible`, bei `focus` und jede Minute, so wie heute in `ProgramsPage`.
  - `loadLastPlanDate(): Promise<string | undefined>` in `plan-queries.ts`, über `orderBy('date').last()`
  - `loadEarliestTimelineDate(): Promise<string | undefined>` in `history-queries.ts`: der früheste lokale Tag über abgeschlossene Sessions (`completedAt`), Läufe (`date`), Tests (`recordedAt`) und Termine (`date`), je über den Index
  - `loadActiveSessionProgress(): Promise<{ sessionId: string; completedCount: number; totalCount: number } | undefined>` in `history-queries.ts`, über `summarizeSessionProgress`
  - `onOpenWeek(key: string)` als Prop von `TimelineWeek`. Task 6 hängt das Wochen-Sheet daran, bis dahin ist es ein No-op.

Seite `PlanPage` in `AppShell title="Plan"`. Von oben nach unten:

1. **Kopfzeilen**, jede ist eine schmale Zeile mit 44px:
   - Backup-Erinnerung (`data-backup-reminder`), nur wenn `needsReminder` gilt. Sie ist in Warnfarbe (`warning`, nicht Lime), hat das Icon `ShieldAlert` und den Text `1 Training ungesichert` bzw. `{n} Trainings ungesichert`. Der Knopf „Sichern“ ruft `exportDatabaseSnapshot({ preferShare: true })` mit der Fehler- und Abbruch-Behandlung aus Home.
   - Override (`data-week-override`), nur bei `weekControl.mode === 'override'`. Neutraler Text `Woche von Hand gesetzt: W{n}` und ein Link „Einstellungen“ nach `/settings`.
   - Wochentags-Hinweis (`data-plan-weekday-hint`), Text und Ziel wörtlich aus `PlanWeekSection`.
2. **„Frühere Wochen“** (`data-load-earlier`), ein Ghost-Knopf über der ersten Woche. Er fehlt, wenn `loadEarliestTimelineDate()` leer ist oder nicht vor `firstMonday` liegt.
   - Ein Tap schiebt `firstMonday` um `TIMELINE_LOAD_STEP_WEEKS` zurück.
   - **Scroll-Ausgleich:** Vor dem Setzen merkt sich die Seite die alte erste Woche und deren `getBoundingClientRect().top`. In einem `useLayoutEffect` auf `firstMonday` scrollt sie per `window.scrollBy(0, neu − alt)` zurück.
3. **Wochen** (`data-timeline`), je ein `TimelineWeek` von `firstMonday` (`useState(() => timelineFirstMonday(heute))`) bis `timelineLastMonday(heute, lastPlanDate)`. Daraus wird `buildCalendarWeeks({ firstMonday, weeks: timelineWeekCount(...), … })`. Geladen wird der ganze Zeitraum einmal: `loadPlanBetween`, `loadCompletedSessionsBetween`, `loadRunsBetween`, `loadTestsBetween` und `loadSessionVolumes` für alle erledigten Sessions.
4. **„↓ Heute“-Pill** (`data-jump-today`, `aria-label="Zu heute springen"`). Sie ist `fixed` und mittig, mit demselben unteren Abstand wie das Padding in `AppShell`: `7rem`, mit laufender Session `10.5rem`, jeweils plus `env(safe-area-inset-bottom)`.
   - Sie ist sichtbar, solange der heutige Tag (`data-timeline-today`) laut `IntersectionObserver` nicht im Viewport liegt.
   - Der Pfeil zeigt nach oben, wenn heute oberhalb liegt. Das Ziel ist der Abschnitt der laufenden Woche.

Öffnen auf heute: Sobald Termine und Sessions geladen sind, einmal pro Mount `scrollIntoView({ block: 'start' })` auf den Abschnitt der laufenden Woche, ohne Animation.

`TimelineWeek`:
- **Kopf:** ein `button`, `sticky top-0 z-10` auf `bg-app`, mit `aria-label` = `label` + ` · Woche öffnen` und den Attributen `data-timeline-week-head` und `data-current`, wenn es die laufende Woche ist.
  - Links steht `title`, mit `truncate`. Rechts stehen `{done} von {planned}`, ein Balken für den Anteil und `ChevronRight`, beides `shrink-0`. Zähler und Balken fehlen bei `planned === 0`.
  - Die laufende Woche hat einen Rahmen in Tinte (`border-accent`).
- **Abschnitt:** `data-timeline-week={key}`. Die Tage tragen `data-timeline-day={key}`, der heutige zusätzlich `data-timeline-today` und `scroll-mt-16`.
  - Links eine Datumsspalte: `weekdayShortLabel` über dem Tag im Monat, heute statt der Zahl `heute`.
  - Rechts die Einheiten. Ein Tag ohne Einheit (und nicht heute) ist eine dünne gestrichelte Zeile `frei`.
- **Heute ohne offenen Termin:** Die gestrichelte Zeile „Heute trainieren“ (`data-today-free`) mit dem Hinweis `am längsten her: {pickNextTemplate(...).name}` (der Hinweis fehlt ohne Workouts) ruft `setNowSheetOpen(true)` auf. Das gilt auch, wenn heute schon etwas erledigt ist.

`TimelineUnitRow`, je nach Zustand, mit den Ankern `data-day-unit` (Art), `data-unit-state`, `data-plan-entry` und `data-plan-entry-state` (Namen aus `PlanWeekSection`, damit die Selektoren mitwandern):

| Einheit | Aussehen | Tap |
|---|---|---|
| erledigt: Session / Lauf / Test | Waldgrün (`bg-success`), Detailzeile | `Link` nach `/history/session/:id` / `/runs/:id` / `/tests` |
| belegt durch laufende Session | weiß, Detail `läuft · Satz …` (`loadActiveSessionProgress`) | `Link` nach `/session/:id`, **ohne** `openFocus` |
| heute, `pickTodayNowEntryId` | **Lime**-Karte (`NowCard`, `data-now-unit`), `label="Heute · {name}"`, Aktionsmarke `Start` bzw. `Eintragen` in Tinte | Workout: `startSessionFromTemplate(templateId, { planEntryId })` → `navigateToStartedSession`. Lauf: `RunLogSheet` mit `initialPlanEntryId` |
| heute, weitere offene | weiß, Textmarke `Start` / `Eintragen` | wie die Lime-Karte |
| heute offen bei laufender Session | weiß, ohne Marke | `PlanEntrySheet` |
| künftig geplant | weiß, Icon im Tintenring | `PlanEntrySheet` |

`exerciseCount` kommt aus `loadTemplateExerciseCounts`, `minutes` aus `loadTemplateMinutes`. Startfehler zeigt ein `Alert` über der Liste. Eine Session, die ohne Termin läuft, erscheint nicht im Zeitstrahl, denn der Streifen zeigt sie. Erst abgeschlossen steht sie dort als `spontan`.

E2E-Helfer und Specs, die über Home liefen:
- `startSampleSession` und `session-start-focus.spec.ts` starten über das Jetzt-Sheet: Klick auf „Jetzt trainieren“, dann im `[data-sheet]` auf „Einheit A“ (`.first()`). Grund: Je nach Wochentag steht „Einheit A“ als künftiger Termin im Plan, und ein Tap darauf öffnet nur noch die Anzeige.
- Neuer Helfer `openRunLogFromNow(page)`. `run-log.spec.ts` nutzt ihn überall, wo es „Lauf eintragen“ auf Home klickte. `Heute · Intervalle …` bleibt der Name der Lime-Karte.
- `plan-entries.spec.ts`:
  - „Home startet den heutigen Termin“ und „heute geplantes Workout startet aus der Liste“ werden zu einem Test: Die Lime-Karte startet und markiert den Termin erledigt.
  - „ohne Termine bleibt Am längsten her“ wird zu „ohne Termin heute steht ‚Heute trainieren‘ mit ‚am längsten her‘“.
  - „an einem Tag ohne Termin bleibt jedes Workout startbar“ und der Test zu „Nächster Termin“ entfallen. Das deckt `now-sheet.spec.ts` ab.
- `week-control.spec.ts`:
  - Test 1 prüft `[data-week-override]` mit `W{n}` auf `/`.
  - Test 2 prüft, dass die Zeile nach dem Zurücksetzen fehlt.
  - Test 3 („Woche ansehen“) entfällt, Ersatz kommt in Task 6.
- `library-and-tests.spec.ts` „Sicherung“: `/ungesichert/` und der Knopf „Sichern“.
- `session-logging.spec.ts` „bei laufendem Training …“: auf `/` das Jetzt-Sheet öffnen, dort steht „Ein Training läuft bereits“.

- [ ] **Step 1:** Unit-Tests für die drei Abfragen:
  - `loadLastPlanDate` ist leer ohne Termine und liefert sonst den spätesten Tag.
  - `loadEarliestTimelineDate` liefert das Minimum über die vier Tabellen. Eine abgebrochene Session zählt nicht.
  - `loadActiveSessionProgress` liefert 6 von 18 für eine Session mit 18 Zeilen, davon 6 erledigt, und `undefined` ohne aktive Session.
- [ ] **Step 2:** `e2e/plan-timeline.spec.ts` (Beispieldaten, Termine über `clearPlanEntries` + `importPlan`):
  1. Öffnet auf heute: `[data-timeline-today]` liegt im Viewport, und genau ein Wochenkopf hat `data-current`.
  2. Reichweite: Mit einem Termin in zehn Wochen ist der letzte `[data-timeline-week]` dessen Montag. Ohne Termine ist es der Montag der nächsten Woche.
  3. Lime startet: Mit einem Termin „Einheit A“ heute gibt es genau ein `[data-now-unit]`. Ein Klick darauf führt zu `#/session/`, und `[data-sheet]` ist sichtbar.
  4. Heute ohne Plan: `[data-now-unit]` hat die Anzahl 0, `[data-today-free]` enthält „am längsten her“, und ein Klick öffnet den Dialog „Jetzt trainieren“.
  5. **Review Focus 1:** Termine „Einheit A“ und Lauf „Intervalle“ heute.
     - Einheit A über die Lime-Karte starten, das Sheet schließen und minimieren, zurück nach `/`.
     - Danach hat `[data-now-unit]` die Anzahl 0, und die Einheit-A-Zeile enthält `läuft · Satz`.
     - Ein Tap auf „Intervalle“ öffnet `[data-sheet]` ohne Session-Start, die URL bleibt `/`.
  6. Protokoll: Die abgeschlossene Beispiel-Session steht als `[data-unit-state="erledigt"]`. Der Beispiel-Test steht als `[data-day-unit="test"]` und enthält „Seitenvergleich“.
  7. **Review Focus 5:** `top` des ersten Wochenkopfs merken, `[data-load-earlier]` klicken. Danach gibt es 4 Wochen mehr, und derselbe Kopf (über `data-timeline-week`) steht höchstens 2px vom alten `top` entfernt.
  8. Pill: ans Ende scrollen, dann ist `[data-jump-today]` sichtbar. Nach dem Klick ist `[data-timeline-today]` im Viewport und die Pill verborgen.
  9. Bei 320px: `scrollWidth` von `[data-timeline]` ist höchstens dessen `clientWidth`, und kein Wochenkopf ist breiter als der Viewport.
  10. **Review Focus 4:** `page.clock.install({ time: <heute 23:59 lokal> })`, dann `page.reload()`, dann `page.clock.runFor('02:00')`. Danach trägt `[data-timeline-today]` den Tag von morgen.
- [ ] **Step 3:** `caffeinate -i npx playwright test e2e/plan-timeline.spec.ts`. Erwartet: FAIL.
- [ ] **Step 4:** Abfragen, Hook, Komponenten und Seite bauen, Route umstellen, `Home.tsx` löschen, die genannten Specs umstellen.
- [ ] **Step 5:**
  - `npm run lint && npm run check && npm run check:strict && npm test`.
  - Danach einzeln: `caffeinate -i npx playwright test e2e/plan-timeline.spec.ts`, `… e2e/plan-entries.spec.ts`, `… e2e/run-log.spec.ts`, `… e2e/week-control.spec.ts`, `… e2e/session-start-focus.spec.ts`, `… e2e/library-and-tests.spec.ts`, `… e2e/session-logging.spec.ts`, `… e2e/accessibility.spec.ts`, `… e2e/now-sheet.spec.ts`.
  - Erwartet: alles grün.
- [ ] **Step 6:** CLAUDE.md:
  - Neuer Abschnitt „### The plan: one timeline“ direkt vor „### The dated plan“. Er beschreibt Reichweite, Nachladen mit Scroll-Ausgleich, Wochenkopf, die Zustände aus der Tabelle oben, „Heute trainieren“, die Kopfzeilen, Pill, `useTodayKey` und die Test-Anker.
  - In „The dated plan“ wird „Home has three exclusive cases“ durch einen Verweis auf diesen Abschnitt ersetzt, und `PlanWeekSection` wird beim Wochentags-Hinweis durch „die Kopfzeile des Plans“ ersetzt.
  - Im Absatz „`weekOverride` has exactly one writer“: Home hat kein Wochen-Panel mehr, die Override-Zeile des Plans liest nur.
  - In „Data loss on iOS“ und im Analyse-Export: „the reminder on Home“ wird zu „the reminder at the head of the plan“.
  - Im Absatz zu `next-workout.ts`: „Am längsten her“ ist jetzt der Hinweis in „Heute trainieren“.
  - Im Session-Abschnitt: „Home no longer carries a resume card“ bleibt sinngemäß und bezieht sich auf den Plan.
- [ ] **Step 7:** Commit `Plan: Zeitstrahl ersetzt die Startseite`

### Task 6: Wochen-Sheet

**Files:**
- Create: `src/components/WeekSheet.tsx`, `src/components/WeekPrescriptionBlock.tsx`, `e2e/week-sheet.spec.ts`
- Modify: `src/pages/PlanPage.tsx` (öffnen), `e2e/accessibility.spec.ts` (neuer Test „das Wochen-Sheet hält sich an dieselben Regeln“, mit den vorhandenen Mess-Helfern im geöffneten Sheet)

**Interfaces:**
- Consumes: Task 3 (`buildWeekSheetTiles`, `selectWeekSheetBlocks`, `splitWeekPlanEntries`), `buildCalendarWeeks` mit `weeks: 1`, `buildWeekPlan`, `describeWeekPrescription`, `SupersetBlock`, `loadWeeklyVolume(monday, monday)`, `resolveWeekControl`
- Produces:
  - `WeekSheet({ weekKey, onChangeWeek, onClose }: { weekKey: string | null; onChangeWeek: (key: string) => void; onClose: () => void })`. Das Sheet ist offen bei `weekKey !== null` und lädt die Daten seiner Woche selbst.
  - `WeekPrescriptionBlock({ block, days, bandNameById, programWeekNumber })`. Die Darstellung von Block, Zeile und Segmenten wird aus `ProgramsPage` (`WeekPlanBlockCard`, `WeekPlanRow`, `PrescriptionSegmentText`) übernommen, **ohne** `onEdit`.
- In `PlanPage`: `const [sheetWeek, setSheetWeek] = useState<string | null>(null)`, mit dem Kommentar, dass Ansehen nie `weekOverride` ist. Der Wochenkopf ruft `setSheetWeek(week.key)` auf. ‹ › rechnen über `shiftWindow(parseLocalDate(key), ±1)`.

Aufbau nach Screen 4/5 (`Sheet`, `label` = Titel, `closeLabel="Woche schließen"`, Wurzel `data-week-sheet={weekKey}`):
1. **Kopf:**
   - Augenbraue: `describeWeekRange`, dazu ` · diese Woche` für die laufende Woche.
   - Titel: `W{n}`, dazu ` · {describeWeekKind}`. Ohne Programmwoche heißt der Titel `Woche`.
   - `IconButton` „Vorige Woche“ und „Nächste Woche“.
2. **Kacheln** (`data-week-tile={kind}`, mit `data-tile-done` bei `done`): drei Spalten, unter 360px eine Spalte, `count` groß, `detail` darunter. Mit `done` sind sie Waldgrün (`DONE_SURFACE`), sonst weiß.
3. **Testtermin** (`data-week-test`), bei `hasTestAppointment`, als Link nach `/tests`:
   - Mit `testDone` eine `DoneRow` „Seitenvergleich gemessen“.
   - Sonst eine weiße Zeile „Testtermin · Seitenvergleich in dieser Woche“.
4. **Override-Hinweis**, nur in der laufenden Woche, wenn `weekControl.mode === 'override'` und `effectiveWeek` von der gezeigten Programmwoche abweicht. Neutraler Text: `Von Hand auf W{e} gesetzt – ein Start trainiert W{e}, nicht W{n}.`
5. **„Vorgaben W{n}“**, nur mit Programmwoche. Je Block aus `selectWeekSheetBlocks` ein `WeekPrescriptionBlock` (`data-week-prescription={templateId}`):
   - Kopf: Workout-Name und `days`.
   - Dann die `shown`-Zeilen, jede mit dem Abzeichen `W{n}` (`data-rule-badge`, neutral, ersetzt das bisherige „Woche“).
   - Dann ein Disclosure-Knopf mit `aria-expanded`. Er heißt `+ {k} weitere wie im Workout`, oder `alle {k} Übungen wie im Workout`, wenn `shown` leer ist. Aufgeklappt zeigt er alle Zeilen in Originalreihenfolge (ephemerer `useState` je Block).
6. Fußnote in `text-content-muted`: „Nur zum Lesen. Wochenvorgaben änderst du im Workout unter „Wochenprogression“.“

Nichts in diesem Sheet schreibt und nichts startet.

- [ ] **Step 1:** `e2e/week-sheet.spec.ts`. `beforeEach`: Beispieldaten, Programmstart über die Einstellungen auf den Montag dieser Woche (wie `setProgramStart` in `program-week.spec.ts`), Termine über `importPlan`. Tests:
  1. Ein Tap auf den Kopf der laufenden Woche öffnet `[data-week-sheet]`. Die Kacheln Kraft, Mobility und Laufen sind da, und unter „Vorgaben W1“ steht „Einheit A“.
  2. Aus `program-week.spec.ts` übernommen:
     - „zeigt je Woche die Vorgaben, die der Sessionstart schreiben würde“, umgestellt auf ‹ ›.
     - „kennzeichnet eine Deload-Woche …“: Der Titel enthält „Deload“, und die Zeile zeigt die verringerte Satzzahl mit `W{n}`.
  3. **Review Focus 2:** zweimal „Nächste Woche“, einmal „Vorige Woche“, schließen. In `#/settings` ist der Schalter „Woche von Hand setzen“ danach aus.
  4. **Review Focus 3:** Override in den Einstellungen auf W2 setzen. Dann zeigt das Sheet der laufenden Woche „Von Hand auf W2 gesetzt“.
  5. Disclosure: „+ … weitere wie im Workout“ klicken, danach steigt die Zeilenzahl im Block, und `aria-expanded` ist `"true"`.
  6. Bei 320px: Die Kacheln laufen nicht über, `scrollWidth` ist höchstens `clientWidth`.
- [ ] **Step 2:** Run. Erwartet: FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `npm run lint && npm run check && npm test`. Danach `caffeinate -i npx playwright test e2e/week-sheet.spec.ts` und `… e2e/accessibility.spec.ts`. Erwartet: grün.
- [ ] **Step 5:** CLAUDE.md: unter „The plan: one timeline“ ein Unterabschnitt „#### The week sheet“.
  - Hierher wandern aus dem Programm-Tab-Abschnitt die Regeln „week selection is ephemeral `useState`“, „No start beside the prescriptions“, „cards disappear where there is no program week“ und „inside the span a week without rules is not empty“. Sie werden auf das Sheet bezogen.
  - Neu dazu: Kachel-Regel, Blockauswahl, Disclosure, Override-Hinweis, Anker.
  - Im Absatz „The weekly calculation is one function with four readers“ heißen die Leser jetzt History, die Kacheln des Wochen-Sheets und `wochen.csv`.
- [ ] **Step 6:** Commit `Wochen-Sheet: Kacheln, Testtermin und Vorgaben zum Lesen`

### Task 7: Programm-Tab und Raster entfernen

**Files:**
- Modify: `src/App.tsx` (`/programs` → `<Navigate to="/" replace />`), `src/lib/navigation.ts` + Test (der Sonderfall `/programs` → `plan` entfällt, `/programs/manage` bleibt `library`), `src/domain/training-calendar.ts` + Test (entfernen: `cellMarks`, `CellMark`, `CALENDAR_WINDOW_WEEKS`, `CALENDAR_WINDOW_STEP`, `defaultFirstMonday`, `keepSelectionInWindow`, `rollCalendarToToday`; `shiftWindow` bleibt), `src/components/TemplateProgressionSection.tsx` (Link „Wochen“ → `/`, Text „Plan“), `src/pages/TemplateDetailPage.tsx` (Link-Text „Termine im Plan“, Ziel `/`), `src/db/bootstrap.ts` (Kommentar „Trainingskalender“ → „Zeitstrahl“), `e2e/plan-entries.spec.ts`, `e2e/run-log.spec.ts`, `e2e/library-import.spec.ts`, `e2e/now-sheet.spec.ts`, `e2e/accessibility.spec.ts` (Eintrag `Programm` entfällt)
- Delete: `src/pages/ProgramsPage.tsx`, `src/components/TrainingCalendar.tsx`, `src/components/WeekVolumeTiles.tsx`, `src/components/PlanWeekSection.tsx`, `e2e/program-calendar.spec.ts`, `e2e/program-week.spec.ts`
- Bleibt: `ProgressionRuleFields.tsx` und `progression-rule-form.ts`, weil `TemplateProgressionSection` sie als Übergangs-Editor braucht. `WeekStepper.tsx` bleibt für die Einstellungen.

- [ ] **Step 1:** Specs umstellen.
  - Alle `goto('./#/programs')` mit anschließender Wochenwahl werden zu `goto('./')` plus Selektor auf `[data-timeline-day="…"]`. Die Hilfsfunktion `selectWeekOf` entfällt.
  - `library-import.spec.ts` „… zeigt sie im Programm-Tab“ heißt jetzt „… im Plan“ und prüft die beiden `[data-timeline-day]`.
  - Neu in `navigation.spec.ts`: `goto('./#/programs')` landet auf `/`, und „Plan“ hat `aria-current="page"`.
  - Was `program-calendar.spec.ts` noch an Eigenem prüfte und nicht in `plan-timeline.spec.ts` steht, wird dorthin übernommen: 320px mit drei Einheiten an einem Tag, ein Lauf führt zur Detailseite. Danach wird die Datei gelöscht.
- [ ] **Step 2:** Entfernen und umleiten. `grep -rn "ProgramsPage\|TrainingCalendar\|WeekVolumeTiles\|PlanWeekSection\|cellMarks\|CALENDAR_WINDOW\|#/programs'" src e2e` liefert danach keine Treffer.
- [ ] **Step 3:** `npm run lint && npm run check && npm run check:strict && npm test && npm run build`, dann alle E2E-Specs einzeln nach dem Muster aus den Global Constraints. Erwartet: grün.
- [ ] **Step 4:** CLAUDE.md:
  - Der Abschnitt „### The program tab answers two questions …“ samt „#### The training calendar …“ entfällt.
  - Erhalten bleiben, verschoben unter „The plan: one timeline“ und angepasst:
    - Der Navigations-Absatz („five entries and a centre button“): `/programs` leitet um, `/programs/manage` ist Bestand.
    - Der `NowSheet`-Punkt als eigener Unterabschnitt „#### The Now sheet“. Statt „the day list's ‚+ Einheit‘“ steht dort „the timeline's ‚Heute trainieren‘ row“.
    - Die Punkte zu `programWeekStart` und zu `ProgramWeek.kind === 'test'` (jetzt: Testtermin im Wochen-Sheet).
    - Der Absatz zu `UnitKindIcon`, ergänzt um `Scale` für Tests.
    - Die Lese-Regel „Reading is split by what each part needs“, bezogen auf `PlanPage`.
  - Der Absatz zu `ProgressionRuleFields` sagt, dass nur noch `TemplateProgressionSection` es nutzt, als Übergangs-Editor bis zum Programm-Import.
- [ ] **Step 5:** Commit `Plan: Programm-Tab, Raster und Tagesliste entfernt, /programs leitet um`

### Task 8: Vertrag, Doku-Abgleich und Abschluss

**Files:**
- Modify: `.claude/skills/gym-book-architect/SKILL.md` **und** `.trae/skills/gym-book-pwa-architect/SKILL.md` (beide gleich), `CLAUDE.md`, `docs/superpowers/specs/2026-11-17-navigation-zeitstrahl-design.md`

- [ ] **Step 1:** Architekturvertrag, in beiden Kopien:
  - Unter „The dated plan“ wird „A series is a copy, not a rule: creating one writes individual entries and is done“ zu: Termine kommen ausschließlich über den Bibliothek-Import, die App zeigt sie nur an, und eine Serie gibt es nur noch als Kopie in den Beispieldaten. Kein wiederkehrender Plan, keine automatische Umplanung bleibt stehen.
  - In „v1 scope“ wird „dated training plan (single entries for workouts and runs, series as copies)“ zu „dated training plan (single entries for workouts and runs, written by the library import, read-only in the app)“.
- [ ] **Step 2:** `grep -n "Home\b\|program tab\|Programm-Tab\|PlanWeekSection\|TrainingCalendar\|WeekVolumeTiles\|PlanSeriesSheet\|PlanEntrySheet\|/programs\b" CLAUDE.md`. Jeder Treffer beschreibt den neuen Stand. „program tab“ verschwindet ganz, das ist ein offener Minor aus Etappe 1.
- [ ] **Step 3:** `npm run lint && npm run check && npm run check:strict && npm test && npm run build`. Danach ist der Dev-Server beendet, und alle E2E-Specs laufen einzeln. Erwartet: alles grün. Die Ausgaben werden berichtet.
- [ ] **Step 4:** Spec: Status auf „Etappe 2 umgesetzt“. Punkt 6 unter „Offen für den Umsetzungsplan“ ist erledigt und wird gestrichen.
- [ ] **Step 5:** Commit `Doku: Navigation Etappe 2 umgesetzt`. **Nicht pushen.** Den Nutzer fragen, denn der Push löst den Pages-Deploy aus (Weg über `gh`, siehe Memory „Deployment-Setup Gym Book“).

---

## Nicht in dieser Etappe

- Programm-Import (eigene Etappe mit eigener Spec), danach entfallen `TemplateProgressionSection` und das Programm-CRUD in `/programs/manage`.
- Offene Minors aus Etappe 1, die hier nicht berührt werden:
  - Der Jetzt-Knopf hat keine sichtbare Beschriftung.
  - Der Knopf springt beim Start und Ende einer Session um 24px.
  - Es fehlt ein E2E-Test für den Start über TemplatesPage und TemplateDetailPage. Das gehört zu Etappe 4, wenn der Startknopf dort entfällt.
  - `LibraryPage` zählt sequenziell.
- SSL-Modus für `gym`, Node-20-Warnung in GitHub Actions.
