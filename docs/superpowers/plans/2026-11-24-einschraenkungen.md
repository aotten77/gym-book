# Einschränkungen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pausen, Ersatzübungen und Anpassungen über einen Zeitraum als eigene
Daten (Tabelle `restrictions`), geliefert per Bibliotheks-Import, sichtbar in
Kraft- und geführten Einheiten, getrennt im Analyse-Export; dazu vorab ein
Banner für die Termin-Notiz.

**Architecture:** Alle Regeln liegen pur in `src/domain/restriction.ts`
(Auswertung, Anpassung, Art einer Zeile) und `src/domain/restriction-import.ts`
(Schema und Planung des Import-Blocks). Der Start einer Einheit löst die
Einschränkungen einmal auf und friert das Ergebnis als Snapshot an
`WorkoutSessionExercise` bzw. `GuidedRun` ein; alles Spätere (Fokus, letzte
Werte, Export) liest nur diesen Snapshot. Die App selbst schreibt nur
„Aufheben“ und den Historien-Schalter.

**Tech Stack:** Vite, React, TypeScript, Dexie (IndexedDB), Zod, Vitest
(jsdom + fake-indexeddb), Playwright (WebKit).

**Spec:** `docs/superpowers/specs/2026-11-24-einschraenkungen-design.md` – vor
jeder Aufgabe den genannten Abschnitt lesen. Bindend daneben:
`.claude/skills/gym-book-architect/SKILL.md`.

## Global Constraints

- **Nichts committen ohne ausdrückliche Freigabe von Andreas.** Jeder
  Commit-Schritt unten heißt: Stand zeigen, auf „commit“ warten. Nie etwas im
  Arbeitsverzeichnis zurücksetzen.
- Vor Aufgabe 1 müssen die drei älteren, fertigen Änderungen im
  Arbeitsverzeichnis committet sein (Andreas bestätigt vorher den
  Datumsfeld-Fix auf dem iPhone). Sonst vermischen sich die Diffs.
- Das Repo ist **öffentlich**: nur erfundene Beispiele („Beispiel A“,
  „Sprungkniebeuge“) in Code, Tests, Fixtures, Doku.
- UI-Texte und Kommentare deutsch mit echten Umlauten; jede angezeigte Zahl
  über `formatNumber`; Fehler aus `db/` sind deutsche Nutzertexte.
- Stil von Hand: einfache Anführungszeichen, etwa 100 Zeichen pro Zeile.
  **Nie `npx prettier --write`.**
- Dexie `update` mit `undefined` löscht das Feld. Einzige gewollte Stelle:
  `liftedAt` beim Wieder-Aktivieren und `excludedFromProgressAt` /
  `pauseOverriddenAt` beim Zurücknehmen – dort kommentieren.
- Keinen booleschen Wert indexieren. `restrictions: 'id'`, sonst kein Index.
- Farbe: pausiert, angepasst, Ersatz, Hinweis sind **neutrale Tinte** – kein
  Lime, kein Grün, kein Rot (`docs/architecture/ui-palette.md`).
- Session-Seite nicht umbauen: Liste außen, Fokus-Sheet innen
  (`docs/architecture/session-screen.md`).
- `LIBRARY_IMPORT_SCHEMA_VERSION` bleibt `1`, `SNAPSHOT_SCHEMA_VERSION` bleibt
  `1`; neue Felder überall `.optional()`, `restrictions` im Import **ohne**
  `.default([])`.
- Export-Spalten nur **am Ende** anhängen.
- Gesamtprüfung nach jeder Aufgabe: `npm run check && npm run check:strict &&
  npm run lint && npm test` grün. E2E: vorher `lsof -ti :5173 | xargs -r
  kill`, dann `caffeinate -i npm run test:e2e` im Hintergrund, währenddessen
  keine Quelldatei ändern.

## Review Focus

1. **Backup verliert Snapshot-Felder:** Die Zod-Schemata in `src/lib/export.ts`
   (`workoutSessionExerciseSchema`, `guidedRunSchema`,
   `guidedProtocolEntrySchema`, `libraryImportLogSchema`) sind normale
   `z.object` und verwerfen unbekannte Schlüssel. Ohne Nachtrag stellt eine
   Wiederherstellung jede pausierte Übung als normale offene Übung her. Test in
   Aufgabe 3.
2. **Angepasste Sekunden ohne Ansage:** Die Ansagen nennen die Dauer („Als
   Nächstes: Taube, links, 30 Sekunden“) und sind vorab erzeugt. Eine
   Schrittanpassung macht ohne Nachtrag aus „Stimme + Ton“ stumm „Nur Ton“.
   Lösung und Test in Aufgabe 10.
3. **Ersatz verschiebt die Reihenfolge:** Nach dem Einfügen müssen
   `orderIndex` dicht und eindeutig sein, sonst springt der Fokus oder
   `reorderSessionExercises` lehnt ab. Test in Aufgabe 6.
4. **Supersatz mit pausiertem Partner:** Der Fokus darf nicht auf den
   pausierten Partner springen, die Runde läuft mit den verbliebenen. Test in
   Aufgabe 7.
5. **Ein alter Import mit Zusatzschlüssel bricht jetzt ab:** `_hinweis` muss
   weiter durchgehen und darf den Hash nicht ändern (Golden-Hash-Test). Test in
   Aufgabe 4.

---

### Task 1: Schritt 0 – Banner für die Termin-Notiz

Spec Abschnitt 10.

**Files:**
- Create: `src/components/PlanNoteBanner.tsx`
- Modify: `src/pages/SessionPage.tsx`, `src/pages/GuidedStartPage.tsx`,
  `src/db/plan-queries.ts`
- Test: `src/db/plan-queries.test.ts`, `e2e/plan-entries.spec.ts`

