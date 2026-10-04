# Workouts per Import ersetzen – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Importdatei kann ein Workout per `replaceAssignments: true` vollständig beschreiben – Mitglieder, Reihenfolge, Supersätze –, und der Bibliotheks-Import bringt die App auf genau diesen Stand.

**Architecture:** Der bestehende reine Planer `planLibraryImport` bekommt einen Ersetzungsmodus pro Workout und die Eintragsart `removed`; `applyLibraryImport` führt den Plan wie bisher in einer Transaktion aus und löscht zusätzlich Zuordnungen samt ihrer Progressionsregeln. Kein zweites Format, kein Versionssprung.

**Tech Stack:** TypeScript, Zod, Dexie, React, Vitest (jsdom + fake-indexeddb), Playwright (WebKit).

**Spec:** [docs/superpowers/specs/2026-10-04-workout-replace-import-design.md](../specs/2026-10-04-workout-replace-import-design.md)

## Global Constraints

- `LIBRARY_IMPORT_SCHEMA_VERSION` bleibt `1`; eine Datei ohne die neuen Felder verhält sich exakt wie heute – alle bestehenden Tests bleiben unverändert grün.
- Keine neue Dexie-Version, kein `SNAPSHOT_SCHEMA_VERSION`-Sprung; `LibraryImportLog.removedAssignments` ist optional und unindiziert.
- `src/domain/` bleibt rein (kein Dexie, kein React); `npm run check:strict` deckt `src/domain` und `src/db` ab und muss grün bleiben.
- Gelöscht werden ausschließlich Zuordnungen (`workoutTemplateExercises`) ersetzter Workouts und deren `progressionRules` – nie Übungen, Workouts, Bänder, Sessions, Satzprotokolle, Tests.
- Ein fehlender Schlüssel ändert nichts; nur `null` leert ein Feld.
- UI-Texte und Kommentare deutsch mit echten Umlauten; Zahlen in der Vorschau über `formatNumber`/`describeValue`.
- Direkt auf `main` committen, nicht pushen (Push deployt).

## Review Focus

1. **Tippfehler im Workoutnamen einer Zuordnung eines ersetzten Workouts** (`"Einheit  A"` vs. `"Einheit A"` greift dank `normalizeImportKey`, `"Einheit Ä"` nicht) – erwartet: Abbruch „gibt es nicht“, nicht stilles Entfernen. Getestet in Task 2.
2. **Dieselbe Übung bleibt, wandert aber aus einem Supersatz in einen anderen** – erwartet: Id bleibt, Progressionsregeln bleiben, Gruppe wechselt, Vorschau nennt die neuen Partner. Getestet in Task 3.
3. **Laufende Session aus dem ersetzten Workout** – erwartet: Session, ihre Übungen und Satzprotokolle unverändert, `sourceTemplateExerciseId` darf ins Leere zeigen, ein anschließendes Backup lässt sich wieder einspielen. Getestet in Task 4.
4. **Ersetztes Workout, das in derselben Datei neu angelegt wird** – erwartet: alles `new`, keine `removed`, Supersätze greifen. Getestet in Task 3.
5. **`null` auf ein Feld, das nie gesetzt war, bei einer neuen Zuordnung** – erwartet: Feld fehlt im Datensatz, keine Vorschauzeile, kein `update` beim zweiten Lauf. Getestet in Task 1.

---

## Dateien

| Datei | Änderung |
|---|---|
| `src/domain/library-import.ts` | Schema, `null`-Semantik, Ersetzungsmodus, Supersätze, Summary |
| `src/domain/library-import.test.ts` | neue `describe`-Blöcke; Helfer `applyPlan`/`emptyState` erweitert |
| `src/db/library-import-actions.ts` | Transaktion um `progressionRules`, Löschen, Log-Feld |
| `src/db/library-import-actions.test.ts` | DB-Tests für Ersetzen |
| `src/domain/models.ts` | `LibraryImportLog.removedAssignments?: number` |
| `src/lib/export.ts` | `libraryImportLogSchema.removedAssignments: ….optional()` |
| `src/components/LibraryImportSection.tsx` | Label `ENTFERNT` in `danger`, Erfolgsmeldung |
| `e2e/library-import.spec.ts` | ein Ersetzen-Durchlauf |
| `CLAUDE.md`, Kopfkommentar `library-import.ts` | Regel „nie gelöscht“ präzisieren |
| `~/Documents/gym-book-daten/workout-ersetzen.md` | Formatbeschreibung fürs claude.ai-Projekt (außerhalb des Repos) |

