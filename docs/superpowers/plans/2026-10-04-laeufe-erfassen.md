# Läufe erfassen – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Läufe (Strecke, Dauer, Höhenmeter, Ø Puls) lassen sich eintragen, ansehen, ändern und löschen; Workouts tragen eine Art (Kraft/Mobility); das Wochenvolumen von Kraft, Mobility und Laufen steht im Verlauf, auf Heute und im Analyse-Export.

**Architecture:** Eine neue, flache Tabelle `runLogs` (Dexie `version(5)`) neben der Session-Welt, die davon nichts merkt. Reine Regeln in `src/domain/run.ts`, `run-form.ts`, `workout-category.ts` und `weekly-volume.ts`; Schreib-API in `src/db/run-actions.ts`; die Wochenrechnung ist *eine* Funktion mit drei Lesern (Verlauf, Heute, `wochen.csv`).

**Tech Stack:** TypeScript, React, Dexie + `dexie-react-hooks`, Zod, Tailwind, Vitest (jsdom + fake-indexeddb), Playwright (WebKit).

**Spec:** [docs/superpowers/specs/2026-10-04-laeufe-erfassen-design.md](../specs/2026-10-04-laeufe-erfassen-design.md)

## Global Constraints

- Dexie: genau ein neuer Block `this.version(5).stores({ runLogs: 'id, date' })`, kein `upgrade()`. Keine weiteren Indizes; `category` und `templateCategorySnapshot` bleiben unindiziert.
- Backup: `SNAPSHOT_SCHEMA_VERSION` bleibt `1`. `runLogs` als `z.array(runLogSchema).optional().default([])`; neue Felder als `.optional()`. **Zod verwirft unbekannte Schlüssel** – jedes neue Feld muss ins Schema, sonst verschwindet es beim Wiederherstellen.
- `src/domain/` bleibt rein (kein Dexie, kein React). `npm run check:strict` (deckt `src/domain`, `src/lib`, `src/db`, `src/test`) muss grün bleiben.
- `undefined` an `Table.update` löscht eine Eigenschaft: optionale Lauf-Felder werden ausdrücklich über `null` geleert; „Kraft“ wird nie als `'strength'` geschrieben (eine Schreibweise, wie `normalizeTracksHeight`).
- Pace wird nie gespeichert. `date` ist `YYYY-MM-DD` Ortszeit und wird nur über `parseLocalDate` gelesen, nie über `new Date('YYYY-MM-DD')`.
- Woche = Kalenderwoche ab Montag, Ortszeit (`startOfCalendarWeek`); weiterzählen über `setDate(+7)`, nie über `7 * 24h`.
- Gezählte Sessions in der Wochenrechnung: `status === 'completed'` **und** ≥ 1 abgehakte Arbeitssatz-Zeile; Woche nach `completedAt`; Kraftvolumen nur für Übungen mit `supportsReps(trackingMode)` (wie die Spalte `volumen` in `sessions.csv`).
- Fehlermeldungen aus `db/` deutsch, wörtlich wie in der Spec (Abschnitt 2). UI-Texte und Kommentare deutsch mit echten Umlauten; jede gerenderte Zahl über `formatNumber`.
- Farben: keine Limette auf neuen Flächen außer der bestehenden `NowCard`; „erledigt“ = Waldgrün (`DoneCard`/`DoneRow`); Touch-Ziele ≥ 44px.
- `src/domain/analysis-export.ts` enthält ein Steuerzeichen – `grep` hält es für binär. Mit `grep -a` oder dem Read-Tool lesen.
- Direkt auf `main` committen, **nicht pushen** (Push deployt). Jede Commit-Nachricht endet mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- E2E immer als `caffeinate -i npm run test:e2e …`, vorher einen alten Dev-Server auf 5173 beenden.

## Review Focus

1. **Lauf an einem Sonntag eingetragen** (`date: '2026-10-04'`) – erwartet: zählt in die Woche ab Mo 28.09., nicht in die folgende; gilt auch westlich von Greenwich. Getestet in Task 5.
2. **Puls beim Bearbeiten geleert, sonst nichts geändert** – erwartet: `averageHeartRate` fehlt danach im Datensatz (nicht `0`), alle anderen Felder unverändert, `updatedAt` neu. Getestet in Task 2.
3. **Dauer als „0 Std 75 Min“ oder nur „52“ in Min** – erwartet: 75 Min ist ein Feldfehler „0–59“; leere Std/Sek neben gefüllten Min zählen als 0 → 3120 s. Getestet in Task 1.
4. **Strecke mit Komma („7,5“) und mit Punkt („7.5“)** – erwartet: beides 7,5 km; „7,5,1“ ist ungültig, nicht 7,5. Getestet in Task 1.
5. **Zwei Läufe am selben Tag** – erwartet: Woche zählt 2, Liste zeigt beide, die Grafik zeigt zwei Punkte (heute kollidiert der React-`key` in `ProgressChart` auf `completedAt`). Getestet in Task 5 und Task 8.

---

## Dateien