**Interfaces:**
- Produces: `loadPlanNoteForGuidedStart(templateId: string, requestedId:
  string | undefined, now: Date): Promise<string | undefined>` in
  `plan-queries.ts` – nutzt `pickPlanEntryForStart` aus `src/domain/plan.ts`
  mit denselben `takenIds` wie `findPlanEntryForStart`.
- Produces: `<PlanNoteBanner note={string} />` – neutral, ein Tipp blendet es
  aus (Komponenten-State, nach Reload wieder da), `data-plan-note`.

- [ ] **Step 1: Failing test** in `plan-queries.test.ts`:
  `it('liefert die Notiz des offenen Termins von heute für den geführten Start')`
  – Termin heute mit `notes: 'Beispielnotiz'` → `'Beispielnotiz'`;
  `it('nimmt den ausdrücklich gewählten Termin vor dem von heute')`;
  `it('liefert nichts für einen belegten Termin')`.
- [ ] **Step 2:** `npx vitest run src/db/plan-queries.test.ts` → FAIL
  (Funktion fehlt).
- [ ] **Step 3:** `loadPlanNoteForGuidedStart` implementieren; Banner-Komponente
  bauen; `SessionPage` liest den Termin über `session.planEntryId` und zeigt
  das Banner oben, wenn `notes` gesetzt ist; `GuidedStartPage` zeigt es mit der
  Termin-Id aus `readGuidedStartState(location.state)`.
- [ ] **Step 4:** Test grün; E2E-Fall in `plan-entries.spec.ts`: Termin mit
  Notiz importieren, starten, `[data-plan-note]` sichtbar, Tipp blendet aus,
  Reload zeigt es wieder; 320px ohne Überlauf.
- [ ] **Step 5:** `session-screen.md` um das Banner ergänzen. Gesamtprüfung.
  Commit (nach Freigabe): `feat: Banner für die Notiz des Termins`.

### Task 2: Datenmodell und pure Regeln

Spec Abschnitte 1, 2.

**Files:**
- Modify: `src/domain/models.ts`
- Create: `src/domain/restriction.ts`, `src/domain/restriction.test.ts`

**Interfaces:**
- Produces in `models.ts` (Felder genau wie Spec Abschnitt 1):
  `Restriction`, `ExerciseTarget`, `StepTarget`, `RestrictionReplacement`,
  `RestrictionPause`, `ExerciseAdjustment`, `StepAdjustment`,
  `RestrictionAdjustment`, `RestrictionNote = { by: string; note: string }`,
  `RestrictionKind = 'pausiert' | 'trotzdem' | 'angepasst' | 'ausgenommen' |
  'ersatz' | 'gehalten' | 'hinweis'`; neue optionale Felder an
  `WorkoutSessionExercise` (`pausedBy`, `pausedUntil`, `pauseOverriddenAt`,
  `adjustedBy`, `adjustmentNotes`, `targetsBeforeAdjustment`,
  `progressionHeld`, `replacementFor`, `excludedFromProgressAt`), an
  `GuidedRun` (`pausedSteps`, `adjustedSteps`), an `GuidedProtocolEntry`
  (`restrictedBy`), `GuidedProtocolStatus` um `'paused'`, an
  `LibraryImportLog` (`createdRestrictions`, `updatedRestrictions`,
  `liftedRestrictions`, `reactivatedRestrictions`).
- Produces in `restriction.ts`:
  - `type AdjustableTargets = Pick<WorkoutSessionExercise, 'workSetCount' |
    'targetReps' | 'targetRepsMax' | 'targetSeconds' | 'targetWeight' |
    'targetHeightCm'>`
  - `isStepTarget(target: ExerciseTarget | StepTarget): target is StepTarget`
  - `isRestrictionActive(restriction: Restriction, day: string): boolean`
  - `describeRestrictionState(restriction: Restriction, day: string):
    'aktiv' | 'angekündigt' | 'abgelaufen' | 'aufgehoben'`
  - `interface RestrictionEffect { pausedBy: string[]; pausedUntil?: string;
    replacements: { restrictionName: string; replacement:
    RestrictionReplacement }[]; adjustments: { restrictionName: string;
    adjustment: ExerciseAdjustment }[] }`
  - `resolveRestrictionEffect(input: { restrictions: Restriction[]; day:
    string; templateId?: string; exerciseId: string }): RestrictionEffect`
  - `type RestrictionSnapshot = Pick<WorkoutSessionExercise, 'pausedBy' |
    'pausedUntil' | 'adjustedBy' | 'adjustmentNotes' |
    'targetsBeforeAdjustment' | 'progressionHeld'>`
  - `applyRestrictionEffect(targets: AdjustableTargets, effect:
    RestrictionEffect): { targets: AdjustableTargets; snapshot:
    RestrictionSnapshot }` – leere Felder fehlen im Snapshot ganz (keine
    `undefined`-Schlüssel).
  - `resolveGuidedSteps(input: { restrictions: Restriction[]; day: string;
    templateId: string; steps: readonly GuidedStep[] }): { steps:
    GuidedStep[]; pausedSteps: NonNullable<GuidedRun['pausedSteps']>;
    adjustedSteps: NonNullable<GuidedRun['adjustedSteps']> }`
  - `interface RestrictionConflict { names: [string, string]; target:
    ExerciseTarget | StepTarget; field: keyof AdjustableTargets | 'seconds' |
    'replacement' }`
  - `findAdjustmentConflicts(restrictions: Restriction[]):
    RestrictionConflict[]`
  - `isPausedSessionExercise(row: WorkoutSessionExercise): boolean` –
    `pausedBy` nicht leer und kein `pauseOverriddenAt`.
  - `isInactiveSessionExercise(row: WorkoutSessionExercise): boolean` –
    `wasSkipped || isPausedSessionExercise(row)`.
  - `sessionRestrictionKind(row: WorkoutSessionExercise): RestrictionKind |
    undefined` – Rangfolge der Tabelle in Spec Abschnitt 1.
  - `isRestrictedExecution(row): boolean` – Art `trotzdem`, `angepasst`,
    `ausgenommen`.
  - `suppressesProgressionHint(row): boolean` – Art `trotzdem`, `angepasst`,
    `gehalten`.