---

### Task 1: Schema, `targetRepsMax` und `null` zum Leeren

**Files:**
- Modify: `src/domain/library-import.ts` (Schemas ~Z. 41–80, `diffAssignmentNumber`, `buildAssignmentValues`, Zuordnungs-Diff in `planAssignments`)
- Test: `src/domain/library-import.test.ts`

**Interfaces:**
- Produces: `importTemplateSchema` mit `replaceAssignments?: boolean`; `importAssignmentSchema` mit `superset?: string`, `targetRepsMax?: number | null` und `.nullable()` auf `targetReps`, `targetSeconds`, `targetWeight`, `targetHeightCm`, `restSeconds`, `notes`. `AssignmentNumberField` um `'targetRepsMax'` erweitert. Task 2/3 lesen `input.superset` und `templates[].replaceAssignments`.

- [ ] **Step 1: Failing tests** in neuem `describe('planLibraryImport - Felder leeren und Spannen')`:
  - `'übernimmt targetRepsMax bei neuer und bestehender Zuordnung'` – neu: `record.targetRepsMax === 10`; bestehend mit `targetRepsMax: 8` → Datei `10` → `changes` enthält `{ field: 'Ziel-Wdh. max.', from: '8', to: '10' }`, `values.targetRepsMax === 10`.
  - `'leert ein Feld bei null und zeigt einen Strich'` – bestehend `targetWeight: 82.5`, Datei `targetWeight: null` → `changes` enthält `{ field: 'Ziel-Gewicht', from: '82,5', to: '—' }`, `'targetWeight' in values === true`, `values.targetWeight === undefined`, `kind === 'update'`.
  - `'null auf ein leeres Feld ist keine Änderung'` – bestehend ohne `targetWeight`, Datei `null` → `kind === 'unchanged'`, `'targetWeight' in values === false`.
  - `'null bei einer neuen Zuordnung lässt das Feld weg'` – `record.targetWeight === undefined`, keine Vorschauzeile dafür.
  - `'leert eine Notiz bei null'` – bestehend `notes: 'alt'`, Datei `notes: null` → `{ field: 'Notiz', from: 'alt', to: '—' }`.
  - In `describe('parseLibraryImportPayload')`: `'akzeptiert replaceAssignments, superset und null'` – parst ohne Fehler, Werte bleiben erhalten.

- [ ] **Step 2: Run** `npx vitest run src/domain/library-import.test.ts` – Expected: die neuen Tests FAIL (Zod lehnt `null` ab / `targetRepsMax` fehlt).

- [ ] **Step 3: Implement.** Schema wie unter Interfaces. `diffAssignmentNumber(…, next?: number | null)`: `undefined` → nichts; `null` → wenn `existing[field] !== undefined`, Änderung `→ —` und `values[field] = undefined`; Zahl → wie bisher. Notiz analog (`null` leert, `optionalText` für Strings). Vorschau-Label für `targetRepsMax`: `'Ziel-Wdh. max.'`. `buildAssignmentValues` übernimmt `targetRepsMax` und mappt `null` → `undefined` für alle nullbaren Felder. Kommentar an der `values[field] = undefined`-Zeile: einzige Stelle, an der `Table.update`s Löschen über `undefined` gewollt ist.

- [ ] **Step 4: Run** `npx vitest run src/domain/library-import.test.ts && npm run check:strict` – Expected: PASS, alle bisherigen Tests unverändert grün.

- [ ] **Step 5: Commit** `git commit -m "Import: targetRepsMax und null zum Leeren von Zielfeldern"` (mit Co-Authored-By-Zeile).

---

### Task 2: Ersetzungsmodus – entfernen, Reihenfolge, Validierung