| Datei | Änderung |
|---|---|
| `src/domain/models.ts` | `RunLog`; `WorkoutTemplate.category?`; `WorkoutSession.templateCategorySnapshot?` |
| `src/domain/run.ts` (+ Test) | Dauer, Pace, Formatierung, Prüfregeln |
| `src/domain/run-form.ts` (+ Test) | Formularzustand ↔ Werte, Feldfehler |
| `src/domain/workout-category.ts` (+ Test) | `WorkoutCategory`, normalisieren, beschreiben |
| `src/domain/weekly-volume.ts` (+ Test) | `buildWeeklyVolume`, `describeWeekVolume`, `describeWeekCounts` |
| `src/domain/calendar-week.ts` | `isoWeekNumber` |
| `src/domain/session.ts` | Snapshot der Art in `materializeSession` |
| `src/domain/library-import.ts` | `category` an Workouts |
| `src/domain/analysis-export.ts` | `laeufe.csv`, `wochen.csv`, Spalte `art`, `meta.json` |
| `src/lib/format.ts` | `formatDurationHours` |
| `src/lib/export.ts` | Schemas, Snapshot, Restore, ZIP, `loadAnalysisFiles` |
| `src/db/appDb.ts` | `runLogs`, `version(5)` |
| `src/db/run-actions.ts` (+ Test) | anlegen, ändern, löschen |
| `src/db/history-queries.ts` | `loadWeeklyVolume` |
| `src/db/template-actions.ts` | `category` in `TemplateInput` |
| `src/db/data-fix-actions.ts` | Art auf frühere Sessions übertragen |
| `src/components/icons/RunIcon.tsx` | Läufer-Piktogramm |
| `src/components/RunLogSheet.tsx` | Formular |
| `src/components/WeeklyVolumeList.tsx` | Wochenübersicht |
| `src/components/RunHistoryCard.tsx` | Grafik + Liste |
| `src/components/ProgressChart.tsx` | `lowerIsBetter`, `key` je Index |
| `src/pages/RunDetailPage.tsx`, `src/App.tsx` | Route `/runs/:runId` |
| `src/pages/Home.tsx`, `HistoryPage.tsx`, `TemplateDetailPage.tsx`, `SettingsPage.tsx` | Einbindung |
| `e2e/run-log.spec.ts`, `e2e/analysis-export.spec.ts` | E2E |
| `CLAUDE.md`, beide `SKILL.md` | Doku, Vertrag |

---

### Task 1: Reine Lauf-Regeln und Formular-Logik

**Files:**
- Modify: `src/domain/models.ts` (neben `ExerciseTest`)
- Create: `src/domain/run.ts`, `src/domain/run.test.ts`, `src/domain/run-form.ts`, `src/domain/run-form.test.ts`

**Interfaces:**
- Produces (models.ts): `interface RunLog { id; date: string; distanceKm: number; durationSeconds: number; elevationGainM?: number; averageHeartRate?: number; notes?: string; createdAt: string; updatedAt: string }` – mit Kommentar aus Spec Abschnitt 1.
- Produces (run.ts):
  - `RUN_HEART_RATE_MIN = 30`, `RUN_HEART_RATE_MAX = 250`
  - `interface RunLogValues { date: string; distanceKm: number; durationSeconds: number; elevationGainM: number | null; averageHeartRate: number | null; notes: string | null }`
  - `durationFromParts(hours: number, minutes: number, seconds: number): number`
  - `splitDuration(totalSeconds: number): { hours: number; minutes: number; seconds: number }`
  - `paceSecondsPerKm(distanceKm: number, durationSeconds: number): number | undefined`
  - `formatPace(secondsPerKm: number): string` → `'5:12'` (ohne Einheit)
  - `formatRunDuration(totalSeconds: number): string` → `'52:30'`, ab 1 h `'1:21:05'`
  - `validateRunLogValues(values: RunLogValues, today: Date): string | undefined` – erste deutsche Meldung oder `undefined`
- Produces (run-form.ts):
  - `type RunFormField = 'date' | 'distance' | 'hours' | 'minutes' | 'seconds' | 'elevation' | 'heartRate' | 'notes'`
  - `type RunFormState = Record<RunFormField, string>`
  - `toRunFormState(run: RunLog | undefined, today: Date): RunFormState` – leer + `date = toDateInputValue(today)`; vorhandene Zahlen über `toInputValue`, Dauer über `splitDuration`
  - `readRunForm(state: RunFormState, today?: Date): { values?: RunLogValues; errors: Partial<Record<RunFormField, string>>; paceSecondsPerKm?: number }` – `today` Vorgabe `new Date()`

- [ ] **Step 1: Failing tests `run.test.ts`**
  - `durationFromParts(1, 21, 5) === 4865`; `splitDuration(4865)` → `{1, 21, 5}`
  - `paceSecondsPerKm(10, 3120) === 312`; `paceSecondsPerKm(0, 3120) === undefined`; `paceSecondsPerKm(5, 0) === undefined`
  - `formatPace(312) === '5:12'`; `formatPace(299.6) === '5:00'` (Rundung trägt in die Minute); `formatPace(65) === '1:05'`
  - `formatRunDuration(3150) === '52:30'`; `formatRunDuration(4865) === '1:21:05'`; `formatRunDuration(59) === '0:59'`
  - `validateRunLogValues` mit `today = new Date(2026, 9, 4, 18)` liefert genau die Meldungen der Spec: Strecke `0` → `'Bitte eine Strecke über 0 km eintragen.'`; Dauer `0` → `'Bitte eine Dauer eintragen.'`; `date: '2026-13-01'` → `'Bitte ein gültiges Datum eintragen.'`; `date: '2026-10-05'` → `'Ein Lauf kann nicht in der Zukunft liegen.'`; `date: '2026-10-04'` → `undefined`; `elevationGainM: 12.5` und `-1` → `'Höhenmeter bitte als ganze Zahl ab 0.'`; Puls `29`, `251`, `150.5` → `'Puls bitte zwischen 30 und 250.'`; Puls `null` → `undefined`.