- [ ] **Step 1: Failing tests** in `restriction.test.ts` (Tage als
  `YYYY-MM-DD`, Einschränkung „Beispiel A“ von `2026-12-01` bis
  `2026-12-14`):
  - `isRestrictionActive`: `2026-11-30` false, `2026-12-01` true,
    `2026-12-14` true, `2026-12-15` false; ohne `until` am `2027-06-01` true;
    mit `liftedAt` false.
  - `describeRestrictionState`: `angekündigt` am `2026-11-30`, `abgelaufen` am
    `2026-12-15`, `aufgehoben` mit `liftedAt` (auch vor `from`).
  - `resolveRestrictionEffect`: Pause „überall“ trifft jede `templateId`;
    Pause mit `templateId: 't1'` trifft `t2` nicht; zwei Pausen →
    `pausedBy` beide Namen, `pausedUntil` das spätere `until`, ohne `until` bei
    einer offenen → `pausedUntil` fehlt; Pause und Anpassung → beide geliefert;
    Schrittziele werden ignoriert.
  - `applyRestrictionEffect`: Wochenwert `targetWeight: 45`, Anpassung `40` →
    `targets.targetWeight === 40`, `snapshot.targetsBeforeAdjustment` ist
    `{ targetWeight: 45 }`; Anpassung `45` bei Wochenwert `45` →
    `targetsBeforeAdjustment` fehlt; zwei Einschränkungen mit Notiz →
    `adjustmentNotes` in Reihenfolge der Namen, `adjustedBy` beide;
    `holdProgression` → `progressionHeld: true`, Werte unverändert.
  - `resolveGuidedSteps`: Vorlage `['Tiefe Hocke', 'Taubenpose',
    'Kosakenhocke']`; `{ stepName: 'tiefe hocke' }` (Groß/klein egal über
    `normalizeImportKey`) pausiert Index 0 → `steps` hat 2 Einträge,
    `pausedSteps[0].index === 0`; `{ stepName: 'Taubenpose', seconds: 30 }`
    → `steps[0].seconds === 30`, `adjustedSteps[0]` mit `index: 0`,
    `secondsBefore: 45`; Pause schlägt Anpassung desselben Schritts;
    `templateId` einer anderen Vorlage trifft nicht.
  - `findAdjustmentConflicts`: zwei `targetWeight` überlappend → ein
    Konflikt mit `field: 'targetWeight'`; `targetWeight` und `targetReps` →
    keiner; zwei reine `note` → keiner; „überall“ gegen `templateId` →
    Konflikt; nicht überlappende Zeiträume → keiner; aufgehobene zählt nicht;
    zwei `replacement` für dieselbe Übung → `field: 'replacement'`;
    `{ stepName }` gegen `{ stepName, templateId }` mit je `seconds` →
    Konflikt.
  - `sessionRestrictionKind`: je ein Fall für alle sieben Arten plus
    Rangfolge-Fälle (pausiert+angepasst → `pausiert`; trotzdem+angepasst →
    `trotzdem`; angepasst+ausgenommen → `angepasst`; ersatz+gehalten →
    `ersatz`); `isRestrictedExecution` und `suppressesProgressionHint` je
    über alle sieben Arten.
- [ ] **Step 2:** `npx vitest run src/domain/restriction.test.ts` → FAIL.
- [ ] **Step 3:** Typen und Funktionen implementieren. Namensabgleich für
  Schritte über `normalizeImportKey` aus `src/domain/import-key.ts`.
- [ ] **Step 4:** Test grün; Gesamtprüfung.
- [ ] **Step 5:** Commit (nach Freigabe): `feat: Datenmodell und Regeln der
  Einschränkungen`.

### Task 3: Tabelle, Backup, Aufheben

Spec Abschnitte 1 (Store), 7 (`liftRestriction`), 9 (Backup).

**Files:**
- Modify: `src/db/appDb.ts`, `src/lib/export.ts`
- Create: `src/db/restriction-actions.ts`, `src/db/restriction-actions.test.ts`
- Test: `src/lib/export.test.ts` (bzw. die bestehende Backup-Testdatei)

**Interfaces:**
- Produces: `db.restrictions: Table<Restriction, string>`, `version(8)` mit
  `restrictions: 'id'`, ohne `upgrade()`.
- Produces: `liftRestriction(id: string, now?: Date): Promise<void>` – setzt
  `liftedAt` und `updatedAt`; wirft „Einschränkung nicht gefunden.“; schon
  aufgehoben → keine Änderung.
- Produces: `loadRestrictions(): Promise<Restriction[]>` in
  `restriction-actions.ts` (ganze Tabelle).

- [ ] **Step 1: Failing tests:** `liftRestriction` setzt `liftedAt`, lässt
  `pauses`/`adjustments` unverändert; zweiter Aufruf ändert `liftedAt` nicht.
  Backup: `it('stellt Einschränkungen und Snapshot-Felder wieder her')` –
  Snapshot mit einer `Restriction`, einer Session-Zeile mit `pausedBy`,
  `adjustmentNotes`, `targetsBeforeAdjustment`, `replacementFor`,
  `excludedFromProgressAt`, einem `GuidedRun` mit `pausedSteps`,
  `adjustedSteps`, Protokollzeile `status: 'paused'` mit `restrictedBy`,
  einem `LibraryImportLog` mit `createdRestrictions: 1` → nach
  Wiederherstellung alles gleich (`toEqual`).
  `it('nimmt ein Backup ohne restrictions an')`.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** `version(8)`; in `export.ts` `restrictionSchema`,
  `restrictions: z.array(restrictionSchema).optional()` im Snapshot, die neuen
  optionalen Felder in den vier Schemata (Review Focus 1),
  `createDatabaseSnapshot`, `restoreDatabaseSnapshot` (leeren, schreiben,
  zählen). Prüfen, dass „Alle Daten löschen“ die neue Tabelle mit leert (sonst
  nachtragen und testen).
