# Datierter Trainingsplan – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workouts und Läufe werden als Einzeltermine mit Datum geplant (in der App, per Serie und per Import), Sessions und Läufe werden ihrem Termin zugeordnet, Home und Programm-Tab zeigen, was heute dran ist, und `scheduledWeekdays` wird per Datenkorrektur abgelöst.

**Architecture:** Eine neue Tabelle `planEntries` (Dexie `version(6)`) mit `kind: 'workout' | 'run'`. Ob ein Termin belegt oder erledigt ist, wird aus `planEntryId` an `WorkoutSession` und `RunLog` abgeleitet, nie gespeichert. Reine Regeln in `src/domain/plan.ts`, `plan-entry-form.ts`, `plan-import.ts`; Schreib-API in `src/db/plan-actions.ts`, Lesen in `src/db/plan-queries.ts`.

**Tech Stack:** TypeScript, React, Dexie + `dexie-react-hooks`, Zod, Tailwind, Vitest (jsdom + fake-indexeddb), Playwright (WebKit).

**Spec:** [docs/superpowers/specs/2026-10-05-datierter-trainingsplan-design.md](../specs/2026-10-05-datierter-trainingsplan-design.md)

## Global Constraints

- Dexie: genau ein neuer Block `this.version(6).stores({ planEntries: 'id, date, templateId', workoutSessions: 'id, templateId, status, startedAt, completedAt, planEntryId', runLogs: 'id, date, planEntryId' })` – das sind die bisherigen Index-Zeilen plus `planEntryId`. Kein `upgrade()`.
- Backup: `SNAPSHOT_SCHEMA_VERSION` bleibt `1`; `planEntries` als `z.array(planEntrySchema).optional().default([])`; neue Felder `.optional()`. **Zod verwirft unbekannte Schlüssel** – jedes neue Feld muss ins Schema. `templateId`/`planEntryId` werden in `assertReferentialIntegrity` **nicht** geprüft.
- `LIBRARY_IMPORT_SCHEMA_VERSION` bleibt `1`.
- `src/domain/` bleibt rein. `npm run check:strict` muss grün bleiben.
- `null` leert ein Feld, ein fehlender Schlüssel ändert nichts. Geschrieben wird per `put` des zusammengeführten Datensatzes (Muster `updateRunLog`), nie `Table.update` mit `undefined`.
- Datum ist `YYYY-MM-DD` Ortszeit, gelesen nur über `parseLocalDate`; gültig nur, wenn `toDateInputValue(parseLocalDate(x)) === x`. Tage weiterzählen über `setDate`, nie über Millisekunden. Woche = Kalenderwoche ab Montag (`startOfCalendarWeek`).
- Belegt = Session mit `status` `active`/`completed` oder ein Lauf zeigt auf den Termin. `aborted` belegt nichts. Erledigt = abgeschlossene Session oder Lauf.
- `materializeSession`, `resolveWeekControl` und `foldProgressionRule` bleiben unverändert.
- Fehlermeldungen aus `db/` deutsch, wörtlich wie `PLAN_MESSAGES` (Task 1). UI-Texte und Kommentare deutsch mit echten Umlauten; jede gerenderte Zahl über `formatNumber`/`formatPace`/`formatRunDuration`.
- Farben: Lime nur auf der bestehenden `NowCard` je Seite; „Nächster Termin“ ist **keine** Lime-Fläche; erledigt = `DoneRow`/Forest; Touch-Ziele ≥ 44px; Zeilen bei 320px ohne horizontalen Überlauf.
- `src/domain/analysis-export.ts` enthält ein NUL-Zeichen – mit `/usr/bin/grep -a` oder dem Read-Tool lesen.
- Direkt auf `main` committen, **nicht pushen**. Jede Commit-Nachricht endet mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- E2E immer `caffeinate -i npm run test:e2e …`, vorher einen alten Dev-Server auf 5173 beenden.

## Review Focus

1. **Termin am Sonntag, Lauf am Montag danach eingetragen** – erwartet: keine Zuordnung, die Woche ist vorbei. Getestet in Task 1 (`findMatchingPlanEntry`).
2. **Zwei schnelle Taps auf „Heute · Einheit A“** – erwartet: eine Session, der Termin genau einmal belegt. Getestet in Task 4.
3. **Session abgebrochen, dann dasselbe Workout neu gestartet** – erwartet: der neue Start belegt denselben Termin. Getestet in Task 4.
4. **Import mit `planRange`, der einen schon erledigten Termin weglässt, zweimal hintereinander** – erwartet: der erledigte bleibt, der zweite Lauf ist komplett „unverändert“. Getestet in Task 10.
5. **Workout gelöscht, das einen erledigten Termin hat; danach Backup und Restore** – erwartet: der Termin steht weiter mit dem Namen aus dem Session-Snapshot, der Restore wird nicht abgelehnt. Getestet in Task 3 und Task 6.

---

## Dateien

| Datei | Änderung |
|---|---|
| `src/domain/models.ts` | `PlanEntry`, `RunPlanSnapshot`; `planEntryId`/`planDateSnapshot` an `WorkoutSession`; `planEntryId`/`runPlanSnapshot` an `RunLog`; `scheduledWeekdays` als veraltet kommentiert |
| `src/domain/import-key.ts` (neu) | `normalizeImportKey` dorthin verschoben, `library-import.ts` re-exportiert |
| `src/domain/plan.ts` (+ Test) | Schlüssel, Zuordnung, Serie, Belegung, Prüfregeln, Laufvorgabe-Zeile, Umwandlungsplan |
| `src/domain/plan-entry-form.ts` (+ Test) | Formularzustand ↔ Werte |
| `src/domain/plan-import.ts` (+ Test) | Import-Schema und -Planung der Termine |
| `src/domain/training-calendar.ts` (+ Test) | liest Termine und Läufe statt Wochentage |
| `src/domain/library-import.ts` | Payload-Schema, Plan, Summary um Termine erweitert |
| `src/domain/analysis-export.ts` (+ Test) | `plan.csv`, Spalten `geplant_am`, `plan_titel`, `meta.json` |
| `src/db/appDb.ts` | `version(6)` |
| `src/db/plan-actions.ts` (+ Test) | CRUD, Reihenfolge, Serie |
| `src/db/plan-queries.ts` (+ Test) | Woche, Heute, Lauf-Optionen, Belegung |
| `src/db/session-actions.ts` (+ Test) | Verknüpfung beim Start |
| `src/db/run-actions.ts` (+ Test) | Verknüpfung, Snapshot |
| `src/db/template-actions.ts` | `deleteTemplate` löscht offene Termine; `scheduledWeekdays` aus `TemplateInput` |
| `src/db/data-fix-actions.ts` (+ Test) | Wochentage in Termine umwandeln |
| `src/db/library-import-actions.ts` | Termine schreiben, zählen |
| `src/db/bootstrap.ts` | Beispieldaten: Termine statt Wochentage |
| `src/lib/export.ts` (+ Test) | Schemas, Snapshot, Restore, Reset, `plan.csv` im ZIP |
| `src/components/TrainingCalendar.tsx` | Wochentags-Liste und `templates`-Prop entfallen |
| `src/components/PlanWeekSection.tsx`, `PlanEntrySheet.tsx`, `PlanSeriesSheet.tsx` (neu) | Terminliste und Sheets |
| `src/components/WeekdayPicker.tsx` | nur noch im Serien-Sheet benutzt |
| `src/components/RunLogSheet.tsx`, `src/pages/RunDetailPage.tsx` | „Geplanter Lauf“, Soll/Ist |
| `src/components/LibraryImportSection.tsx` | Vorschau der Termine |
| `src/pages/ProgramsPage.tsx`, `Home.tsx`, `TemplateDetailPage.tsx`, `SettingsPage.tsx` | Einbindung |
| `e2e/program-calendar.spec.ts`, `e2e/plan-entries.spec.ts` (neu), `e2e/run-log.spec.ts`, `e2e/library-import.spec.ts` | E2E |
| `CLAUDE.md`, `.claude/skills/gym-book-architect/SKILL.md`, `.trae/…/SKILL.md` | Doku, Vertrag |