- [ ] **Step 2: Failing tests `run-form.test.ts`**
  - `'liest Komma und Punkt'` – distance `'7,5'` und `'7.5'` → `values.distanceKm === 7.5`; `'7,5,1'` → `errors.distance` gesetzt, `values` undefined.
  - `'leere Std/Sek neben Min zählen als 0'` – hours `''`, minutes `'52'`, seconds `''` → `durationSeconds === 3120`.
  - `'Min und Sek über 59 sind ein Feldfehler'` – minutes `'75'` → `errors.minutes === '0–59'`; seconds `'60'` → `errors.seconds === '0–59'`.
  - `'ganz leere Dauer ist ein Fehler'` – alle drei leer → `errors.hours === 'Bitte eine Dauer eintragen.'`, `values` undefined.
  - `'leere optionale Felder werden null'` – elevation/heartRate/notes leer → `null`; notes `'  locker  '` → `'locker'`.
  - `'Pace erscheint, sobald Strecke und Dauer gültig sind'` – `'10'` + `0/52/0` → `paceSecondsPerKm === 312`, auch wenn Puls ungültig ist (`errors.heartRate` gesetzt, `values` undefined).
  - `'toRunFormState ist die Umkehrung'` – ein `RunLog` mit `distanceKm: 7.5, durationSeconds: 4865, elevationGainM: 180` → `distance '7,5'`, `hours '1'`, `minutes '21'`, `seconds '5'`, `elevation '180'`, `heartRate ''`.

- [ ] **Step 3: Run** `npx vitest run src/domain/run.test.ts src/domain/run-form.test.ts` – Expected: FAIL (Module fehlen).

- [ ] **Step 4: Implement.** `readRunForm` liest jede Zahl über `parseNumberInput` (leer ≠ ungültig); Std/Min/Sek ganzzahlig, Min/Sek ≤ 59; Feldfehler pro Feld, `values` nur ohne jeden Fehler **und** ohne Meldung aus `validateRunLogValues` – deren Meldung landet am passenden Feld (Strecke → `distance`, Dauer → `hours`, Datum → `date`, HM → `elevation`, Puls → `heartRate`). `today` wird an `validateRunLogValues` durchgereicht. Die Zukunftsprüfung vergleicht `date` als Zeichenkette mit `toDateInputValue(today)`.

- [ ] **Step 5: Run** `npx vitest run src/domain/run.test.ts src/domain/run-form.test.ts && npm run check:strict` – Expected: PASS.

- [ ] **Step 6: Commit** `git commit -m "Läufe: reine Regeln für Dauer, Pace und Formular"`

---

### Task 2: Tabelle, Schreib-API und Backup

**Files:**
- Modify: `src/db/appDb.ts`, `src/lib/export.ts` (Schemas ~Z. 37–285, `DatabaseSnapshot`, `createDatabaseSnapshot`, `restoreDatabaseSnapshot`)
- Create: `src/db/run-actions.ts`, `src/db/run-actions.test.ts`
- Test: `src/lib/export.test.ts`

**Interfaces:**
- Consumes: `RunLogValues`, `validateRunLogValues` (Task 1)
- Produces: `db.runLogs: Table<RunLog, string>`; `createRunLog(values: RunLogValues, now?: Date): Promise<string>`; `updateRunLog(id: string, changes: Partial<RunLogValues>, now?: Date): Promise<void>`; `deleteRunLog(id: string): Promise<void>`; `DatabaseSnapshot.runLogs: RunLog[]`

- [ ] **Step 1: Failing tests `run-actions.test.ts`**
  - `'legt einen Lauf an und lässt null-Felder weg'` – `createRunLog({ date: '2026-10-04', distanceKm: 7.5, durationSeconds: 2400, elevationGainM: null, averageHeartRate: 152, notes: null }, new Date(2026, 9, 4, 18))` → Datensatz hat `averageHeartRate: 152`, `'elevationGainM' in record === false`, `'notes' in record === false`, `createdAt === updatedAt`.
  - `'ändert nur übergebene Felder'` – danach `updateRunLog(id, { notes: 'zäh' })` → Strecke, Dauer, Puls unverändert, `notes === 'zäh'`, `updatedAt` neu.
  - `'leert den Puls mit null'` – `updateRunLog(id, { averageHeartRate: null })` → `'averageHeartRate' in record === false`.
  - `'prüft den zusammengeführten Datensatz'` – `updateRunLog(id, { distanceKm: 0 })` wirft `'Bitte eine Strecke über 0 km eintragen.'`, Datensatz unverändert.
  - `'wirft bei unbekannter Id'` – `'Lauf nicht gefunden.'`
  - `'wirft bei einem Datum in der Zukunft'` – Meldung aus Task 1.
  - `'löscht'` – danach `db.runLogs.get(id) === undefined`.
- [ ] **Step 2: Failing tests im Export-Test**
  - `'sichert und stellt Läufe wieder her'` – Lauf anlegen, Snapshot erzeugen, `parseDatabaseSnapshot(JSON.stringify(snapshot))`, `restoreDatabaseSnapshot` → Lauf wieder da, alle Felder gleich.
  - `'nimmt ein altes Backup ohne runLogs an'` – JSON ohne Schlüssel `runLogs` parst zu `runLogs: []`; Restore leert eine vorher befüllte `runLogs`-Tabelle.

- [ ] **Step 3: Run** `npx vitest run src/db/run-actions.test.ts src/lib` – Expected: FAIL.