- [ ] **Step 4:** Tests grün; `CLAUDE.md` Abschnitt „Schema changes“ um
  `version(8)` ergänzen. Gesamtprüfung.
- [ ] **Step 5:** Commit (nach Freigabe): `feat: Tabelle restrictions mit
  Backup und Aufheben`.

### Task 4: Import – Schema, Planung, Vorschau

Spec Abschnitt 8, „Nachträglich entschieden“ 1–2.

**Files:**
- Create: `src/domain/restriction-import.ts`,
  `src/domain/restriction-import.test.ts`
- Modify: `src/domain/library-import.ts`,
  `src/domain/library-import-summary.ts`, `src/db/library-import-actions.ts`
  (nur `loadLibraryImportState`), `src/components/LibraryImportSection.tsx`
- Test: `src/domain/library-import.test.ts`

**Interfaces:**
- Consumes: Typen und `isRestrictionActive`, `describeRestrictionState`,
  `findAdjustmentConflicts` aus Task 2.
- Produces in `restriction-import.ts`:
  - `importRestrictionSchema` (Zod). Alle Objekte des neuen Blocks
    `.strict()`: ein vertippter Feldname bricht ab statt still zu fehlen.
  - `type RestrictionPlanKind = 'new' | 'update' | 'unchanged' | 'lifted' |
    'reactivated'`
  - `interface RestrictionPlanEntry { kind: RestrictionPlanKind; id: string;
    label: string; changes: ImportFieldChange[]; record: Omit<Restriction,
    'id' | 'createdAt' | 'updatedAt'> | null; values: Partial<Restriction>;
    liftedAt: string | null | undefined; targets: string[]; stateAfter:
    'aktiv' | 'angekündigt' | 'abgelaufen' | 'aufgehoben'; note?: string }`
    – `liftedAt`: `undefined` = unverändert, `null` = entfernen, String =
    setzen; `targets` sind Klartextzeilen („Pause: Sprungkniebeuge → Ersatz
    Step-up, 3 Sätze“); `note` trägt den Satz zu `from` in der Vergangenheit.
  - `planRestrictions(input: { restrictions: ImportRestrictionInput[];
    state: LibraryImportState; exercises: ExercisePlanEntry[]; templates:
    TemplatePlanEntry[]; assignments: AssignmentPlanEntry[]; problems:
    string[] }): RestrictionPlanEntry[]`
  - `findLostRestrictedSteps(input: { state: LibraryImportState; templates:
    TemplatePlanEntry[]; restrictionEntries: RestrictionPlanEntry[] }):
    string[]` – Problemzeilen für Nachträglich entschieden 2.
- Modify `library-import.ts`: `LibraryImportState.today: string` (Ortszeit-Tag,
  gesetzt in `loadLibraryImportState`) und `LibraryImportState.restrictions:
  Restriction[]`; `LibraryImportPlan.restrictions: RestrictionPlanEntry[]`;
  vier Zähler in `LibraryImportSummary`; `planHasChanges` zählt sie mit.
- `parseLibraryImportPayload`: vor Zod die Schlüssel der obersten Ebene gegen
  die bekannten prüfen; `_hinweis` erlaubt und **vor** dem Parsen entfernt
  (Hash unverändert); sonst Fehler `Unbekannter Block „…“ – ist die App
  aktuell?`.

- [ ] **Step 1: Failing tests** in `restriction-import.test.ts`, je
  Abbruchgrund aus Spec Abschnitt 8 ein `it`, mit dem Wortlaut der
  Fehlerzeile („Einschränkung 1, Pause 2: …“): fehlender `name`, doppelter
  Name, fehlendes `from` bei neu, ungültiges Datum, `until` vor `from`, neu
  ohne Ziel, unbekannte Übung, unbekannte Ersatzübung, unbekanntes Workout,
  unbekannter Schritt, `{ step }` ohne Treffer in allen Vorlagen, `step` an
  Workout ohne `steps`, `template`+`exercise` nicht im Workout, Ziel doppelt,
  Anpassung ohne Wert/Notiz/`holdProgression`, `targetWeight` an Schritt,
  `seconds` an Übung, `replacement` an Schritt, `replacement` ohne
  `workSetCount`, Konflikt gleicher Wert (Datei gegen Bestand), zwei
  Ersatzübungen, vertippter Feldname (`targetWieght`). Dazu:
  - Vorschau-Zustände: `new`, `update` mit `changes` (`until` alt → neu),
    `lifted` (`lifted: true`), `reactivated` (`lifted: false`), `unchanged`
    (gleiche Datei zweimal).
  - `pauses` genannt ersetzt die Liste ganz; weggelassen bleibt sie.
  - Übung und Workout aus derselben Datei werden aufgelöst.
  - `from: '2026-11-20'` bei `today: '2026-11-24'` → `note` enthält
    `bereits gespeicherte Einheiten ändern sich nicht`.
  - `findLostRestrictedSteps`: `steps`-Import ohne „Tiefe Hocke“ bei aktiver
    Pause `template`+`step` → Problem; gleiche Datei ändert die `pauses` dieser
    Einschränkung → kein Problem; `{ step }` ohne Vorlage → nie ein Problem;
    abgelaufene Einschränkung → kein Problem; gilt auch für eine
    Schrittanpassung mit `template`.
  In `library-import.test.ts`: `it('bricht bei einem unbekannten Block ab')`,
  `it('lässt _hinweis durch und ändert den Hash nicht')`, bestehender
  Golden-Hash-Test unverändert grün.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Implementieren; `planLibraryImport` ruft `planRestrictions`
  nach `planAssignments` und vor dem Problem-Abbruch, dann
  `findLostRestrictedSteps`. `describeImportCounts` nennt „Einschränkung(en)“.
  Vorschau in `LibraryImportSection.tsx`: je Eintrag Etikett `NEU` /
  `AKTUALISIERT` / `AUFGEHOBEN` / `WIEDER AKTIV` / `UNVERÄNDERT`, Zielzeilen,
  Zustand danach, `note`.