**Files:**
- Modify: `src/domain/library-import.ts` (`ImportEntryKind`, `LibraryImportState`, `LibraryImportSummary`, `planAssignments`, `planLibraryImport`, `planHasChanges`)
- Test: `src/domain/library-import.test.ts` (Helfer `emptyState` + `applyPlan` erweitern)

**Interfaces:**
- Consumes: `templates[].replaceAssignments` aus Task 1.
- Produces:
  - `type ImportEntryKind = 'new' | 'update' | 'unchanged' | 'removed'`
  - `LibraryImportState.progressionRules: ProgressionRule[]`
  - `LibraryImportSummary.removedAssignments: number`
  - Ein `removed`-Eintrag ist ein `AssignmentPlanEntry` mit `id` der bestehenden Zuordnung, `record: null`, `values: {}`, `changes: []`, `note` = `'1 Wochenregel geht mit'` / `'n Wochenregeln gehen mit'` (nur wenn n > 0). Task 4 löscht genau diese Ids.
  - Für ersetzte Workouts enthält `templateOrder` die Ziel-Ids in Dateireihenfolge – nur wenn sich etwas an Mitgliedern oder Reihenfolge ändert (Idempotenz: zweiter Lauf `templateOrder.length === 0`).

- [ ] **Step 1: Helfer anpassen.** `emptyState` setzt `progressionRules: []`; `applyPlan` filtert `removed`-Ids aus `templateExercises` und gibt `progressionRules` (ohne die der entfernten Zuordnungen) zurück. Die bestehende Idempotenz-Erwartung an `second.summary` um `removedAssignments: 0` ergänzen.

- [ ] **Step 2: Failing tests** in `describe('planLibraryImport - Workout ersetzen')`, Ausgangslage: Workout `t1` „Einheit A“ mit `te1` Squat (1), `te2` Beinstrecker (2), `te3` Klimmzug (3); je eine `ProgressionRule` auf `te1` und `te2`:
  - `'entfernt Zuordnungen, die die Datei nicht nennt, und nennt ihre Wochenregeln'` – Datei: Klimmzug (1), Squat (2), Flag gesetzt → ein `removed`-Eintrag `id: 'te2'`, `note: '1 Wochenregel geht mit'`; `summary.removedAssignments === 1`.
  - `'behält die Id bleibender Zuordnungen und übernimmt die Reihenfolge'` – `templateOrder[0].orderedIds` = `['te3', 'te1']`; Eintrag `te3` hat `{ field: 'Position', from: '3', to: '1' }`, `kind: 'update'`; keine Notiz „Position … bleibt“.
  - `'nummeriert Lücken im orderIndex dicht'` – Datei `orderIndex` 5 und 10 → `orderedIds` in dieser Reihenfolge, Positionen 1/2.
  - `'bricht ab, wenn ein ersetztes Workout keine Zuordnung in der Datei hat'` – `toThrow('Workout "Einheit A" soll ersetzt werden, die Datei nennt aber keine Übung dafür.')`.
  - `'bricht bei doppeltem orderIndex in einem ersetzten Workout ab'` – `toThrow(/orderIndex 2 steht für "Einheit A" mehrfach/)`.
  - `'bricht bei unbekanntem Workoutnamen ab, statt etwas zu entfernen'` – Flag auf „Einheit A“, Zuordnung nennt „Einheit Ä“ → wirft „gibt es nicht“ (Review Focus 1).
  - `'lässt Workouts ohne Flag additiv'` – gleiche Datei ohne Flag → kein `removed`, Notiz „Position 3 bleibt (Datei nennt 1)“ wie bisher.
  - `'ersetzt ein Workout, das in derselben Datei entsteht'` – nur `new`, kein `removed` (Review Focus 4).
  - `'ändert beim zweiten Lauf nichts mehr'` – `applyPlan` → zweiter Plan: alle `unchanged`, `removedAssignments: 0`, `templateOrder` leer, `planHasChanges(second) === false`.
  - `'planHasChanges zählt eine reine Entfernung'` – nur `removed` → `true`.

- [ ] **Step 3: Run** `npx vitest run src/domain/library-import.test.ts` – Expected: neue Tests FAIL.