- [ ] **Step 4: Implement.** `appDb.ts`: Feld `runLogs!: Table<RunLog, string>` und `this.version(5).stores({ runLogs: 'id, date' })` mit Kommentar im Stil der v3/v4-Blöcke. `run-actions.ts`: Kopfkommentar „warum änderbar, anders als Sessions“ (Spec Abschnitt 1). `updateRunLog` liest den Datensatz, führt `changes` darüber zusammen (`null` → Feld entfernen), prüft mit `validateRunLogValues`, schreibt dann per `put` den zusammengeführten Datensatz – damit ist `null` → *fehlt* eindeutig und `undefined` in `changes` heißt „nicht anfassen“. `notes` wird getrimmt, leer → entfernt. `export.ts`: `runLogSchema` (`date` per `/^\d{4}-\d{2}-\d{2}$/`, `distanceKm` positiv, `durationSeconds` int positiv, `elevationGainM` int ≥ 0 optional, `averageHeartRate` int optional, `notes` optional, `createdAt`, `updatedAt`), Eintrag mit dem Kommentar wie bei `libraryImports`, Snapshot, Restore (Transaktion, `clear`, `bulkAdd`).

- [ ] **Step 5: Run** `npx vitest run src/db src/lib && npm run check:strict` – Expected: PASS.

- [ ] **Step 6: Commit** `git commit -m "Läufe: Tabelle, Schreib-API und Backup"`

---

### Task 3: Art des Workouts – Modell, Snapshot, Workout-Formular, Import

**Files:**
- Create: `src/domain/workout-category.ts`, `src/domain/workout-category.test.ts`
- Modify: `src/domain/models.ts`, `src/domain/session.ts` (bei `templateNameSnapshot`, ~Z. 46), `src/db/template-actions.ts` (`TemplateInput`, `createTemplate`, `updateTemplate`), `src/lib/export.ts` (`workoutTemplateSchema`, `workoutSessionSchema`), `src/domain/library-import.ts` (`importTemplateSchema`, `planTemplates`), `src/pages/TemplateDetailPage.tsx`
- Test: `src/domain/session.test.ts`, `src/db/template-actions.test.ts`, `src/domain/library-import.test.ts`, Export-Test

**Interfaces:**
- Produces: `type WorkoutCategory = 'strength' | 'mobility'`; `normalizeWorkoutCategory(value?: WorkoutCategory | null): 'mobility' | undefined`; `resolveWorkoutCategory(value?: WorkoutCategory): WorkoutCategory`; `describeWorkoutCategory(value?: WorkoutCategory): 'Kraft' | 'Mobility'`. Modell: `WorkoutTemplate.category?: WorkoutCategory`, `WorkoutSession.templateCategorySnapshot?: WorkoutCategory`. `TemplateInput.category?: WorkoutCategory` (`undefined` = nicht anfassen).

> Abweichung von der Spec-Formulierung „`startSessionFromTemplate` kopiert“: Der Snapshot entsteht in `materializeSession`, direkt neben `templateNameSnapshot` – dort entstehen alle Session-Snapshots, und es bleibt rein testbar. An der Satz-Materialisierung ändert sich nichts.

- [ ] **Step 1: Failing tests**
  - `workout-category.test.ts`: `normalizeWorkoutCategory('strength') === undefined`, `('mobility') === 'mobility'`, `(null) === undefined`; `resolveWorkoutCategory(undefined) === 'strength'`; `describeWorkoutCategory('mobility') === 'Mobility'`, `(undefined) === 'Kraft'`.
  - `session.test.ts`: `'übernimmt die Art des Workouts als Snapshot'` – Template mit `category: 'mobility'` → `session.templateCategorySnapshot === 'mobility'`; ohne → Eigenschaft fehlt.
  - `template-actions.test.ts`: `'speichert Mobility und entfernt die Art bei Kraft'` – `updateTemplate(id, { name, category: 'mobility' })` → `'mobility'`; danach `category: 'strength'` → `'category' in record === false`; danach ohne `category` → unverändert.
  - `library-import.test.ts`: neu angelegtes Workout mit `category: 'mobility'` → `record.category === 'mobility'`; bestehendes Kraft-Workout + Datei `'mobility'` → `changes` enthält `{ field: 'Art', from: 'Kraft', to: 'Mobility' }`; Datei ohne `category` → `kind === 'unchanged'`; `category: 'yoga'` → `parseLibraryImportPayload` wirft.
  - Export-Test: Template mit `category` und Session mit `templateCategorySnapshot` überstehen Snapshot → Parse → Restore.

- [ ] **Step 2: Run** `npx vitest run src/domain src/db src/lib` – Expected: die neuen Tests FAIL.

- [ ] **Step 3: Implement.** Schema-Felder `z.enum(['strength', 'mobility']).optional()`. `updateTemplate`: `if (input.category !== undefined) changes.category = normalizeWorkoutCategory(input.category);` mit Kommentar, dass `undefined` hier bewusst die Eigenschaft löscht. `planTemplates`: neue Workouts `record.category = normalizeWorkoutCategory(input.category)`; bestehende über `diffField(changes, 'Art', describeWorkoutCategory(existing.category), describeWorkoutCategory(input.category))`, dann `values.category = normalizeWorkoutCategory(input.category)`. `TemplateDetailPage`: `SelectField` „Art“ (Optionen „Kraft“, „Mobility“) im Workout-Formular neben Name/Notiz, Zustand wie `templateName`, beim Speichern immer mitgeschickt.

- [ ] **Step 4: Run** `npx vitest run && npm run check && npm run check:strict` – Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Workouts tragen eine Art: Kraft oder Mobility"`

---

### Task 4: Datenkorrektur „Art auf frühere Sessions übertragen“