- [ ] **Step 4:** Tests grün; Gesamtprüfung.
- [ ] **Step 5:** Commit (nach Freigabe): `feat: Import-Block restrictions
  planen und prüfen`.

### Task 5: Import anwenden

**Files:**
- Modify: `src/db/library-import-actions.ts`
- Test: `src/db/library-import-actions.test.ts`

**Interfaces:**
- Consumes: `LibraryImportPlan.restrictions` aus Task 4.

- [ ] **Step 1: Failing tests:** Import legt eine Einschränkung an
  (`createdAt`/`updatedAt` gesetzt, Ziele auf Ids); zweiter Import derselben
  Datei → `planHasChanges` false; `lifted: true` setzt `liftedAt`,
  `lifted: false` entfernt den Schlüssel (`'liftedAt' in row === false`);
  ein Problem in einem anderen Block → nichts geschrieben (auch keine
  Einschränkung); Protokollzeile mit den vier Zählern; eine Datei, die nur
  aufhebt, heißt nicht „keine Änderungen“.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** `db.restrictions` in die Transaktion von
  `applyLibraryImport`; der Plan wird dort wie alle Blöcke neu berechnet;
  schreiben nach Art des Eintrags.
- [ ] **Step 4:** grün; Gesamtprüfung.
- [ ] **Step 5:** Commit (nach Freigabe): `feat: Einschränkungen importieren`.

### Task 6: Start einer Kraft-Einheit mit Einschränkungen und Ersatz

Spec Abschnitt 3 (Materialisieren, Ersatzübung).

**Files:**
- Modify: `src/domain/session.ts`, `src/db/session-actions.ts`
- Test: `src/domain/session.test.ts`, `src/db/actions.test.ts` (oder die
  Datei, die `startSessionFromTemplate` testet)

**Interfaces:**
- Consumes: `resolveRestrictionEffect`, `applyRestrictionEffect` (Task 2),
  `loadRestrictions` (Task 3).
- Produces: `MaterializeSessionInput.resolveRestrictions?: (exerciseId:
  string, templateId?: string) => RestrictionEffect` – pure Closure des
  Aufrufers über Einschränkungen und Starttag; `materializeSession` kennt kein
  Datum.

- [ ] **Step 1: Failing tests** in `session.test.ts`:
  - Wochenregel `targetWeight: 45`, Anpassung `40` → Zeile `targetWeight: 40`,
    `targetsBeforeAdjustment: { targetWeight: 45 }`.
  - Anpassung `workSetCount: 2` → genau 2 Arbeitssätze je Seite.
  - `holdProgression` → Wochenwert bleibt, `progressionHeld: true`.
  - Pause mit Ersatz (`workSetCount: 3`, `targetReps: 8`, ohne
    `restSeconds`): Ersatzzeile direkt hinter der pausierten, `addedInSession:
    false`, kein `sourceTemplateExerciseId`, `replacementFor` zeigt auf die
    pausierte Zeile, `restSeconds` der pausierten, 3 Arbeitssätze, Aufwärmsatz
    vorhanden; alle `orderIndex` dicht `1..n` und eindeutig (Review Focus 3).
  - Ersatz im Supersatz übernimmt `supersetGroupId`.
  - Ersatzübung, die selbst angepasst ist → Anpassung wirkt am Ersatz.
  - Ohne Ersatz bleiben die `orderIndex` wie bisher (bestehende Tests grün).
  In der Aktions-Testdatei: `startSessionFromTemplate` am `2026-12-01` mit
  aktiver Pause schreibt `pausedBy`; nach `liftRestriction` bleibt die
  laufende Session unverändert; `addSessionExercise` einer pausierten Übung
  bekommt `pausedBy`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** `materializeSession` erweitern; `startSessionFromTemplate`
  liest die Einschränkungen zusammen mit den Wochenregeln (vor der
  Transaktion, wie diese), lädt Ersatzübungen in `exercisesById` mit und baut
  die Closure für `toDateInputValue(now)`. `addSessionExercise` wendet
  dieselbe Auflösung auf die eingegebenen Ziele an.
- [ ] **Step 4:** grün; Gesamtprüfung.
- [ ] **Step 5:** Commit (nach Freigabe): `feat: Einschränkungen beim Start
  einfrieren, Ersatzübung anlegen`.

### Task 7: Durchgehen der Einheit, „Trotzdem“, Historien-Schalter

Spec Abschnitte 3 (Durchgehen, Schreib-API).

**Files:**
- Modify: `src/domain/session.ts`, `src/domain/session-summary.ts`,
  `src/domain/session-estimate.ts`, `src/db/session-actions.ts`
- Test: `src/domain/session.test.ts`, `src/domain/session-summary.test.ts`,
  `src/domain/session-estimate.test.ts`, Aktions-Testdatei

**Interfaces:**
- Consumes: `isInactiveSessionExercise` (Task 2).
- Produces: `overrideSessionExercisePause(sessionExerciseId: string):
  Promise<void>`, `restoreSessionExercisePause(sessionExerciseId: string):
  Promise<void>`, `setSessionExerciseExcludedFromProgress(sessionExerciseId:
  string, excluded: boolean): Promise<void>`.