---

### Task 1: Reine Plan-Regeln

**Files:**
- Modify: `src/domain/models.ts`, `src/domain/library-import.ts` (nur `normalizeImportKey` → Re-Export)
- Create: `src/domain/import-key.ts`, `src/domain/plan.ts`, `src/domain/plan.test.ts`

**Interfaces:**
- Produces (models.ts), Kommentare aus Spec Abschnitt 1:
  - `type PlanEntryKind = 'workout' | 'run'`
  - `interface RunTarget { targetDistanceKm?: number; targetDurationSeconds?: number; targetElevationGainM?: number; targetAverageHeartRate?: number; targetPaceSecondsPerKm?: number }`
  - `interface PlanEntry extends RunTarget { id; date: string; orderInDay: number; kind: PlanEntryKind; templateId?: string; title?: string; instructions?: string; notes?: string; createdAt: string; updatedAt: string }`
  - `interface RunPlanSnapshot extends RunTarget { title: string; date: string; instructions?: string }`
  - `WorkoutSession.planEntryId?: string; planDateSnapshot?: string`; `RunLog.planEntryId?: string; runPlanSnapshot?: RunPlanSnapshot`
- Produces (import-key.ts): `normalizeImportKey(name: string): string` (Körper unverändert verschoben).
- Produces (plan.ts):
  - `PLAN_MESSAGES = { notFound: 'Termin nicht gefunden.', dateInvalid: 'Bitte ein gültiges Datum eintragen.', workoutMissing: 'Bitte ein Workout wählen.', workoutNotFound: 'Workout nicht gefunden.', titleMissing: 'Bitte einen Titel für den Lauf eintragen.', distance: 'Strecke bitte über 0 km.', duration: 'Dauer bitte über 0.', pace: 'Pace bitte über 0.', elevation: RUN_MESSAGES.elevation, heartRate: RUN_MESSAGES.heartRate, taken: 'Dieser Termin ist schon trainiert und lässt sich nicht mehr ändern.', notRun: 'Dieser Termin ist kein Lauf.', duplicate: (name: string, date: string) => \`„${name}“ steht am ${date} schon im Plan.\` }` (`date` ist dort schon formatiert: der Aufrufer übergibt `formatRunDate(date)` aus `src/lib/format.ts`)
  - `interface PlanEntryValues { date: string; kind: PlanEntryKind; templateId: string | null; title: string | null; targetDistanceKm: number | null; targetDurationSeconds: number | null; targetElevationGainM: number | null; targetAverageHeartRate: number | null; targetPaceSecondsPerKm: number | null; instructions: string | null; notes: string | null }`
  - `isValidLocalDate(value: string): boolean`
  - `planEntryKey(entry: { date: string; kind: PlanEntryKind; templateId?: string | null; title?: string | null }): string` → `` `${date}|workout|${templateId}` `` bzw. `` `${date}|run|${normalizeImportKey(title)}` ``
  - `validatePlanEntryValues(values: PlanEntryValues): string | undefined` – erste Meldung; Felder der *anderen* Art werden ignoriert, nicht abgelehnt
  - `toPlanEntryFields(values: PlanEntryValues): Omit<PlanEntry, 'id' | 'orderInDay' | 'createdAt' | 'updatedAt'>` – lässt `null` und Felder der anderen Art weg; trimmt Titel/Notiz/Anleitung, leer → weg
  - `interface PlanEntryLink { planEntryId: string; source: 'session' | 'run'; sourceId: string; done: boolean; doneAt?: string; nameSnapshot?: string }`
  - `buildPlanLinks(sessions: Pick<WorkoutSession, 'id' | 'planEntryId' | 'status' | 'completedAt' | 'templateNameSnapshot'>[], runs: Pick<RunLog, 'id' | 'planEntryId' | 'date'>[]): Record<string, PlanEntryLink>` – `aborted` fällt heraus; `active` → `done: false`
  - `type PlanEntryState = 'offen' | 'belegt' | 'erledigt'`; `planEntryState(entryId: string, links: Record<string, PlanEntryLink>): PlanEntryState`
  - `sortPlanEntries(entries: PlanEntry[]): PlanEntry[]` – nach `date`, dann `orderInDay`
  - `findMatchingPlanEntry(entries: PlanEntry[], query: { kind: PlanEntryKind; templateId?: string; day: string; takenIds: ReadonlySet<string> }): PlanEntry | null`
  - `expandSeries(input: { weekdays: IsoWeekday[]; startDate: string; weeks: number }): string[]` – für Woche i = 0…weeks−1 ab `startOfCalendarWeek(startDate)`, je Wochentag ein Datum, nur `>= startDate`, aufsteigend
  - `describeRunTarget(target: RunTarget): string` – Reihenfolge `8 km · 45:00 · 5:30 /km · 120 hm · Ø 145`, fehlende Teile weg
  - `pickTodayPlan(entries: PlanEntry[], links: Record<string, PlanEntryLink>, today: string): { todayOpen: PlanEntry[]; next?: PlanEntry }` – `next` = erster offener Termin nach heute
  - `planEntryName(entry: PlanEntry, templateNames: Record<string, string>, links: Record<string, PlanEntryLink>): string` – Titel; sonst Workout-Name; sonst `nameSnapshot`; sonst `'Gelöschtes Workout'`