**Files:**
- Modify: `src/db/data-fix-actions.ts`, `src/pages/SettingsPage.tsx` (Abschnitt „Datenkorrekturen“ ~Z. 796, Dialoge ~Z. 1085)
- Test: `src/db/data-fix-actions.test.ts`

**Interfaces:**
- Produces: `DataFixStatus.sessionsWithoutCategory: number`; `applyWorkoutCategoryBackfill(): Promise<number>` (Anzahl geänderter Sessions)

- [ ] **Step 1: Failing tests**
  - `'zählt Sessions von Mobility-Workouts ohne Snapshot'` – zwei Sessions des Mobility-Workouts ohne Snapshot, eine mit, eine eines Kraft-Workouts → `describeDataFixes().sessionsWithoutCategory === 2`.
  - `'überträgt die Art und meldet danach nichts mehr'` – `applyWorkoutCategoryBackfill() === 2`, beide tragen `'mobility'`; danach Zähler `0`, zweiter Aufruf liefert `0`.
  - `'fasst sonst nichts an'` – `status`, `completedAt`, Satzprotokolle der Sessions unverändert.

- [ ] **Step 2: Run** `npx vitest run src/db/data-fix-actions.test.ts` – Expected: FAIL.

- [ ] **Step 3: Implement.** Transaktion über `workoutTemplates` und `workoutSessions`; Auswahl über `templateId` der Workouts mit `category === 'mobility'`, nicht über Namen. Settings: dritter Block im Stil der bestehenden – Titel „Art auf frühere Sessions übertragen“, Erklärtext („Stell zuerst die Mobility-Workouts um. Danach zählen ihre bisherigen Einheiten in der Wochenübersicht als Mobility statt als Kraft.“), Statuszeile (`'{n} Sessions ohne Art.'` / `'Nichts zu tun.'`), Knopf deaktiviert bei `0`, `ConfirmDialog` mit Anzahl, Erfolgsmeldung über `runDataFix`.

- [ ] **Step 4: Run** `npx vitest run src/db && npm run check` – Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Datenkorrektur: Art auf frühere Sessions übertragen"`

---

### Task 5: Wochenrechnung

**Files:**
- Create: `src/domain/weekly-volume.ts`, `src/domain/weekly-volume.test.ts`
- Modify: `src/domain/calendar-week.ts` (+ Test), `src/lib/format.ts`, `src/db/history-queries.ts` (+ Test)

**Interfaces:**
- Consumes: `RunLog` (Task 1), `resolveWorkoutCategory` (Task 3), `sumWorkVolume`, `supportsReps`, `startOfCalendarWeek`, `parseLocalDate`
- Produces:
  - `isoWeekNumber(date: Date): number` in `calendar-week.ts`
  - `formatDurationHours(totalSeconds: number): string` in `format.ts` → `'3:10 h'`, `'0:25 h'` (gerundet auf Minuten)
  - ```ts
    interface WeekVolume {
      weekStart: Date; // Montag 00:00 Ortszeit
      strength: { sessions: number; durationSeconds: number; volumeKg: number; workSets: number };
      mobility: { sessions: number; durationSeconds: number };
      running: { runs: number; distanceKm: number; elevationGainM: number; elevationIncomplete: boolean; durationSeconds: number };
    }
    ```
  - `buildWeeklyVolume(input: { sessions: WorkoutSession[]; sessionExercises: WorkoutSessionExercise[]; setLogs: WorkoutSetLog[]; runs: RunLog[]; from: Date; to: Date }): WeekVolume[]` – älteste Woche zuerst, jede Woche von `startOfCalendarWeek(from)` bis `startOfCalendarWeek(to)`
  - `hasTraining(week: WeekVolume): boolean`
  - `describeWeekVolume(week: WeekVolume): { strength?: string; mobility?: string; running?: string }`
  - `describeWeekCounts(week: WeekVolume): string` → `'3 Kraft · 1 Mobility · 2 Läufe'`
  - `loadWeeklyVolume(from: Date, to: Date): Promise<WeekVolume[]>` in `history-queries.ts`

- [ ] **Step 1: Failing tests `weekly-volume.test.ts`** (Datumswerte über `new Date(y, m, d, h)` in Ortszeit)
  - `'ordnet einen Sonntagslauf seiner Woche zu'` – Lauf `'2026-10-04'`, Bereich 28.09.–05.10. → zwei Wochen, Lauf in der ersten.
  - `'liefert leere Wochen mit'` – Bereich über drei Wochen, ein Lauf in der mittleren → 3 Einträge, `hasTraining` nur bei der mittleren.
  - `'zählt über die Zeitumstellung'` – Bereich 19.10.–02.11.2026 → `weekStart` jeweils Montag 00:00.
  - `'zählt nur abgeschlossene Sessions mit abgehaktem Satz'` – abgebrochene Session mit Sätzen, abgeschlossene ohne abgehakten Satz, laufende → alle `0`.
  - `'trennt Kraft und Mobility'` – Snapshot `'mobility'` → `mobility.sessions === 1`, `strength.sessions === 0`; ohne Snapshot → Kraft.
  - `'Dauer ist Start bis Abschluss'` – 18:00 → 19:10 → `strength.durationSeconds === 4200`.
  - `'Volumen nur für Wiederholungsübungen'` – ein `reps_weight`-Satz 60 kg × 5 und ein `time_weight`-Satz 20 kg × 45 s → `volumeKg === 300`, `workSets === 2`; Aufwärmsatz zählt nicht.
  - `'merkt fehlende Höhenmeter'` – zwei Läufe, einer ohne HM → `elevationGainM` = Summe der vorhandenen, `elevationIncomplete === true`.
  - `'zwei Läufe am selben Tag'` – `running.runs === 2`, Strecken summiert.
  - `describeWeekVolume`: Kraft `'3 Einheiten · 3:10 h · 12.450 kg · 54 Sätze'`, Einzahl `'1 Einheit'`, `'1 Satz'`; Mobility `'1 Einheit · 0:25 h'`; Laufen `'2 Läufe · 14,2 km · 180 HM · 1:21 h'`, Einzahl `'1 Lauf'`, unvollständig `'≥ 180 HM'`; ohne Läufe kein `running`-Schlüssel.
  - `describeWeekCounts`: `'3 Kraft · 1 Mobility · 2 Läufe'`, Nullen fallen weg, `'1 Lauf'`.
  - `calendar-week.test.ts`: `isoWeekNumber(new Date(2026, 9, 4)) === 40`, `isoWeekNumber(new Date(2027, 0, 1)) === 53`.