- [ ] **Step 1: Failing tests:**
  - `findNextOpenExercise` überspringt eine pausierte Zeile; nach „trotzdem“
    ist sie wieder offen.
  - Supersatz A+B, B pausiert: Abhaken von A Satz 1 → `resolveNextFocus`
    liefert `undefined`, solange A offen ist, nie B (Review Focus 4); mit
    Ersatz C in der Gruppe → C.
  - `session-summary`: pausierte Zeile zählt als „nichts mehr offen“, nicht
    als übersprungen.
  - `estimateRemainingSessionSeconds`: pausierte Zeile trägt 0 bei, der
    Ersatz seine Sätze.
  - `restoreSessionExercisePause` nach abgehaktem Satz wirft mit deutscher
    Meldung; vorher entfernt es `pauseOverriddenAt`.
  - `setSessionExerciseExcludedFromProgress` an aktiver Session wirft; an
    abgeschlossener setzt/entfernt es `excludedFromProgressAt`, Sätze
    unverändert (`toEqual` vorher/nachher).
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Jede Fundstelle von `wasSkipped` außerhalb von Tests
  (`grep -rn wasSkipped src`) einordnen: Fokus, „offen“, Nenner und
  Zeitschätzung → `isInactiveSessionExercise`; Anzeige „übersprungen“ und
  Export-Spalte `uebersprungen` → bleibt `wasSkipped`. Die drei Aktionen
  schreiben; keine fasst das Workout an.
- [ ] **Step 4:** grün; Gesamtprüfung.
- [ ] **Step 5:** Commit (nach Freigabe): `feat: pausierte Übungen im Ablauf
  überspringen`.

### Task 8: Letzte Werte, Steigerungshinweis, Verlauf

Spec Abschnitt 6.

**Files:**
- Modify: `src/db/history-queries.ts`, `src/domain/progress.ts`,
  `src/components/ProgressChart.tsx`, `src/pages/SessionPage.tsx:778`,
  `src/components/SessionExerciseStage.tsx:1015`
- Test: `src/db/history-queries.test.ts`, `src/domain/progress.test.ts`

**Interfaces:**
- Consumes: `isRestrictedExecution`, `suppressesProgressionHint` (Task 2).
- Produces: `loadExerciseExecutions` liefert je Ausführung `restricted:
  boolean`; `ProgressPoint.restricted?: boolean`.

- [ ] **Step 1: Failing tests:** `loadLastValuesForExercises` nimmt bei
  jüngerer `angepasst`-, `trotzdem`- und `ausgenommen`-Ausführung die ältere;
  nimmt eine jüngere `ersatz`-, `gehalten`- und `hinweis`-Ausführung;
  `buildProgressSeries` behält eingeschränkte Punkte mit `restricted: true`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Filtern in `loadLastValuesForExercises`; Feld durchreichen;
  Diagramm zeigt eingeschränkte Punkte abgesetzt (hohl, neutrale Tinte),
  Legende „unter Einschränkung“; an beiden Hinweis-Aufrufen
  `!suppressesProgressionHint(row)` vorschalten.
- [ ] **Step 4:** grün; Architekturvertrag in **beiden** Kopien
  (`.claude/skills/gym-book-architect/SKILL.md`,
  `.trae/skills/gym-book-pwa-architect/SKILL.md`), Abschnitt „History and
  ‚last values‘“, um den Satz aus Spec Abschnitt 6 ergänzen, dazu die
  Ausnahme „Historien-Schalter an abgeschlossenen Einheiten“. Gesamtprüfung.
- [ ] **Step 5:** Commit (nach Freigabe): `feat: eingeschränkte Ausführungen
  zählen nicht als letzte Werte`.

### Task 9: Oberfläche Kraft-Einheit und Historie

Spec Abschnitt 4.

**Files:**
- Create: `src/components/RestrictionLabel.tsx`,
  `src/components/PauseSheet.tsx`
- Modify: `src/components/SessionBlockCard.tsx`,
  `src/components/SessionExerciseStage.tsx`, `src/components/SupersetBlock.tsx`,
  `src/pages/HistorySessionPage.tsx`, `src/domain/restriction.ts`
- Test: `src/domain/restriction.test.ts`, `e2e/restrictions.spec.ts` (neu)

**Interfaces:**
- Consumes: Aktionen aus Task 7.
- Produces in `restriction.ts`: `describeRestrictionLabel(row:
  WorkoutSessionExercise, originalName?: string): string | undefined` und
  `describeAdjustedTargets(row: WorkoutSessionExercise): string | undefined`.

- [ ] **Step 1: Failing tests** für die Texte:
  `describeRestrictionLabel` → `'Pausiert bis 14.12. · Beispiel A'`,
  `'Pausiert · Beispiel A, Beispiel C'` (offen, zwei Namen),
  `'Trotzdem · Beispiel A'`, `'Ersatz für Sprungkniebeuge · Beispiel A'`,
  `'Steigerung gehalten · Beispiel A'`, `'Nicht als Leistungsstand'`;
  `describeAdjustedTargets` → `'40 kg statt 45 · Beispiel A'`,
  `'42,5 kg statt 45 · Beispiel A'` (Komma über `formatNumber`), ohne
  echte Abweichung `undefined`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Liste: pausierte Zeile ausgegraut, eingeklappt, Etikett;
  Tipp öffnet `PauseSheet` (Namen, Grund, Zeitraum, „Trotzdem machen“ bzw.
  „Wieder pausieren“, solange kein Satz abgehakt). Angepasst: „statt“-Zeile
  und jede Notiz als eigene Zeile in Liste und Fokus-Sheet. Historie: dieselben
  Etiketten, Schalter „Zählt nicht als Leistungsstand“ je Übung (nicht an
  pausierten), ohne Rückfrage. Testanker `data-restriction-kind`.