- [ ] **Step 4: Implement.** In `planAssignments`: Menge der zu ersetzenden Template-Ids aus `templateEntries` + `payload.templates` (Flag) bilden. Für diese Workouts: Dateizeilen nach `orderIndex` sortieren (doppelter Index → `problems`), Zielliste = sortierte Ids; neue Zuordnungen bekommen dort ihren Platz statt über `resolveInsertPosition`; bleibende bekommen `Position`-Diff gegen ihre aktuelle 1-basierte Position; nicht genannte bestehende werden `removed`. Leeres ersetztes Workout → `problems`. `templateOrder` für ersetzte Workouts nur, wenn Zielliste ≠ aktuelle Liste. `planLibraryImport` reicht `state.progressionRules` durch, zählt `removedAssignments`; `planHasChanges` braucht keine Sonderlogik (prüft `!== 'unchanged'`). Kopfkommentar Regel 3 umformulieren (siehe Task 5 – hier schon die Datei-Variante).

- [ ] **Step 5: Run** `npx vitest run src/domain/library-import.test.ts && npm run check:strict` – Expected: PASS. `npm run check` meldet jetzt Fehler in `library-import-actions.ts`/`LibraryImportSection.tsx` (fehlendes `progressionRules`, `KIND_LABELS.removed`) – minimal mitziehen: `loadLibraryImportState` lädt `db.progressionRules.toArray()`, `KIND_LABELS.removed = 'ENTFERNT'`. Danach `npm run check` grün.

- [ ] **Step 6: Commit** `git commit -m "Import: Workouts ersetzen – entfernen und Reihenfolge aus der Datei"`.

---

### Task 3: Supersätze aus der Datei

**Files:**
- Modify: `src/domain/library-import.ts` (`planAssignments`; `NewAssignment` trägt `supersetGroupId`)
- Test: `src/domain/library-import.test.ts`

**Interfaces:**
- Consumes: Zielliste je ersetztem Workout aus Task 2; `input.superset` aus Task 1; `areGroupsContiguous` aus `src/domain/superset.ts`.
- Produces: `values.supersetGroupId` (gesetzt, oder als Schlüssel mit `undefined` zum Auflösen) bzw. `record.supersetGroupId`; Vorschauzeile `{ field: 'Supersatz', from, to }`.

- [ ] **Step 1: Failing tests** in `describe('planLibraryImport - Supersätze')`:
  - `'bildet eine Gruppe aus dem Gruppennamen'` – Squat + Klimmzug `superset: 'Block 1'` → beide `values.supersetGroupId` gleich und gesetzt; Squat-Vorschau `{ field: 'Supersatz', from: 'allein', to: 'mit Klimmzug' }`.
  - `'behält die Gruppen-Id bei gleichen Mitgliedern'` – Bestand `te1`/`te3` mit `supersetGroupId: 'g1'`, Datei gleiche Gruppe (Name beliebig, z. B. „block 1“) → beide `unchanged`, kein `supersetGroupId` in `values`.
  - `'vergibt eine neue Id, wenn ein Fremder die alte Id behält'` – Bestand `g1` auf `te1`,`te2`,`te3`; Datei gruppiert nur `te1`+`te3`, `te2` ohne `superset` → `te1`/`te3` neue gemeinsame Id ≠ `'g1'`, `te2` löst auf.
  - `'löst eine Gruppe auf, wenn die Datei keinen Gruppennamen nennt'` – `'supersetGroupId' in values`, Wert `undefined`, Vorschau `to: 'allein'`.
  - `'wechselt die Gruppe, ohne die Id der Zuordnung zu ändern'` (Review Focus 2) – Eintrags-`id` bleibt, Regeln bleiben (kein `removed`), Vorschau nennt neuen Partner.
  - `'bricht bei nicht zusammenhängender Gruppe ab'` – `toThrow(/Supersatz "Block 1" in "Einheit A" ist nicht zusammenhängend/)`.
  - `'bricht bei einer Gruppe mit nur einem Mitglied ab'` – `toThrow(/Supersatz "Block 1" in "Einheit A" hat nur eine Übung/)`.
  - `'bricht bei superset in einem nicht ersetzten Workout ab'` – `toThrow(/Zuordnung 1: "superset" geht nur bei einem Workout mit "replaceAssignments": true/)`.
  - `'bildet Gruppen in einem neu angelegten Workout'` – neue Records tragen dieselbe `supersetGroupId`.
  - Idempotenz-Test aus Task 2 um eine Gruppe erweitern: zweiter Lauf bleibt komplett `unchanged`.