- [ ] **Step 2: Failing test `history-queries.test.ts`** – `'loadWeeklyVolume liest Sessions und Läufe der Wochen'`: eine abgeschlossene Session mit abgehaktem Satz und ein Lauf in der aktuellen Woche, ein Lauf drei Wochen davor → `loadWeeklyVolume(vor 1 Woche, jetzt)` hat 2 Wochen, die aktuelle zählt `strength.sessions === 1` und `running.runs === 1`, der alte Lauf fehlt.

- [ ] **Step 3: Run** `npx vitest run src/domain/weekly-volume.test.ts src/domain/calendar-week.test.ts src/db/history-queries.test.ts` – Expected: FAIL.

- [ ] **Step 4: Implement.** Kopfkommentar `weekly-volume.ts`: eine Rechnung, drei Leser; Auswahlregel und warum abgebrochene Sessions nicht zählen (Konvention der App, `closeSession` stempelt auch sie). Wochen über `setDate(+7)`. `loadWeeklyVolume`: Sessions über den `completedAt`-Index zwischen Wochenbeginn von `from` und Ende der Woche von `to`, Session-Übungen und Satzprotokolle per `anyOf` (Muster `loadWeekSummary`), Läufe über `runLogs.where('date').between(…, true, true)` mit `toDateInputValue`.

- [ ] **Step 5: Run** dieselben Tests + `npm run check:strict` – Expected: PASS.

- [ ] **Step 6: Commit** `git commit -m "Wochenrechnung für Kraft, Mobility und Laufen"`

---

### Task 6: Analyse-Export

**Files:**
- Modify: `src/domain/analysis-export.ts` (`AnalysisExportInput`, `AnalysisExportFiles`, `AnalysisRow`, `SESSION_COLUMNS`, `buildSessionsCsv`, `buildMetaJson`, `buildAnalysisPasteText`), `src/lib/export.ts` (`loadAnalysisFiles`, `exportAnalysisSnapshot`)
- Test: `src/domain/analysis-export.test.ts`, `e2e/analysis-export.spec.ts`

**Interfaces:**
- Consumes: `buildWeeklyVolume`, `paceSecondsPerKm`, `resolveWorkoutCategory`
- Produces: `AnalysisExportInput.runs: RunLog[]`; `AnalysisExportFiles.runsCsv: string`, `weeksCsv: string`

- [ ] **Step 1: Failing tests**
  - `'laeufe.csv: Spalten und Werte, neueste zuerst'` – Spalten genau `['datum','wochentag','strecke_km','dauer_sek','pace_sek_pro_km','hoehenmeter','puls_avg','notiz']`; Lauf `2026-10-04`, 10 km, 3120 s, ohne HM → `['2026-10-04','So','10','3120','312','','','']`; zwei Läufe → neuerer oben.
  - `'wochen.csv: eine Zeile je Woche über den ganzen Zeitraum'` – Spalten genau wie Spec Abschnitt 6; Session in KW 36 und Lauf in KW 40, `exportedAt` in KW 40 → 5 Zeilen, `woche_beginn` `2026-08-31` … `2026-09-28`, leere Wochen als Nullzeile (`0`, `lauf_hm_unvollstaendig` `nein`).
  - `'wochen.csv: Minuten gerundet'` – 4200 s → `kraft_dauer_min` `70`.
  - `'sessions.csv: Spalte art am Ende'` – letzte Spalte `art`, Werte `kraft` / `mobility`; die ersten 7 Spalten unverändert (bestehender Test bleibt).
  - `'meta.json: Zeitraum über Sessions und Läufe'` – nur ein Lauf vor der ersten Session → `zeitraum.von` = Laufdatum; `laeufe.anzahl === 1`; `hinweise` enthält einen Text mit `kraft_dauer_min` und einen mit „abgebrochene“.
  - `'Zwischenablage: wochen.csv und laeufe.csv nach tests.csv'` – Reihenfolge der Überschriften `meta.json`, `sessions.csv`, `progression.csv`, `tests.csv`, `wochen.csv`, `laeufe.csv`.
  - Ohne Läufe und Sessions: `laeufe.csv` und `wochen.csv` nur Kopfzeile.

- [ ] **Step 2: Run** `npx vitest run src/domain/analysis-export.test.ts` – Expected: FAIL.