- [ ] **Step 4:** E2E in `restrictions.spec.ts` (Daten über den echten
  Import auf `/sync`, wie `library-import.spec.ts`): pausierte Übung in der
  Liste, Fokus springt darüber, „Trotzdem“ und zurück; Ersatz direkt
  dahinter; angepasste Übung mit „statt“-Zeile; Historien-Schalter; alles bei
  320px ohne Überlauf.
- [ ] **Step 5:** `session-screen.md` und `ui-palette.md` ergänzen.
  Gesamtprüfung plus E2E. Commit (nach Freigabe): `feat: Einschränkungen in
  der Kraft-Einheit und der Historie`.

### Task 10: Geführte Einheiten

Spec Abschnitt 5.

**Files:**
- Modify: `src/db/guided-session-actions.ts`,
  `src/db/announcement-actions.ts`, `src/domain/restriction.ts`,
  `src/pages/GuidedStartPage.tsx`, `src/components/GuidedStepsCard.tsx`,
  `src/pages/GuidedRunPage.tsx`, `src/components/GuidedStage.tsx`
- Test: `src/db/guided-session-actions.test.ts`,
  `src/db/announcement-actions.test.ts`, `src/domain/restriction.test.ts`,
  `e2e/restrictions.spec.ts`

**Interfaces:**
- Consumes: `resolveGuidedSteps` (Task 2), `loadRestrictions` (Task 3).
- Produces in `restriction.ts`: `withRestrictionProtocol(protocol:
  GuidedProtocolEntry[], run: GuidedRun): GuidedProtocolEntry[]` – rechnet
  `stepIndex` der abgespielten Zeilen auf die Position in der **Vorlage** um,
  fügt je pausiertem Schritt (je Seite bei `bothSides`) eine Zeile `status:
  'paused'`, `actualSeconds: 0` an ihrer Position ein und setzt
  `restrictedBy`. `guided-run.ts` bleibt unberührt.

- [ ] **Step 1: Failing tests:**
  - `startGuidedSession` am `2026-12-01`: pausierter Schritt fehlt in
    `guided.steps`, steht in `pausedSteps`; angepasster hat neue Sekunden,
    `adjustedSteps` mit `secondsBefore`; `{ step }` trifft zwei Vorlagen.
  - alle Schritte pausiert → wirft „Heute sind alle Schritte pausiert.“
  - `withRestrictionProtocol`: Vorlage A, B (pausiert, beidseitig), C →
    Protokoll A(0), B links(1, paused), B rechts(1, paused), C(2); `restrictedBy`
    an B und an angepassten Zeilen.
  - Ansagen (Review Focus 2): `getAnnouncementAvailability(templateId)` am
    Tag einer Schrittanpassung verlangt den Text mit den angepassten Sekunden
    (`'Als Nächstes: Taubenpose, 30 Sekunden'`) zusätzlich zu den Texten der
    Vorlage; ohne Einschränkung unverändert.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Start schreibt Snapshot; `completeGuidedSession` und
  `abortGuidedSession` legen das Protokoll durch `withRestrictionProtocol`.
  `loadGuidedTexts` nimmt zu den Vorlagen-Schritten die heute wirksamen
  Schritte (`resolveGuidedSteps`) hinzu, damit „Ansagen erzeugen“ auf dem
  Startbildschirm sie mit erzeugt; `startGuidedSession` prüft die
  Verfügbarkeit gegen die wirksamen Schritte. Startbildschirm: pausierte
  Schritte ausgegraut mit Etikett, angepasste mit „30 s statt 45 · Beispiel
  A“ und Notizzeilen, Dauer aus den wirksamen Schritten, alle pausiert →
  Text statt Knopf. Bühne: Notiz des laufenden Schritts als Textzeile unter dem
  Namen (`data-guided-note`), keine Ansage.
- [ ] **Step 4:** E2E: Start mit pausiertem und angepasstem Schritt, kürzere
  Dauer, Notiz auf der Bühne, Protokoll mit `pausiert`.
- [ ] **Step 5:** `guided-templates.md` ergänzen. Gesamtprüfung plus E2E.
  Commit (nach Freigabe): `feat: Einschränkungen in geführten Einheiten`.

### Task 11: Plan-Seite, Workout-Detail, Jetzt-Sheet

Spec Abschnitt 7, „Nachträglich entschieden“ 3.

**Files:**
- Create: `src/components/RestrictionsCard.tsx`,
  `src/components/RestrictionSheet.tsx`
- Modify: `src/domain/restriction.ts`, `src/pages/PlanPage.tsx`,
  `src/pages/TemplateDetailPage.tsx`, `src/components/NowSheet.tsx`,
  `src/domain/today-units.ts`
- Test: `src/domain/restriction.test.ts`, `src/domain/today-units.test.ts`,
  `e2e/restrictions.spec.ts`

**Interfaces:**
- Produces in `restriction.ts`:
  - `describeRestrictionTargets(restriction: Restriction, lookup: {
    exercises: Exercise[]; templates: WorkoutTemplate[]; templateExercises:
    WorkoutTemplateExercise[] }): { label: string; status: 'ok' | 'gibt es
    nicht mehr' | 'trifft derzeit nichts' }[]`
  - `countRestrictionEffects(input: { restrictions: Restriction[]; day:
    string; templateId: string; targetsByTemplateExerciseId: Record<string, {
    exerciseId: string; targets: AdjustableTargets }> }): { paused: number;
    adjusted: number }` – `adjusted` nur bei echter Abweichung.

- [ ] **Step 1: Failing tests:** Zielzeilen für alle vier Formen; gelöschtes
  Workout → „gibt es nicht mehr“; `{ step }` ohne Vorlage mit dem Namen →
  „trifft derzeit nichts“; `countRestrictionEffects` zählt eine Anpassung
  gleich Wochenwert nicht mit; `buildNowSections` reicht die Zeile
  „1 Übung pausiert · 1 angepasst“ durch.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Karte „Einschränkungen“ nur bei aktiven oder angekündigten;
  je Zeile Name, „bis 14.12.“ / „ab 01.12.“ / „ohne Enddatum“, Zahl der
  lebenden Ziele; Sheet mit Grund, Zeitraum, Zielen, „Aufheben“ hinter
  `ConfirmDialog` → `liftRestriction`. Workout-Detail: Etikett je betroffene
  Übung bzw. Schritt für heute. Jetzt-Sheet: Zeile an der Workout-Karte für
  den Tag des Termins (bei Nachholen/Vorziehen heute).