- [ ] **Step 2: Run** `npx vitest run src/domain/library-import.test.ts` – Expected: neue Tests FAIL.

- [ ] **Step 3: Implement.** Nach der Sortierung je ersetztem Workout: Gruppen über `normalizeImportKey(superset)` sammeln; Einzelmitglied → `problems`; Zusammenhang via `areGroupsContiguous` auf `{ id, orderIndex, supersetGroupId: label }` → `problems`. Id-Wahl je Gruppe: alle Mitglieder tragen schon dieselbe Id `g` **und** keine andere bleibende Zuordnung des Workouts trägt `g` → `g`, sonst `createId()`. Diff gegen Bestand: Vorschau beschreibt Partner – `'allein'` oder `'mit A'` / `'mit A und B'` / `'mit A, B und C'` (Namen aus der Zielliste bzw. dem Bestand). Ohne `superset` und mit bestehender Gruppe → `values.supersetGroupId = undefined` (Schlüssel gesetzt).

- [ ] **Step 4: Run** `npx vitest run src/domain/library-import.test.ts && npm run check:strict` – Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Import: Supersätze beim Ersetzen aus der Datei"`.

---

### Task 4: Schreiben, Protokoll, Backup-Schema

**Files:**
- Modify: `src/db/library-import-actions.ts`, `src/domain/models.ts:417` (`LibraryImportLog`), `src/lib/export.ts:191` (`libraryImportLogSchema`)
- Test: `src/db/library-import-actions.test.ts`

**Interfaces:**
- Consumes: `removed`-Einträge, `templateOrder`, `values.supersetGroupId` aus Tasks 2–3.
- Produces: `LibraryImportLog.removedAssignments?: number`.

- [ ] **Step 1: Failing tests** in `describe('applyLibraryImport - Workout ersetzen')` (Seed: Workout mit drei Zuordnungen, je eine `ProgressionRule` auf entfernter und bleibender Zuordnung über eine angelegte `Program`/`ProgramWeek`):
  - `'entfernt Zuordnungen samt ihrer Wochenregeln und lässt die anderen stehen'` – `db.workoutTemplateExercises` ohne die entfernte Id; `db.progressionRules.where('templateExerciseId').equals(removedId).count() === 0`, die der bleibenden `=== 1`.
  - `'schreibt Reihenfolge und Supersätze'` – `orderIndex` 1..n in Dateireihenfolge, gemeinsame `supersetGroupId`, aufgelöste ohne Schlüssel (`'supersetGroupId' in row === false`).
  - `'lässt eine laufende Session aus dem Workout unberührt'` (Review Focus 3) – Session per `startSessionFromTemplate` vor dem Import; danach Session, Session-Übungen, Set-Logs per `toEqual` identisch; anschließend alle Tabellen per `toArray()` zu einem Objekt mit `schemaVersion: SNAPSHOT_SCHEMA_VERSION` und `exportedAt` zusammensetzen (Feldnamen wie in `createDatabaseSnapshot`, `src/lib/export.ts:314`), `parseDatabaseSnapshot(JSON.stringify(…))` wirft nicht – das prüft die referenzielle Integrität mit der ins Leere zeigenden `sourceTemplateExerciseId`.
  - `'rollt alles zurück, wenn die Planung abbricht'` – Datei mit Flag und doppeltem `orderIndex` → `rejects.toThrow()`, Bestand inkl. Regeln unverändert.
  - `'protokolliert die Zahl entfernter Zuordnungen'` – `log.removedAssignments === 1`.
  - `'füllt den Leer-Wert einer Zuordnung mit null'` – `targetWeight: null` → `'targetWeight' in row === false`.

- [ ] **Step 2: Run** `npx vitest run src/db/library-import-actions.test.ts` – Expected: neue Tests FAIL.