- [ ] **Step 3: Implement.** Neue Dateien über `csvLine`; Pace auf ganze Sekunden gerundet; `wochen.csv` aus `buildWeeklyVolume({ … , from: frühestes Datum aus exportierten Zeilen und Läufen, to: exportedAt })`, Volumen auf ganze kg gerundet. `meta.json` bekommt `laeufe: { anzahl }` und `hinweise: string[]` mit genau zwei Sätzen: `'kraft_dauer_min ist die Session-Dauer von Start bis Abschluss, inklusive Pausen.'` und `'wochen.csv zählt nur abgeschlossene Sessions; abgebrochene stehen in sessions.csv, aber nicht in den Wochensummen.'`. `loadAnalysisFiles` lädt `db.runLogs.toArray()`; das ZIP bekommt `wochen.csv` und `laeufe.csv`; Kommentar „vier Dateien“ → „sechs Dateien“.

- [ ] **Step 4: E2E anpassen** – `e2e/analysis-export.spec.ts` erwartet im ZIP zusätzlich `wochen.csv` und `laeufe.csv`; Testtitel „vier“ → „sechs“.

- [ ] **Step 5: Run** `npx vitest run && npm run check:strict && caffeinate -i npx playwright test e2e/analysis-export.spec.ts` – Expected: PASS.

- [ ] **Step 6: Commit** `git commit -m "Analyse-Export: Läufe und Wochensummen"`

---

### Task 7: Lauf eintragen auf Heute

**Files:**
- Create: `src/components/icons/RunIcon.tsx`, `src/components/RunLogSheet.tsx`, `e2e/run-log.spec.ts`
- Modify: `src/pages/Home.tsx` (Wochenkarte ~Z. 258)

**Interfaces:**
- Consumes: `toRunFormState`, `readRunForm`, `formatPace` (Task 1); `createRunLog`, `updateRunLog` (Task 2); `loadWeeklyVolume`, `describeWeekCounts`, `hasTraining` (Task 5)
- Produces: `RunIcon(props: LucideProps)`; `RunLogSheet({ open: boolean; run?: RunLog; onClose: () => void })`

- [ ] **Step 1: E2E zuerst** (`e2e/run-log.spec.ts`, WebKit, beide Größen):
  - `'trägt einen Lauf über Heute ein'` – „Lauf eintragen“ antippen; Sheet `[data-sheet]` sichtbar; Strecke `10`, Min `52` → `[data-run-pace]` hat Text `5:12 /km`; über die Tastaturleiste („Nächstes Feld“) von Strecke nach Std springen, Fokus liegt auf Std; „Lauf speichern“ → Sheet zu; Wochenkarte enthält `1 Lauf` und `10 km`.
  - `'sperrt Speichern ohne Dauer'` – nur Strecke → „Lauf speichern“ ist `disabled`.
  - `'zeigt den Fehler bei Minuten über 59'` – Min `75` → Text `0–59` am Feld.
- [ ] **Step 2: Run** `caffeinate -i npx playwright test e2e/run-log.spec.ts` – Expected: FAIL (Knopf fehlt).
- [ ] **Step 3: Implement.**
  - `RunIcon`: Inline-SVG, 24er `viewBox`, `fill="none"`, `stroke="currentColor"`, `strokeWidth` aus Props (Vorgabe 2), runde Enden; ein Läufer im Schritt (Kopf als Kreis, Rumpf schräg nach vorn, ein Arm vor, einer zurück, Beine gespreizt). `aria-hidden` per Vorgabe, Props-Form wie lucide (`size`, `className`).
  - `RunLogSheet`: `Sheet` mit `fieldNavigation`, `label` „Lauf eintragen“ bzw. „Lauf bearbeiten“. Felder und Reihenfolge laut Spec Abschnitt 3 (`TextField`, Std/Min/Sek als `fieldset` mit `legend` „Dauer“ in `grid-cols-3`, `TextArea` für die Notiz). Zustand `RunFormState`, bei jedem `open` neu aus `toRunFormState(run, new Date())`. Feldfehler nur für Felder, die schon berührt wurden. Pace-Zeile `data-run-pace`: `` `${formatPace(pace)} /km` ``. Fuß: ein `Button` „Lauf speichern“, `fullWidth`, `min-h-[3.875rem]`, `disabled` ohne `values` oder während des Speicherns. Neu → `createRunLog(values)`, sonst `updateRunLog(run.id, values)`. Fehler der Action als `role="alert"` im Sheet, Sheet bleibt offen.
  - `Home`: sekundärer `Button` „Lauf eintragen“ mit `RunIcon` direkt über der Wochenkarte. Die Wochenkarte liest zusätzlich `loadWeeklyVolume(new Date(), new Date())[0]`: Titel `describeWeekCounts(week)`, Untertitel aus `formatNumber(Math.round(volumeKg))` kg Volumen und `formatNumber(distanceKm)` km (Nullen fallen weg); „Zuletzt“ bleibt aus `loadWeekSummary`. `Empty` nur, wenn `hasTraining(week)` falsch ist.
- [ ] **Step 4: Run** `caffeinate -i npx playwright test e2e/run-log.spec.ts && npm run lint && npm run check` – Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Lauf eintragen auf Heute"`

---

### Task 8: Detailseite und Verlauf

**Files:**
- Create: `src/pages/RunDetailPage.tsx`, `src/components/WeeklyVolumeList.tsx`, `src/components/RunHistoryCard.tsx`
- Modify: `src/App.tsx` (Route), `src/pages/HistoryPage.tsx`, `src/components/ProgressChart.tsx`
- Test: `e2e/run-log.spec.ts`