- [ ] **Step 4:** E2E: Karte, Sheet, Aufheben, Karte verschwindet.
- [ ] **Step 5:** `plan-timeline.md` ergänzen. Gesamtprüfung plus E2E. Commit
  (nach Freigabe): `feat: Einschränkungen auf Plan-Seite, Workout und
  Jetzt-Sheet`.

### Task 12: Analyse-Export und Bestand

Spec Abschnitt 9.

**Files:**
- Modify: `src/domain/analysis-export.ts`, `src/lib/export.ts`
  (`loadAnalysisFiles`), `src/domain/library-inventory.ts`
- Test: `src/domain/analysis-export.test.ts`,
  `src/domain/library-inventory.test.ts`

**Interfaces:**
- Consumes: `sessionRestrictionKind`, `describeRestrictionState`,
  `describeRestrictionTargets`.
- Produces: `AnalysisExportInput.restrictions: Restriction[]`;
  `LibraryInventoryInput.restrictions` und `today`; `LibraryInventory.restrictions`
  in Importform.

- [ ] **Step 1: Failing tests:** `sessions.csv` endet auf
  `einschraenkung;einschraenkung_art;ersatz_fuer` (Trennzeichen wie die
  Datei); je eine Zeile für alle sieben Arten; `ersatz_fuer` =
  `Sprungkniebeuge` an der Ersatzzeile; eine pausierte Übung macht die
  Einheit nicht unvollständig (`MINIMUM_COMPLETION_RATIO`); `protokoll.csv`
  endet auf `einschraenkung`, Status `pausiert`; `meta.json` →
  `einschraenkungen` mit `name`, `grund`, `von`, `bis`, `aufgehoben_am`,
  `zustand`, `ziele` und dem `hinweis`; Einfügetext beschreibt die neuen
  Spalten. Bestand: nur nicht aufgehobene, nicht abgelaufene; tote Ziele
  fehlen; Rückimport des Bestands (mit Ersatz, `{ step }`,
  Schrittanpassung) → `planHasChanges` false.
- [ ] **Step 2:** → FAIL. (`analysis-export.ts` enthält ein NUL-Zeichen:
  Suchen mit `grep -a`.)
- [ ] **Step 3:** Implementieren; `loadAnalysisFiles` liest
  `db.restrictions`.
- [ ] **Step 4:** grün; `import-export.md` ergänzen. Gesamtprüfung.
- [ ] **Step 5:** Commit (nach Freigabe): `feat: Einschränkungen im
  Analyse-Export und im Bestand`.

### Task 13: Formatbeschreibung im Repo

Spec Abschnitt 12.

**Files:**
- Create: `docs/claude-projekt/import-format.md` (aus
  `~/Documents/gym-book-daten/claude-projekt/import-format.md`),
  `src/domain/import-format.test.ts`
- Modify: `docs/architecture/import-export.md`, `CLAUDE.md` (Tabelle „Where
  the details live“ plus neue Zeile für `docs/architecture/restrictions.md`)
- Create: `docs/architecture/restrictions.md`

- [ ] **Step 1:** Die Datei kopieren und **vollständig lesen**: nichts
  Persönliches (Gesundheitsangaben, Körperstellen, Termine, echte Workoutnamen von
  Andreas). Funde Andreas zeigen, nicht selbst entscheiden.
- [ ] **Step 2: Failing test** `import-format.test.ts`:
  `it('jeder json-Block der Formatbeschreibung ist eine gültige Importdatei')`
  – Datei lesen, jeden ```json-Block mit `parseLibraryImportPayload` parsen,
  erwartet kein Fehler; `it('enthält mindestens einen Block mit
  restrictions')`.
- [ ] **Step 3:** Abschnitt 1 auf `/sync` („Abgleich“) korrigieren; neuer
  Abschnitt Einschränkungen (Felder, Zielformen, Ersatz, Schrittanpassung,
  `holdProgression`), Abbruchgründe in Abschnitt 10 (auch unbekannter Block),
  vollständiges Beispiel in Abschnitt 11. Ausschnitte als ```text.
- [ ] **Step 4:** Test grün; `restrictions.md` aus der Spec verdichten.
  Gesamtprüfung.
- [ ] **Step 5:** Commit (nach Freigabe): `docs: Formatbeschreibung für den
  Trainings-Assistenten ins Repo`. Danach Andreas sagen: neue
  `import-format.md` ins claude.ai-Projekt (GitHub-Anbindung oder Upload),
  `projekt-anweisungen.md` außerhalb ergänzen, Austauschdatei unter
  `~/Documents/gym-book-daten/austausch/` anlegen („Funktion ist da“).

### Task 14: Gesamtprüfung

- [ ] **Step 1:** `npm run check && npm run check:strict && npm run lint &&
  npm test && npm run build` – alles grün, Ausgabe festhalten.
- [ ] **Step 2:** `lsof -ti :5173 | xargs -r kill`, dann `caffeinate -i npm
  run test:e2e` im Hintergrund; volle Suite grün (heute 400 Tests plus die
  neuen).
- [ ] **Step 3:** Code-Review der ganzen Strecke gegen Spec und
  Architekturvertrag (Checkliste im Vertrag, Fragen 1–8).
- [ ] **Step 4:** Andreas prüft auf dem iPhone: Import einer erfundenen
  Einschränkung, Kraft-Einheit, geführte Einheit, Aufheben.