- [ ] **Step 1: Failing tests `plan.test.ts`** (Montag = `2026-10-05`)
  - `planEntryKey`: `{date:'2026-10-05',kind:'run',title:' Intervalle 6×400 '}` gleich `{…,title:'intervalle 6×400'}`; Workout-Schlüssel enthält `templateId`.
  - `isValidLocalDate`: `'2026-10-05'` true, `'2026-13-01'` false, `'2026-02-30'` false, `''` false.
  - `validatePlanEntryValues`: `workout` ohne `templateId` → `workoutMissing`; `run` mit Titel `'  '` → `titleMissing`; `targetDistanceKm: 0` → `distance`; `targetAverageHeartRate: 251` → `heartRate`; `targetElevationGainM: 12.5` → `elevation`; `targetPaceSecondsPerKm: 0` → `pace`; `workout` mit gesetztem `targetDistanceKm: 0` → `undefined` (andere Art ignoriert).
  - `toPlanEntryFields`: `workout` mit `title: 'x'` und `targetDistanceKm: 5` → beide Schlüssel fehlen; `notes: '  '` → kein Schlüssel `notes`.
  - `buildPlanLinks`: Session `aborted` mit `planEntryId: 'p1'` → kein Eintrag; `active` → `done: false`; `completed` → `done: true, doneAt: completedAt`; Lauf → `done: true, doneAt: date`.
  - `findMatchingPlanEntry` mit Workout-Terminen Mo `2026-10-05` (A) und Do `2026-10-08` (A): `day '2026-10-08'` → Do; `day '2026-10-06'` → Mo; `takenIds {Mo}`, `day '2026-10-06'` → Do (vorgezogen); `day '2026-10-12'` → `null`; Lauf-Termin So `2026-10-11`, `day '2026-10-12'`, `kind 'run'` → `null`; anderes `templateId` → `null`; zwei Lauf-Termine am selben Tag → der mit kleinerem `orderInDay`.
  - `expandSeries({ weekdays: [1, 4], startDate: '2026-10-21', weeks: 3 })` → `['2026-10-22','2026-10-26','2026-10-29','2026-11-02','2026-11-05']` (über die Zeitumstellung am 25.10.).
  - `describeRunTarget({ targetDistanceKm: 8, targetDurationSeconds: 2700, targetPaceSecondsPerKm: 330, targetElevationGainM: 120, targetAverageHeartRate: 145 })` → `'8 km · 45:00 · 5:30 /km · 120 hm · Ø 145'`; `{ targetDistanceKm: 7.5 }` → `'7,5 km'`; `{}` → `''`.
  - `pickTodayPlan`: zwei offene heute (Reihenfolge nach `orderInDay`), ein erledigter heute fällt heraus; ohne heute → `next` ist der früheste künftige offene.
  - `planEntryName`: gelöschtes Workout mit Link-`nameSnapshot: 'Einheit A'` → `'Einheit A'`.
- [ ] **Step 2: Run** `npx vitest run src/domain/plan.test.ts` – Expected: FAIL (Modul fehlt).
- [ ] **Step 3: Implement** `import-key.ts`, `plan.ts`, Modelländerungen. Dabei den veralteten Kommentar an `templateCategorySnapshot` korrigieren: der Snapshot wird seit `3b1deca` immer geschrieben, ein fehlender Wert heißt „vor Einführung der Workout-Art gestartet“. `library-import.ts` exportiert `normalizeImportKey` per `export { normalizeImportKey } from '@/domain/import-key'` weiter – keine anderen Importstellen ändern.
- [ ] **Step 4: Run** `npx vitest run src/domain && npm run check:strict` – Expected: PASS.
- [ ] **Step 5: Commit** `Plan: reine Regeln für Termine, Zuordnung und Serien`

---

### Task 2: Formular-Logik für Termine

**Files:**
- Create: `src/domain/plan-entry-form.ts`, `src/domain/plan-entry-form.test.ts`

**Interfaces:**
- Consumes: `PlanEntryValues`, `validatePlanEntryValues`, `PLAN_MESSAGES` (Task 1); `splitDuration`, `formatPace` (`run.ts`); `parseNumberInput`, `toInputValue`.
- Produces:
  - `type PlanEntryFormField = 'date' | 'kind' | 'templateId' | 'title' | 'distance' | 'hours' | 'minutes' | 'seconds' | 'pace' | 'elevation' | 'heartRate' | 'instructions' | 'notes'`
  - `type PlanEntryFormState = Record<PlanEntryFormField, string>`
  - `toPlanEntryFormState(entry: PlanEntry | undefined, defaults: { date: string; kind?: PlanEntryKind }): PlanEntryFormState`
  - `readPlanEntryForm(state: PlanEntryFormState): { values?: PlanEntryValues; errors: Partial<Record<PlanEntryFormField, string>> }`
  - `parsePaceInput(value: string): number | null | 'invalid'` – `'5:30'` → 330, `'5'` → 300, `''` → `null`, `'5:75'`/`'abc'` → `'invalid'`

- [ ] **Step 1: Failing tests**
  - `parsePaceInput`: Werte wie oben.
  - `'leere Vorgaben werden null'` – Lauf mit nur Titel → alle `target*` `null`, `values` gesetzt.
  - `'Dauer aus Std/Min/Sek'` – `''/'45'/''` → `targetDurationSeconds: 2700`; Min `'75'` → `errors.minutes === '0–59'`.
  - `'Pace ungültig'` – `'5:75'` → `errors.pace === 'Pace bitte als m:ss, z. B. 5:30.'`.
  - `'Workout ohne Wahl'` – `kind 'workout'`, `templateId ''` → `errors.templateId === PLAN_MESSAGES.workoutMissing`.
  - `'Umkehrung'` – `toPlanEntryFormState` eines Lauf-Termins mit `targetPaceSecondsPerKm: 330`, `targetDistanceKm: 7.5` → `pace '5:30'`, `distance '7,5'`.
- [ ] **Step 2: Run** `npx vitest run src/domain/plan-entry-form.test.ts` – FAIL.
- [ ] **Step 3: Implement** nach dem Muster `run-form.ts` (Feldfehler pro Feld, `values` nur ohne Fehler; Meldung aus `validatePlanEntryValues` landet am passenden Feld).
- [ ] **Step 4: Run** Tests + `npm run check:strict` – PASS.
- [ ] **Step 5: Commit** `Plan: Formular-Logik für Termine`