**Interfaces:**
- Consumes: `RunLogSheet`, `RunIcon` (Task 7); `deleteRunLog` (Task 2); `loadWeeklyVolume`, `describeWeekVolume`, `hasTraining` (Task 5); `isoWeekNumber`; `formatPace`, `formatRunDuration`, `paceSecondsPerKm`
- Produces: Route `/runs/:runId`; `ProgressChart` Prop `lowerIsBetter?: boolean`; `WeeklyVolumeList({ weeks: WeekVolume[] })` (neueste zuerst übergeben); `RunHistoryCard({ runs: RunLog[] })`

- [ ] **Step 1: E2E ergänzen**
  - `'zeigt den Lauf im Verlauf und auf der Detailseite'` – Lauf eintragen, Verlauf öffnen; `[data-week-volume]` der ersten Woche enthält `1 Lauf`; Eintrag in der Karte „Läufe“ antippen → URL `#/runs/…`, Seite zeigt `10 km`, `52:00`, `5:12 /km`, nicht erfasste Werte als `–`.
  - `'bearbeitet und löscht einen Lauf'` – „Bearbeiten“ → Puls `150` → speichern → Seite zeigt `150`; „Löschen“ → `ConfirmDialog` bestätigen → zurück im Verlauf, Karte „Läufe“ weg.
  - `'zwei Läufe am selben Tag'` – zwei eintragen → Liste hat 2 Einträge, Grafik 2 Punkte (`circle`), Woche `2 Läufe`.
  - `'Wochenübersicht läuft bei 320px nicht über'` – `scrollWidth <= clientWidth` für `[data-week-volume]` auf der kleinen Größe.
- [ ] **Step 2: Run** `caffeinate -i npx playwright test e2e/run-log.spec.ts` – Expected: neue Tests FAIL.
- [ ] **Step 3: Implement.**
  - `ProgressChart`: `lowerIsBetter` dreht die y-Abbildung (`y = PADDING.top + ((v - min) / span) * innerHeight`); `key` der Punkte wird `` `${point.completedAt}-${index}` ``.
  - `WeeklyVolumeList`: je Woche ein Block mit `data-week-volume`, Kopf `` `KW ${isoWeekNumber(start)} · ${formatShortDate(start)}–${formatShortDate(sonntag)}` ``, darunter die Zeilen aus `describeWeekVolume` mit Vorsilbe „Kraft“, „Mobility“, „Laufen“; ohne Training „Kein Training“. Wochen mit Training auf der Waldgrün-Fläche: `DONE_SURFACE` in `ui/StatusCard.tsx` exportieren und hier verwenden, Nebentext `opacity-75`; sonst neutral `bg-surface`. Zeilen umbrechen statt abschneiden.
  - `RunHistoryCard`: `SectionCard` „Läufe“; `ProgressChart` mit Punkten `{ completedAt: \`${run.date}T12:00:00\`, topValue: pace, volume: 0, setCount: 1 }` (nur Läufe mit Pace), `label` „Pace“, `unit` „/km“, `formatValue={formatPace}`, `lowerIsBetter`; darunter je Lauf ein `Link` auf `/runs/:id` mit `RunIcon`, Datum, km, `formatRunDuration`, Pace, Ø Puls. Neueste zuerst, gleiche Tage nach `createdAt`.
  - `HistoryPage`: Reihenfolge laut Spec – `DoneCard`, `WeeklyVolumeList` (8 Wochen über `loadWeeklyVolume`, umgedreht), `RunHistoryCard` (nur mit Läufen; `useLiveQuery(() => db.runLogs.toArray())`), dann die Übungen.
  - `RunDetailPage`: `AppShell` „Lauf“, `eyebrow` mit dem Datum; Werte-Kacheln (`font-display`, `formatNumber`), Notiz; „Bearbeiten“ öffnet `RunLogSheet` mit `run`; „Löschen“ öffnet `ConfirmDialog` (`destructive`), danach `navigate('/history')`. Unbekannte Id → `Empty` mit Link zum Verlauf.
- [ ] **Step 4: Run** `caffeinate -i npx playwright test e2e/run-log.spec.ts e2e/accessibility.spec.ts && npm run lint && npm run check` – Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Läufe im Verlauf: Wochenübersicht, Grafik, Detailseite"`

---

### Task 9: Vertrag, Doku, Gesamtprüfung

**Files:**
- Modify: `.claude/skills/gym-book-architect/SKILL.md`, `.trae/skills/gym-book-pwa-architect/SKILL.md`, `CLAUDE.md`

- [ ] **Step 1: Vertrag** – in beiden Kopien identisch: Abschnitt „Runs“ (eigene Tabelle `runLogs`, keine Sätze und keine Session-Maschinerie, Pace berechnet und nie gespeichert, Läufe änderbar und löschbar, keine von der App erfundenen Pulsformeln, Datum als lokaler Kalendertag); „Must include“ um `run logging (distance, duration, elevation, average heart rate)` ergänzen.
- [ ] **Step 2: CLAUDE.md** – kurzer Abschnitt unter „Architecture“: Läufe (Modell, Sheet statt Seite wegen der Tastaturleiste, `null` leert), Workout-Art (Snapshot in `materializeSession`, Datenkorrektur), Wochenrechnung (eine Funktion, drei Leser, Auswahlregel, Volumen nur `supportsReps`); im Abschnitt Analyse-Export die zwei neuen Dateien und `art`; Hinweis, dass `analysis-export.ts` ein Steuerzeichen enthält. Teil 2 und 3 nur als ein Satz Ausblick.
- [ ] **Step 3: Gesamtprüfung** – `npm run lint && npm run check && npm run check:strict && npm test && npm run build && caffeinate -i npm run test:e2e` – Expected: alles grün.
- [ ] **Step 4: Commit** `git commit -m "Vertrag und Doku: Läufe und Wochenvolumen"`