- [ ] **Step 3: Implement.** Transaktion um `db.progressionRules` erweitern. Vor dem Zuordnungs-Schreiben: für jeden `removed`-Eintrag `progressionRules.where('templateExerciseId').equals(id).delete()`, dann `workoutTemplateExercises.delete(id)` (Reihenfolge wie `deleteTemplateExercise`). `orderIndexById` schreibt danach nur noch existierende Ids. Log: `removedAssignments: current.summary.removedAssignments`. `models.ts`: optionales Feld mit Einzeiler-Kommentar; `export.ts`: `removedAssignments: z.number().int().nonnegative().optional()`.

- [ ] **Step 4: Run** `npx vitest run src/db/ src/lib/ && npm run check && npm run check:strict` – Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Import: entfernte Zuordnungen samt Wochenregeln schreiben und protokollieren"`.

---

### Task 5: Vorschau, E2E, Dokumentation

**Files:**
- Modify: `src/components/LibraryImportSection.tsx`, `e2e/library-import.spec.ts`, `CLAUDE.md` (Abschnitt „The library import“), Kopfkommentar `src/domain/library-import.ts`
- Create: `~/Documents/gym-book-daten/workout-ersetzen.md`

**Interfaces:**
- Consumes: `ImportEntryKind` inkl. `'removed'`, `summary.removedAssignments`.

- [ ] **Step 1: Failing e2e** `test('ersetzt ein Workout und entfernt, was die Datei nicht nennt')` – Datei 1 legt „Einheit X“ mit drei Übungen an; Datei 2 mit Flag nennt zwei davon in umgekehrter Reihenfolge, als Supersatz. Erwartung in der Vorschau: Zeile mit Text `ENTFERNT` und dem Übungsnamen sichtbar; nach Bestätigen Erfolgsmeldung enthält `1 entfernt`; in der Workout-Ansicht stehen genau zwei Übungen in Dateireihenfolge als ein Supersatz-Block (`Supersatz: … und …`). Dritte Ausführung von Datei 2: Vorschau zeigt „Nichts zu ändern.“ bei den Zuordnungen.

- [ ] **Step 2: Run** `caffeinate -i npx playwright test e2e/library-import.spec.ts` (vorher Dev-Server neu starten, siehe CLAUDE.md) – Expected: FAIL an der Erfolgsmeldung.

- [ ] **Step 3: Implement.** `KIND_LABELS.removed = 'ENTFERNT'`; Badge bei `removed` in `text-danger` statt `text-content-secondary`. Erfolgsmeldung um `` `${formatNumber(summary.removedAssignments)} entfernt` `` hinter den Zuordnungen ergänzen (`… Zuordnungen, 1 entfernt · …`).

- [ ] **Step 4: Run** dieselbe e2e-Datei – Expected: PASS.

- [ ] **Step 5: Doku.** `CLAUDE.md`: Satz „**Nothing is ever deleted**, and existing rows keep their **position** …“ ersetzen durch die Regel: gelöscht wird nur eine Zuordnung in einem Workout, dessen Ersetzung die Datei mit `replaceAssignments: true` ausdrücklich verlangt (samt ihrer Progressionsregeln, wie `deleteTemplateExercise`); dort gelten Reihenfolge und Supersätze der Datei, ein fehlender Schlüssel ändert weiter nichts und nur `null` leert. Übungen, Workouts, Bänder bleiben unantastbar; ohne Flag gilt das alte Positionsverhalten. `~/Documents/gym-book-daten/workout-ersetzen.md`: eigenständige Formatbeschreibung für das claude.ai-Projekt (Beispiel aus der Spec, die drei Regeln Flag/`superset`/`null`, die Abbruchgründe, Hinweis: Plandaten stehen nur im Backup, nicht im Analyse-Export).

- [ ] **Step 6: Gesamtlauf** `npm run lint && npm run check && npm run check:strict && npm test && npm run build` – Expected: alles grün.

- [ ] **Step 7: Commit** `git commit -m "Import: Entfernungen in der Vorschau, Doku zum Ersetzen"` (die Datei unter `~/Documents` liegt außerhalb des Repos und wird nicht committet).