---

### Task 3: Tabelle, Schreib-API, Backup

**Files:**
- Modify: `src/db/appDb.ts`, `src/lib/export.ts` (Schemas, `DatabaseSnapshot`, `createDatabaseSnapshot`, `restoreDatabaseSnapshot` – dort leeren auch die Tabellen für den lokalen Reset, `planEntries` in beide Listen), `src/db/template-actions.ts` (`deleteTemplate`)
- Create: `src/db/plan-actions.ts`, `src/db/plan-actions.test.ts`
- Test: `src/lib/export.test.ts`, `src/db/template-actions.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `db.planEntries: Table<PlanEntry, string>`
  - `createPlanEntry(values: PlanEntryValues, now?: Date): Promise<string>` – hängt ans Tagesende
  - `updatePlanEntry(id: string, changes: Partial<PlanEntryValues>, now?: Date): Promise<void>` – Datumswechsel: ans Ende des neuen Tages, alter Tag dicht nachnummeriert
  - `deletePlanEntry(id: string): Promise<void>`
  - `movePlanEntryInDay(id: string, direction: -1 | 1): Promise<void>`
  - `createPlanSeries(input: { values: Omit<PlanEntryValues, 'date'>; weekdays: IsoWeekday[]; startDate: string; weeks: number }, now?: Date): Promise<{ created: number; skipped: number }>`
  - `loadTakenPlanEntryIds(entryIds: string[]): Promise<Set<string>>` (exportiert, in Task 4/5 wiederverwendet) – Sessions `active`/`completed` und Läufe über den Index `planEntryId`
  - `DatabaseSnapshot.planEntries: PlanEntry[]`

- [ ] **Step 1: Failing tests `plan-actions.test.ts`**
  - `'legt an und nummeriert pro Tag'` – zwei Termine am selben Tag → `orderInDay` 1 und 2; am anderen Tag 1.
  - `'lehnt doppelten Schlüssel ab'` – zweimal Einheit A am `2026-10-05` → wirft `PLAN_MESSAGES.duplicate('Einheit A', …)`; Lauf `'Intervalle'` und `'intervalle '` am selben Tag ebenso.
  - `'lehnt unbekanntes Workout ab'` → `workoutNotFound`.
  - `'ändern mit null leert'` – `updatePlanEntry(id, { notes: null })` → kein Schlüssel `notes`; andere Felder unverändert, `updatedAt` neu.
  - `'Datumswechsel nummeriert beide Tage dicht'` – Tag A hat 1,2,3; mittleren auf Tag B → Tag A 1,2; Tag B hängt an.
  - `'belegter Termin ist gesperrt'` – Session `completed` mit `planEntryId` → `update`, `delete`, `move` werfen `PLAN_MESSAGES.taken`; Session `aborted` → erlaubt.
  - `'Serie überspringt Bestehendes'` – Do `2026-10-08` existiert; Serie Mo+Do ab `2026-10-05`, 2 Wochen → `{ created: 3, skipped: 1 }`.
  - `'move tauscht innerhalb des Tages'` – 1↔2; an den Rändern no-op.
- [ ] **Step 2: Failing tests Backup/Template**
  - `export.test.ts`: `'sichert und stellt Termine wieder her'` (Roundtrip inkl. `planEntryId`/`planDateSnapshot` an der Session und `runPlanSnapshot` am Lauf); `'altes Backup ohne planEntries'` → `[]`, Restore leert die Tabelle; `'Termin mit gelöschtem Workout wird nicht abgelehnt'`.
  - `template-actions.test.ts`: `'deleteTemplate löscht nur offene Termine'` – offener und erledigter Termin → nur der erledigte bleibt.
- [ ] **Step 3: Run** – FAIL.
- [ ] **Step 4: Implement.** Jede Schreibaktion in einer `rw`-Transaktion über `planEntries`, `workoutSessions`, `runLogs` (Belegung *in* der Transaktion lesen). Restore: `planEntries` leeren und nach `workoutTemplates` einfügen.
- [ ] **Step 5: Run** `npx vitest run src/db src/lib && npm run check:strict` – PASS.
- [ ] **Step 6: Commit** `Plan: Tabelle planEntries, Schreib-API und Backup`

---

### Task 4: Session dem Termin zuordnen

**Files:**
- Modify: `src/db/session-actions.ts:87-174`
- Test: `src/db/session-actions.test.ts` (bzw. die Datei, in der `startSessionFromTemplate` getestet wird – `grep -rln startSessionFromTemplate src/db/*.test.ts`)

**Interfaces:**
- Consumes: `findMatchingPlanEntry`, `toDateInputValue`, `loadTakenPlanEntryIds` (Task 1, 3).
- Produces: `startSessionFromTemplate(templateId: string, options?: { planEntryId?: string; now?: Date }): Promise<string>` – bestehende Aufrufer bleiben gültig.

- [ ] **Step 1: Failing tests**
  - `'verknüpft den heutigen Termin'` – `now = 2026-10-08 18:00`, Termine Mo und Do (A) → Session hat `planEntryId` = Do, `planDateSnapshot: '2026-10-08'`.
  - `'nimmt sonst den frühesten offenen der Woche'` – nur Mo-Termin, `now` Mi → Mo.
  - `'ohne passenden Termin kein Verweis'` – Termin für Workout B → kein Schlüssel `planEntryId`.
  - `'übergebene id gilt, eine belegte wird ignoriert'` – `planEntryId` des Do-Termins bei `now` Mo → Do; ist Do belegt → Start ohne Verweis, kein Fehler.
  - `'zwei parallele Starts belegen einmal'` – `Promise.all([start(A), start(A)])` → gleiche Session-id, genau eine Session mit dem Verweis.
  - `'Abbruch gibt frei'` – starten, `abortSession`, erneut starten → neue Session hat denselben `planEntryId`.
- [ ] **Step 2: Run** – FAIL.
- [ ] **Step 3: Implement.** Die Transaktion um `db.planEntries` und `db.runLogs` erweitern; *nach* der Prüfung auf eine aktive Session die Kandidaten (`planEntries.where('templateId')`) und die Belegung lesen, `bundle.session` um `planEntryId`/`planDateSnapshot` ergänzen und erst dann `add`. `startedAt` aus `options.now ?? new Date()`.
- [ ] **Step 4: Run** `npx vitest run src/db && npm run check:strict` – PASS.
- [ ] **Step 5: Commit** `Plan: Session beim Start dem Termin zuordnen`

---

### Task 5: Lauf dem Termin zuordnen

**Files:**
- Modify: `src/db/run-actions.ts`
- Test: `src/db/run-actions.test.ts`

**Interfaces:**
- Produces: `type RunLogInput = RunLogValues & { planEntryId?: string | null }`; `createRunLog(values: RunLogInput, now?: Date)`; `updateRunLog(id: string, changes: Partial<RunLogInput>, now?: Date)` – `undefined` = Verweis unverändert, `null` = lösen (Verweis und `runPlanSnapshot` weg), id = verknüpfen mit frischem Snapshot.
- Produces: `toRunPlanSnapshot(entry: PlanEntry): RunPlanSnapshot` (in `plan.ts`, Task-1-Datei ergänzen).

- [ ] **Step 1: Failing tests**
  - `'verknüpft und schreibt den Snapshot'` – Snapshot gleicht Titel, Datum, Vorgaben, Anleitung des Termins.
  - `'lehnt Workout-Termin ab'` → `PLAN_MESSAGES.notRun`; `'lehnt belegten Termin ab'` (anderer Lauf) → `PLAN_MESSAGES.taken`; derselbe Lauf erneut gespeichert → ok.
  - `'null löst'` – danach weder `planEntryId` noch `runPlanSnapshot`.
  - `'Ändern ohne planEntryId behält den Verweis'` – `updateRunLog(id, { notes: 'x' })`.
  - `'Löschen gibt frei'` – danach `loadTakenPlanEntryIds([p])` leer.
- [ ] **Step 2: Run** – FAIL.
- [ ] **Step 3: Implement** in der bestehenden Transaktion (um `planEntries`, `workoutSessions` erweitert). Den irreführenden Kommentar „aus einer neueren Sicherung“ in `updateRunLog` dabei korrigieren: unbekannte Felder überleben nur Schreibvorgänge dieser Version, nicht den Restore (Zod verwirft sie).
- [ ] **Step 4: Run** – PASS.
- [ ] **Step 5: Commit** `Plan: Lauf dem Termin zuordnen`

---

### Task 6: Lesen und Kalender auf Termine umstellen

**Files:**
- Create: `src/db/plan-queries.ts`, `src/db/plan-queries.test.ts`
- Modify: `src/domain/training-calendar.ts` (+ Test), `src/components/TrainingCalendar.tsx`, `src/pages/ProgramsPage.tsx:121-160,301-320`, `src/db/history-queries.ts`

**Interfaces:**
- Produces (plan-queries.ts):
  - `loadPlanBetween(from: string, to: string): Promise<{ entries: PlanEntry[]; links: Record<string, PlanEntryLink> }>` – inklusive beider Grenzen, sortiert
  - `loadUpcomingPlan(today: string): Promise<{ entries: PlanEntry[]; links: Record<string, PlanEntryLink> }>` – ab heute
  - `loadRunPlanOptions(day: string, currentRunId?: string): Promise<PlanEntry[]>` – offene Lauf-Termine der Kalenderwoche von `day` plus der mit `currentRunId` verknüpfte
- Produces (history-queries.ts): `loadRunDatesBetween(from: string, to: string): Promise<{ id: string; date: string }[]>`
- Produces (training-calendar.ts):
  - `CalendarTemplateRef` → `interface CalendarUnitRef { id: string; name: string; kind: 'workout' | 'run' }`
  - `BuildTrainingCalendarInput` ohne `templates`, neu: `planEntries: PlanEntry[]; planLinks: Record<string, PlanEntryLink>; templateNames: Record<string, string>; runs: { id: string; date: string }[]`
  - `CalendarDay.planned` = Termine des Tages, deren Zustand nicht `erledigt` ist *oder* die an diesem Tag erledigt wurden; `CalendarDay.done` = an diesem Tag abgeschlossene Sessions und Läufe
  - Zustand: `done > 0` → alle offenen geplanten abgedeckt ? `erledigt` : `teilweise`; sonst keine offenen geplanten → `leer`; sonst vergangen → `verpasst`, sonst `geplant`. Ein Termin, der an einem anderen Tag erledigt wurde, zählt an seinem Tag nicht mehr.
  - `countWeekProgress(row)` zählt Termine der Woche und davon erledigte.
  - `templatesOnWeekday` und `templatesWithoutSchedule` entfallen. `normalizeScheduledWeekdays` bleibt, Task 9 liest es.

- [ ] **Step 1: Failing tests `training-calendar.test.ts`** (bestehende Wochentags-Tests auf Termine umschreiben)
  - Termin Mo `2026-10-05`, `startedOn: '2026-10-05'`, `now` Mi → Mo `verpasst`, Di `leer`.
  - Lauf am Di `2026-10-06` ohne Termin → Di `erledigt`, `done[0].kind === 'run'`.
  - Termin Mo, mit Session am Di erledigt → Mo `leer`, Di `erledigt`.
  - Zwei Termine am Do, einer erledigt → `teilweise`.
  - Ohne `startedOn` → alle Tage `leer`, kein `date`.
- [ ] **Step 2: Failing tests `plan-queries.test.ts`** – `loadPlanBetween` liefert Links (abgebrochene Session ohne Link); `loadRunPlanOptions('2026-10-07')` enthält offene Lauf-Termine Mo–So dieser Woche, nicht die der Folgewoche, nicht belegte – außer dem eigenen.
- [ ] **Step 3: Run** – FAIL.
- [ ] **Step 4: Implement.** `TrainingCalendar` verliert die Prop `templates` und den Block unter dem Raster (Wochentags-Liste, „Ohne festen Tag“, Hinweis „Trainingstage“). `ProgramsPage` lädt `loadPlanBetween` und `loadRunDatesBetween` über denselben `calendarRange` (als `YYYY-MM-DD`) und ersetzt `todaysTemplates` durch `pickTodayPlan(...).todayOpen` (Namen über `planEntryName`). Die Karten `WeekPlanBlockCard` (Progression) bleiben unverändert.
- [ ] **Step 5: Run** `npx vitest run && npm run check:strict && npm run lint` – PASS.
- [ ] **Step 6: Commit** `Plan: Kalender liest Termine und Läufe`

---

### Task 7: Terminliste und Sheets im Programm-Tab

**Files:**
- Create: `src/components/PlanWeekSection.tsx`, `src/components/PlanEntrySheet.tsx`, `src/components/PlanSeriesSheet.tsx`
- Modify: `src/pages/ProgramsPage.tsx`, `src/components/WeekdayPicker.tsx` (falls die Props für das Sheet angepasst werden müssen)
- Test: `e2e/plan-entries.spec.ts` (neu)

**Interfaces:**
- Consumes: Task 2, 3, 6.
- Produces:
  - `PlanWeekSection({ weekStart: Date; onShiftWeek?: (delta: -1 | 1) => void })` – lädt selbst über `loadPlanBetween`; `onShiftWeek` nur gesetzt, wenn keine Programmwoche die Woche bestimmt
  - `PlanEntrySheet({ open: boolean; entry?: PlanEntry; defaultDate: string; onClose: () => void })`
  - `PlanSeriesSheet({ open: boolean; defaultStartDate: string; onClose: () => void })`
  - Testanker: `data-plan-week` (Montag als `YYYY-MM-DD`), `data-plan-day` (Datum), `data-plan-entry` (id), `data-plan-entry-state` (`offen|belegt|erledigt`)

Verhalten (Spec Abschnitt 5):
- Mit `program.startedOn`: `weekStart = programWeekStart(startedOn, selectedWeek)`. Ohne: eigener ephemerer `useState` mit `startOfCalendarWeek(new Date())` und Pfeilen ‹ ›. **Ohne aktives Programm** rendert `ProgramsPage` unter dem bestehenden `Empty` ebenfalls `PlanWeekSection` mit Pfeilen – Termine brauchen kein Programm.
- Zeile: Icon (`Dumbbell` aus lucide bzw. `RunIcon`), Name über `planEntryName`, zweite Zeile `describeRunTarget` oder Notiz; erledigt als `DoneRow`, offen neutral. ↑/↓ (`IconButton`, Labels `'Früher am Tag'`/`'Später am Tag'`) nur bei ≥ 2 Terminen am Tag und nur für nicht belegte. Antippen öffnet `PlanEntrySheet`.
- Leere Woche: `Empty` „Keine Termine in dieser Woche“.
- Knöpfe „Termin hinzufügen“ (Datum: heute, wenn in der Woche, sonst `weekStart`) und „Serie anlegen“.
- `PlanEntrySheet`: `Sheet` mit `fieldNavigation`; Art als zwei Segment-Knöpfe; Workout-`SelectField`; Lauf: Titel, Strecke, Dauer (Std/Min/Sek), Pace (`m:ss`, `inputMode="text"`), Höhenmeter, Ø Puls, Anleitung (`TextArea`, Hinweis „Markdown: **fett**, Listen mit -“); Datum, Notiz; Speichern, Löschen über `ConfirmDialog`. Belegter Termin: nur Anzeige „Erledigt am …“ bzw. „Läuft gerade“ und Link auf `/history/{sessionId}` bzw. `/runs/{runId}`. Fehler aus `db/` als `Alert` im Sheet.
- `PlanSeriesSheet`: Art, Workout oder Laufvorgabe (dieselben Felder, Komponente teilen statt kopieren), `WeekdayPicker`, Startdatum, Wochen (1–26, Vorgabe 4); Meldung „6 angelegt, 2 gab es schon“.

- [ ] **Step 1: Failing e2e `plan-entries.spec.ts`** (`resetDatabase`, `seedSampleData`, Startdatum setzen wie in `program-calendar.spec.ts`)
  - `'legt einen Lauf-Termin an und zeigt die Vorgabe'` – „Termin hinzufügen“, Lauf, Titel „Intervalle 6×400“, Strecke `7`, Pace `5:00` → Zeile mit `7 km · 5:00 /km`, `data-plan-entry-state="offen"`.
  - `'Serie legt Termine an und meldet Duplikate'` – Serie Einheit A Mo+Do, 2 Wochen, zweimal → zweite Meldung enthält „gab es schon“.
  - `'Doppelter Termin zeigt die Meldung'`.
  - `'passt bei 320px'` – `document.documentElement.scrollWidth <= clientWidth` mit langem Titel.
- [ ] **Step 2: Run** `caffeinate -i npx playwright test e2e/plan-entries.spec.ts` – FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** dieselbe Datei + `npm run lint && npm run check` – PASS.
- [ ] **Step 5: Commit** `Plan: Terminliste und Sheets im Programm-Tab`

---

### Task 8: Home, Lauf-Sheet und Lauf-Detail

**Files:**
- Modify: `src/pages/Home.tsx:110-260`, `src/components/RunLogSheet.tsx`, `src/pages/RunDetailPage.tsx`, `src/pages/ProgramsPage.tsx` (NowCard nutzt dieselbe Ableitung)
- Test: `e2e/plan-entries.spec.ts`, `e2e/run-log.spec.ts`

**Interfaces:**
- Consumes: `loadUpcomingPlan`, `pickTodayPlan`, `planEntryName`, `loadRunPlanOptions`, `findMatchingPlanEntry`, `describeRunTarget`, `startSessionFromTemplate(id, { planEntryId })`.
- Produces: `RunLogSheet` Prop `initialPlanEntryId?: string`; Testanker `data-run-plan` am Select, `data-run-target` an der Vorgabezeile.

Verhalten:
- Home, drei Fälle, genau einer greift:
  1. `todayOpen` nicht leer → `NowCard` „Heute · {Name}“ (`eyebrow="Heute"`) für `todayOpen[0]`: Workout startet mit `planEntryId`, Lauf öffnet `RunLogSheet` mit `initialPlanEntryId`. Weitere `todayOpen` als schlichte Zeilen darunter, gleiches Verhalten.
  2. sonst `next` vorhanden → nicht-lime Karte (`SectionCard`) „Nächster Termin · {Wochentag kurz} · {Name}“, ohne Startknopf.
  3. sonst → die bisherige „Am längsten her“-`NowCard`, unverändert.
- Ist eine Session aktiv, bleibt Home wie heute (die `ActiveSessionBar` übernimmt).
- `RunLogSheet`: `SelectField` „Geplanter Lauf“ mit „Keiner“ + `loadRunPlanOptions(date, run?.id)`; Vorbelegung: bestehender Verweis, sonst `initialPlanEntryId`, sonst `findMatchingPlanEntry({ kind: 'run', day: date, … })` – neu berechnet, solange die Auswahl nicht von Hand geändert wurde. Darüber `describeRunTarget` und die Anleitung als eingeklappte Zeile (Muster `ExerciseGuideBlock`, Text über `MarkdownText`). Speichern übergibt `planEntryId` (`null` für „Keiner“).
- `RunDetailPage`: mit `runPlanSnapshot` eine Zeile „Geplant: {Titel} · {describeRunTarget}“ über den Ist-Werten.

- [ ] **Step 1: Failing e2e**
  - `'Home startet den heutigen Termin und markiert ihn erledigt'` – Termin Einheit A heute anlegen, Home → „Heute · Einheit A“, starten, alle Sätze per `completeActiveSet` abhaken bzw. Session abschließen, Programm-Tab → `data-plan-entry-state="erledigt"`.
  - `'Lauf-Sheet wählt den heutigen Termin vor'` (in `run-log.spec.ts`) – Lauf-Termin heute, Home → „Heute · Intervalle 6×400“ → `data-run-plan` hat den Termin gewählt, `data-run-target` zeigt die Vorgabe; speichern → Termin erledigt.
  - `'ohne Termine bleibt Am längsten her'`.
- [ ] **Step 2: Run** – FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** beide Spec-Dateien + `npm test && npm run check && npm run lint` – PASS.
- [ ] **Step 5: Commit** `Plan: Heute, Lauf-Sheet und Lauf-Detail kennen Termine`

---

### Task 9: Wochentage in Termine umwandeln, `scheduledWeekdays` ablösen

**Files:**
- Modify: `src/domain/plan.ts` (+ Test), `src/db/data-fix-actions.ts` (+ Test), `src/pages/SettingsPage.tsx` (Abschnitt Datenkorrekturen, Muster `applyWorkoutCategoryBackfill` ~Z. 860–890 und ~1130–1150), `src/db/template-actions.ts`, `src/pages/TemplateDetailPage.tsx` (`WeekdayPicker` ~Z. 380, 461, 755), `src/db/bootstrap.ts:142`, `e2e/program-calendar.spec.ts`

**Interfaces:**
- Produces (plan.ts): `planWeekdayMigration(input: { templates: WorkoutTemplate[]; program?: Program; programWeeks: ProgramWeek[]; weeks?: number; today: string; existingKeys: ReadonlySet<string> }): { from: string; to: string; needsWeeks: boolean; entries: PlanEntryValues[]; skipped: number }`
  - `from = today`. Hat `program.startedOn` und endet die letzte Woche (`programWeekStart(startedOn, maxWeekNumber)` + 6 Tage) nicht vor heute → `to` = dieser Tag, `needsWeeks: false`. Sonst `needsWeeks: true` und – nur wenn `weeks` gesetzt – `to = startOfCalendarWeek(today) + weeks*7 − 1` Tage. Ohne `weeks` bei `needsWeeks` → `entries: []`.
  - Je Tag Workouts nach Name (`localeCompare(…, 'de')`); Schlüssel aus `existingKeys` zählen in `skipped`.
- Produces (data-fix-actions.ts): `DataFixStatus.templatesWithWeekdays: number`; `previewWeekdaysToPlanMigration(weeks?: number, now?: Date)` → Rückgabe von `planWeekdayMigration` ohne `entries`, mit `count`; `applyWeekdaysToPlanMigration(weeks?: number, now?: Date): Promise<{ created: number; skipped: number }>` – in einer Transaktion: Termine anlegen (ans Tagesende), danach `scheduledWeekdays` von **allen** Workouts entfernen (per `put` ohne den Schlüssel).
- `TemplateInput.scheduledWeekdays` entfällt; `createTemplate`/`updateTemplate` schreiben das Feld nicht mehr.

- [ ] **Step 1: Failing tests**
  - `plan.test.ts`: Programm `startedOn '2026-10-05'`, 8 Wochen, `today '2026-10-21'`, Einheit A `[1,4]`, Einheit B `[4]` → `to '2026-11-29'`; die ersten beiden Einträge sind `2026-10-22` Einheit A, dann `2026-10-22` Einheit B (Name); kein Eintrag vor `2026-10-21`. Abgelaufenes Programm → `needsWeeks: true`, `entries: []`; dasselbe mit `weeks: 4` → `to '2026-11-15'`.
  - `data-fix-actions.test.ts`: `'wandelt um und entfernt das Feld'` → Termine da, kein Workout trägt `scheduledWeekdays`, `describeDataFixes().templatesWithWeekdays === 0`; `'zweiter Lauf legt nichts doppelt an'`.
- [ ] **Step 2: Run** – FAIL.
- [ ] **Step 3: Implement.** Settings: Zeile „Wochentage in Termine umwandeln“, deaktiviert bei `templatesWithWeekdays === 0`; `ConfirmDialog` mit Text „{count} Termine von {from} bis {to}. Die festen Wochentage der Workouts entfallen danach.“; bei `needsWeeks` vorher ein Zahlenfeld „Für wie viele Wochen?“ (Vorgabe 4, 1–26). `TemplateDetailPage`: `WeekdayPicker` und Zustand weg, an der Stelle ein `Link` „Termine im Programm-Tab“ nach `/programs`. `bootstrap.ts`: statt `scheduledWeekdays` Termine für Einheit A Mo+Do über `expandSeries` ab dem Montag der laufenden Woche, 4 Wochen. `program-calendar.spec.ts` auf Termine umschreiben (ohne Startdatum: Raster ohne Daten, Hinweis sichtbar; mit Startdatum: Mo/Do der laufenden Woche `geplant` bzw. `verpasst`).
- [ ] **Step 4: Run** `npm test && npm run check:strict && npm run lint && caffeinate -i npx playwright test e2e/program-calendar.spec.ts` – PASS.
- [ ] **Step 5: Commit** `Plan: Wochentage in Termine umwandeln, scheduledWeekdays abgelöst`

---

### Task 10: Termine im Bibliotheks-Import

**Files:**
- Create: `src/domain/plan-import.ts`, `src/domain/plan-import.test.ts`
- Modify: `src/domain/library-import.ts` (Payload-Schema, `LibraryImportState`, `LibraryImportPlan`, `LibraryImportSummary`, `planLibraryImport`, `planHasChanges`), `src/db/library-import-actions.ts`, `src/domain/models.ts` (`LibraryImportLog`), `src/lib/export.ts` (`libraryImportLogSchema`), `src/components/LibraryImportSection.tsx`, `e2e/library-import.spec.ts`

**Interfaces:**
- Produces (plan-import.ts):
  - `planRangeSchema`, `importPlanEntrySchema` (Zod; `date`, genau eines von `workout: string` / `run: { title, target*?, instructions? }`, `notes?: string | null`; `null` leert)
  - `interface PlanEntryPlanEntry { kind: ImportEntryKind; id: string; key: string; label: string; changes: ImportFieldChange[]; values?: PlanEntryValues; orderInDay: number; taken: boolean }` (`label` z. B. `„Di 6.10. · Intervalle 6×400“`)
  - `planPlanEntries(input: { range?: { from: string; to: string }; entries: ImportPlanEntryInput[]; existing: PlanEntry[]; takenIds: ReadonlySet<string>; templateIdByKey: Map<string, string>; problems: string[] }): PlanEntryPlanEntry[]`
- Erweiterungen: `LibraryImportState.planEntries: PlanEntry[]; takenPlanEntryIds: Set<string>`; `LibraryImportPlan.planEntries: PlanEntryPlanEntry[]`; Summary und `LibraryImportLog` je `createdPlanEntries`, `updatedPlanEntries`, `removedPlanEntries` (im Log optional, wie `removedAssignments`).

Regeln (Spec Abschnitt 6): Identität `planEntryKey`; `templateIdByKey` enthält bestehende **und** in derselben Datei neu angelegte Workouts; Reihenfolge am Tag = Dateireihenfolge (bestehende, nicht in der Datei genannte Termine eines Tages behalten ihren Platz davor); mit `range` werden offene Termine im Bereich, die fehlen, `removed`; belegte nie geändert oder entfernt (`kind: 'unchanged'`, `taken: true`). Abbruchmeldungen (in `problems`, Muster „Termin 3: …“): unbekanntes Workout; ungültiges Datum; doppelter Schlüssel; außerhalb `planRange`; `from` nach `to`; weder/beides `workout`/`run`; `planRange` ohne `planEntries`.

- [ ] **Step 1: Failing tests `plan-import.test.ts`**
  - neu / aktualisiert (`targetDistanceKm: 7 → 8` als Change) / unverändert; zweiter Lauf derselben Datei → alles `unchanged`.
  - `range` entfernt offenen fehlenden Termin, belässt belegten und Termine außerhalb.
  - Workout, das dieselbe Datei anlegt, ist gültig.
  - jede Abbruchmeldung einmal.
- [ ] **Step 2: Failing e2e** in `library-import.spec.ts`: Datei mit `planRange` und zwei Terminen einfügen → Vorschau zeigt `NEU` zweimal; importieren → Programm-Tab zeigt beide.
- [ ] **Step 3: Run** – FAIL.
- [ ] **Step 4: Implement.** `applyLibraryImport`: Transaktion um `planEntries`, `workoutSessions`, `runLogs` erweitern; Termine nach den Workouts schreiben (neu → `add` mit `createId()`, update → `put` des zusammengeführten Datensatzes, removed → `delete`), danach jeden berührten Tag dicht nach Zielreihenfolge nummerieren. Das Vorab-Backup greift schon heute bei `removed` – Bedingung auf `summary.removedPlanEntries > 0` erweitern. Vorschau: eigener Block „Termine“ im Stil der Zuordnungen, `ENTFERNT` rot, belegte „erledigt, bleibt“.
- [ ] **Step 5: Run** `npm test && npm run check:strict && caffeinate -i npx playwright test e2e/library-import.spec.ts` – PASS.
- [ ] **Step 6: Commit** `Plan: Termine im Bibliotheks-Import`

---

### Task 11: Plandaten im Analyse-Export

**Files:**
- Modify: `src/domain/analysis-export.ts` (+ Test), `src/lib/export.ts` (`loadAnalysisFiles`, ZIP-Liste, `buildAnalysisPasteText`), `e2e/analysis-export.spec.ts` (Dateiliste)

**Interfaces:**
- `AnalysisExportInput.planEntries: PlanEntry[]; templates: WorkoutTemplate[]` (für Namen und Art); `AnalysisExportFiles.planCsv: string`
- `plan.csv` Kopf: `datum,reihenfolge,art,name,soll_km,soll_dauer_min,soll_hm,soll_puls,soll_pace,notiz,status` – **alle** Termine (der `zeitraum` in `meta.json` leitet sich aus Sessions ab und würde künftige Termine abschneiden, die das Planungsprojekt gerade braucht), sortiert nach Datum und `reihenfolge`. `art`: `kraft`/`mobility`/`lauf`; `soll_pace` als `m:ss`; `status`: `erledigt` / `offen` (heute oder später, nicht erledigt) / `verstrichen`. Zahlen mit Dezimalpunkt.
- `sessions.csv` hängt `geplant_am` an (`planDateSnapshot`), `laeufe.csv` hängt `geplant_am`, `plan_titel` an (aus `runPlanSnapshot`).
- `meta.json`: `plan: { anzahl, erledigt, offen, verstrichen }` und in `hinweise`: „verstrichen heißt: vergangen und keiner Session oder keinem Lauf zugeordnet – nicht zwingend ausgelassen.“
- Paste-Text: Abschnitt `## plan.csv` nach `laeufe.csv`.

- [ ] **Step 1: Failing tests** – Kopfzeile wörtlich; ein erledigter, ein offener, ein verstrichener Termin mit `status`; Lauf-Termin mit `soll_pace 5:30`; letzte Spalten von `sessions.csv`/`laeufe.csv` gefüllt bzw. leer; `meta.plan.anzahl`.
- [ ] **Step 2: Run** `npx vitest run src/domain/analysis-export.test.ts` – FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Tests + `caffeinate -i npx playwright test e2e/analysis-export.spec.ts` – PASS.
- [ ] **Step 5: Commit** `Plan: plan.csv und Planspalten im Analyse-Export`

---

### Task 12: Doku, Vertrag, Gesamtlauf

**Files:**
- Modify: `CLAUDE.md`, `.claude/skills/gym-book-architect/SKILL.md`, Spiegel unter `.trae/` (Pfad: `find .trae -name SKILL.md`)

- [ ] **Step 1: CLAUDE.md** – neuer Abschnitt „The dated plan“ (Tabelle, abgeleitete Belegung, Zuordnungsregel, Sperre belegter Termine, Import mit `planRange`, Umwandlung); Abschnitt „The training calendar“ von `scheduledWeekdays` auf Termine umschreiben (Ohne-festen-Tag-Liste ist weg, Läufe zählen als erledigt); Analyse-Export: sieben Dateien, Plandaten sind jetzt drin („contains no plan data at all“ korrigieren); `appDb.ts` „version(1) through version(6)“; „Outlook“ auf Teil 3 kürzen.
- [ ] **Step 2: Vertrag** – beide `SKILL.md` gleich ändern: Termine, Serie als Kopie (keine Regel), keine Automatik.
- [ ] **Step 3: Gesamtlauf** `npm run lint && npm run check && npm run check:strict && npm test && npm run build && caffeinate -i npm run test:e2e` – Expected: alles grün; flaky Session-Specs einzeln wiederholen und im Bericht nennen.
- [ ] **Step 4: Commit** `Doku und Vertrag: datierter Trainingsplan`
