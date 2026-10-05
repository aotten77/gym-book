# Datierter Trainingsplan

Stand: 05.10.2026 · Status: Entwurf, abgestimmt im Gespräch

## Ziel

Einheiten werden auf konkrete Tage geplant – Kraft- und Mobility-Workouts
ebenso wie Läufe –, statt dass ein Workout an festen Wochentagen hängt, die
sich endlos wiederholen. Pläne entstehen in der App und im claude.ai-
Planungsprojekt, das sie per Bibliotheks-Import aufs Gerät bringt. Was
tatsächlich trainiert wurde, gehört erkennbar zu seinem Termin, damit Plan und
Durchführung nebeneinander gelesen werden können – in der App und im
Analyse-Export.

**Erfolg heißt:** Ein Termin lässt sich in der App oder per Import anlegen,
er erscheint dort, wo man nach „heute“ schaut, eine Session oder ein Lauf
wird ihm zugeordnet, und nichts von dem, was heute in `scheduledWeekdays`
steckt, geht verloren.

## Einordnung: Teil 2 von 3

Teil 1 (Läufe erfassen) ist umgesetzt, siehe
[2026-10-04-laeufe-erfassen-design.md](2026-10-04-laeufe-erfassen-design.md).
Teil 3 (Kalender mit Icons, zwei Zuständen, Antippen zum Ansehen/Anlegen,
Wochenzahlen unter dem Raster) folgt mit eigener Spec.

**Grenze zu Teil 3:** Weil `scheduledWeekdays` hier wegfällt, stellt Teil 2
das vorhandene Raster *minimal* auf Termine um – Datenquelle getauscht, Läufe
zählen als erledigt, Aussehen und Zustände (einschließlich `verpasst`) bleiben.
Gestaltung und das Zwei-Zustände-Modell sind Teil 3.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Planungsmodell | Einzeltermine mit Datum, keine Wochentags-Vorlagen |
| Tabellen | eine Tabelle `planEntries` für Workouts und Läufe |
| Pro Tag | mehrere Termine, mit Reihenfolge; derselbe Termin (Schlüssel) nur einmal |
| Laufvorgabe | Titel (Pflicht), km, Dauer, HM, Ø Puls, Pace (optional), Markdown-Anleitung – reine Information, kein Timer |
| Serien | „Serie anlegen“ erzeugt Einzeltermine als Kopie, keine laufende Regel |
| Verknüpfung | automatisch beim Schreiben: heute zuerst, sonst frühester offener Termin der laufenden Kalenderwoche |
| Abbruch | eine abgebrochene Session gibt ihren Termin wieder frei |
| Anlegen in der App | Programm-Tab, Terminliste der gewählten Woche unter dem Raster |
| Home | NowCard = erster offener Termin von heute; sonst „Nächster Termin“ ohne Lime; ganz ohne Termine „Am längsten her“ |
| Import | Block `planEntries`; mit `planRange` ersetzt die Datei den Zeitraum, ohne wird nur ergänzt |
| Umwandlung | Datenkorrektur in den Einstellungen; Termine ab heute bis Programmende, sonst gewählte Wochenzahl (Vorgabe 4) |
| Analyse-Export | siebte Datei `plan.csv`, Spalte `geplant_am` in `sessions.csv` und `laeufe.csv` |
| Progression | unverändert über `startedOn`; `materializeSession` bleibt unberührt |

Verworfen:

- **Wochentags-Vorlagen beibehalten und Termine nur ergänzen** – zwei
  Planquellen, die sich widersprechen können, sind genau die Fehlerklasse,
  die `weekOverride` schon vorgeführt hat.
- **Zwei Tabellen (geplante Workouts, geplante Läufe)** – jeder Leser
  (Liste, Kalender, Home, Export) müsste zwei Quellen zusammenführen und
  sortieren; „zwei Einheiten an einem Tag“ wäre eine Join-Frage.
- **Erledigt-Status am Termin speichern** – er müsste bei Abbruch, Löschen
  eines Laufs und Wiederherstellen eines Backups mitgezogen werden. Abgeleitet
  aus den Verweisen kann er nicht lügen.
- **Termin-Verweis auf eine Programmwoche** – die Woche folgt aus dem Datum;
  ein zweiter Weg dorthin wäre ein zweiter Schreiber.
- **Lauftyp-Feld für den späteren Pace-Filter** – jetzt nicht nötig, später
  additiv nachrüstbar. Bis dahin trägt der Titel.

## 1. Datenmodell

```ts
type PlanEntryKind = 'workout' | 'run';

interface PlanEntry {
  id: string;
  /** Lokaler Kalendertag, `YYYY-MM-DD`, gelesen über `parseLocalDate`. */
  date: string;
  /** 1, 2, … innerhalb eines Tages, dicht nummeriert. */
  orderInDay: number;
  kind: PlanEntryKind;
  /** Nur bei `workout`. */
  templateId?: string;
  /** Nur bei `run`, dort Pflicht: „Intervalle 6×400“. */
  title?: string;
  /** Nur bei `run`, alle optional. */
  targetDistanceKm?: number;        // > 0
  targetDurationSeconds?: number;   // ganze Zahl > 0
  targetElevationGainM?: number;    // ganze Zahl ≥ 0
  targetAverageHeartRate?: number;  // ganze Zahl 30–250
  targetPaceSecondsPerKm?: number;  // ganze Zahl > 0
  /** Nur bei `run`: Markdown-Teilmenge aus `markdown-lite.ts`. */
  instructions?: string;
  /** Beide Arten: kurze Notiz („Bahn“, „lockerer“). */
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
```

Neue Felder an bestehenden Datensätzen, alle additiv:

```ts
interface WorkoutSession {
  // …
  planEntryId?: string;
  /** Das geplante Datum des Termins beim Start. */
  planDateSnapshot?: string;
}

interface RunLog {
  // …
  planEntryId?: string;
  /** Was geplant war – Titel, Datum, Vorgaben, Anleitung. */
  runPlanSnapshot?: {
    title: string;
    date: string;
    targetDistanceKm?: number;
    targetDurationSeconds?: number;
    targetElevationGainM?: number;
    targetAverageHeartRate?: number;
    targetPaceSecondsPerKm?: number;
    instructions?: string;
  };
}
```

- **Persistenz:** Dexie `version(6)`: neue Tabelle
  `planEntries: 'id, date, templateId'`; `workoutSessions` und `runLogs`
  bekommen zusätzlich den Index `planEntryId`. Kein `upgrade()` – umzuformen
  ist nichts.
- **„Offen“ ist abgeleitet.** Ein Termin ist *belegt*, sobald eine Session mit
  `status` `active` oder `completed` oder ein Lauf auf ihn zeigt. Eine
  abgebrochene Session belegt nichts, ohne dass dafür etwas geschrieben wird.
  *Erledigt* heißt: belegt durch eine abgeschlossene Session oder einen Lauf.
- **Ein belegter Termin ist Geschichte.** Er lässt sich weder ändern noch
  löschen. Wird ein Workout gelöscht, gehen seine *offenen* Termine mit; belegte
  bleiben stehen, ihr Name kommt dann aus dem Snapshot der Session
  (`templateNameSnapshot`).
- **Pace** einer Vorgabe ist gespeichert, weil sie eine *Vorgabe* ist, nicht
  aus km und Dauer abgeleitet – „8 km in 5:30“ und „45 min locker“ sind beide
  gültige Pläne. Die Pace eines *Laufs* bleibt wie in Teil 1 berechnet.
- **`WorkoutTemplate.scheduledWeekdays`** bleibt im Typ als *veraltet, nur
  gelesen*: einzig die Umwandlung (Abschnitt 4) liest es. Kein anderer Code
  schreibt oder wertet es mehr aus.

## 2. Pure Regeln: `src/domain/plan.ts`

- **`planEntryKey(entry)`** – die Identität: `Datum + templateId` bzw.
  `Datum + normalisierter Titel` (wie `normalizeImportKey`). Pro Tag gibt es
  jeden Schlüssel nur einmal; zwei *verschiedene* Termine am selben Tag sind
  erlaubt.
- **`findMatchingPlanEntry(entries, { kind, templateId?, today, takenIds })`**
  – die eine Zuordnungsregel für Sessions und Läufe: der offene passende
  Termin von heute gewinnt; sonst der früheste offene passende Termin der
  laufenden Kalenderwoche (Montag, lokale Zeit), ausdrücklich auch ein
  künftiger – wer vorzieht, trainiert trotzdem *diesen* Termin. Passt nichts,
  `null`. Bei mehreren Treffern am selben Tag entscheidet `orderInDay`.
- **`expandSeries({ weekdays, startDate, weeks })`** – Einzeldaten einer
  Serie, ab `startDate` einschließlich. Tage werden über `setDate`
  weitergezählt, nie über Millisekunden (eine Woche über die Zeitumstellung
  hat 167 oder 169 Stunden).
- **`describeRunTarget(entry)`** – eine Zeile wie `8 km · 5:30 /km · Ø 145`,
  Zahlen über `formatNumber`, Pace über `formatPace`. Fehlt alles, leerer
  String.
- **`planEntriesForDay` / `nextOpenPlanEntry`** – Sortierung nach Datum, dann
  `orderInDay`; Grundlage für Liste, Home und Kalender.
- Formularzustand und Umwandlung Feld ↔ Datensatz liegen getrennt in
  `src/domain/plan-entry-form.ts`, wie `run-form.ts` neben `run.ts`.

Datumsprüfungen laufen per Rückrechnung (`toDateInputValue(parseLocalDate(x))
=== x`), weil `parseLocalDate` ungültige Daten überrollt (`2026-13-01` wird
zum 01.01.2027).

## 3. Schreib-API

### `src/db/plan-actions.ts`

- `createPlanEntry(input)` – hängt den Termin ans Ende seines Tages.
- `updatePlanEntry(id, input)` – `null` leert ein Feld, ein fehlender
  Schlüssel ändert nichts (`Table.update` würde `undefined` als *Feld löschen*
  lesen). Ein Datumswechsel hängt ans Ende des neuen Tages und nummeriert den
  alten dicht nach.
- `deletePlanEntry(id)` – nummeriert den Tag dicht nach.
- `movePlanEntryInDay(id, direction)` – ↑/↓ innerhalb eines Tages, über
  `moveItem`.
- `createPlanSeries({ kind, templateId | runTarget, weekdays, startDate,
  weeks })` – legt Einzeltermine an und überspringt Tage, an denen derselbe
  Schlüssel schon steht. Rückgabe `{ created, skipped }` für die Meldung
  „6 angelegt, 2 gab es schon“.

Alle Schreiber lehnen ab, mit deutscher Meldung:

- einen belegten Termin ändern oder löschen,
- einen doppelten Schlüssel am selben Tag,
- `workout` ohne existierendes Workout, `run` ohne Titel,
- ein ungültiges Datum oder Werte außerhalb der Grenzen aus Abschnitt 1.

### Anbindung an Bestehendes

- **`startSessionFromTemplate(templateId, { planEntryId? })`** – die Suche
  läuft **in derselben Transaktion** wie die Prüfung auf eine aktive Session;
  sonst belegen zwei schnelle Starts einen Termin doppelt. Eine übergebene id
  gilt, wenn sie offen ist und zum Workout passt (sonst wird ohne Verweis
  gestartet, nicht abgebrochen); ohne id greift `findMatchingPlanEntry`.
  Geschrieben werden `planEntryId` und `planDateSnapshot`. Die Programmwoche
  kommt weiter aus `resolveWeekControl`, `materializeSession` bleibt
  unverändert.
- **`createRunLog` / `updateRunLog`** nehmen `planEntryId` an. Die id muss ein
  `run`-Termin sein, der offen ist oder schon mit genau diesem Lauf verknüpft.
  Der Snapshot wird mitgeschrieben; `planEntryId: null` löst Verweis und
  Snapshot. `deleteRunLog` gibt den Termin damit von selbst frei.
- **`deleteTemplate`** löscht die *offenen* Termine des Workouts in derselben
  Transaktion.
- **`restoreDatabaseSnapshot`** und der lokale Reset leeren `planEntries` mit.

## 4. Umwandlung von `scheduledWeekdays`

`applyWeekdaysToPlanMigration(weeks?)` in `src/db/data-fix-actions.ts`,
hinter einem `ConfirmDialog` in den Einstellungen – kein Dexie-`upgrade()`,
weil es Trainingsdaten umdeutet und das eine Rückfrage braucht.

- **Zeitraum:** ab heute (einschließlich). Hat das aktive Programm ein
  `startedOn` und ist es nicht abgelaufen, bis zum letzten Tag seiner letzten
  geplanten Woche (`programWeekStart` + 6 Tage). Sonst die im Dialog gewählte
  Anzahl Wochen, Vorgabe 4, ab dem Montag der laufenden Kalenderwoche
  gerechnet, aber nie vor heute.
- **Nichts für die Vergangenheit** – ein nachträglich erfundener Plan wäre
  eine Behauptung über Training, das niemand geplant hat.
- **Inhalt:** je Workout und angekreuztem Wochentag ein `workout`-Termin;
  Reihenfolge am Tag nach Workout-Name. Bestehende Termine mit gleichem
  Schlüssel werden übersprungen.
- **Danach** wird `scheduledWeekdays` von allen Workouts entfernt, in derselben
  Transaktion.
- **„Schon erledigt“ wird aus den Daten abgeleitet**: kein Workout trägt das
  Feld. Bringt ein altes Backup es zurück, bietet sich die Korrektur wieder an.
- Der Dialog nennt Anzahl der Termine und Zeitraum, bevor geschrieben wird.

## 5. Oberfläche

### Programm-Tab (`ProgramsPage`)

- **Raster:** `buildTrainingCalendar` liest Termine statt Wochentage. Ein Tag
  ist *geplant*, wenn ein Termin darauf liegt; *erledigt* kommt weiter aus dem
  Verlauf und umfasst jetzt **auch Läufe**. Zustände und Aussehen bleiben;
  `templatesOnWeekday` und `templatesWithoutSchedule` entfallen.
- **Ohne `Program.startedOn`** hat das Raster weiter keine Daten. Die
  Terminliste zeigt dann die Kalenderwoche ab heute, mit Pfeilen zum Blättern
  (ephemerer `useState`, wie die Wochenwahl im Raster) – Termine tragen ihr
  eigenes Datum und brauchen das Programm dafür nicht.
- **Terminliste der gewählten Woche** unter dem Raster, nach Tagen gruppiert;
  sie ersetzt den Plan-Block und „Ohne festen Tag“. Jede Zeile: Art-Marke
  (lucide `Dumbbell` für Workouts, `RunIcon` für Läufe – die endgültige
  Icon-Gestaltung ist Teil 3), Name bzw. Titel, darunter Laufvorgabe
  (`describeRunTarget`) oder Notiz, rechts der Zustand: offen ohne Farbe,
  *erledigt* in Forest (`DoneRow`). ↑/↓ nur innerhalb eines Tages, nur bei
  mehr als einem Termin.
- **Darunter zwei Knöpfe:** „Termin hinzufügen“ (Datum vorbelegt: heute, wenn
  in der gewählten Woche, sonst deren Montag) und „Serie anlegen“.
- Lime bleibt bei der `NowCard`; die Liste arbeitet in Tinte und Forest.

### Sheets (mit `fieldNavigation`)

- **`PlanEntrySheet`** – Anlegen, Ändern, Löschen. Art (Workout / Lauf),
  dann Workout als `SelectField` oder Lauf mit Titel, fünf Vorgabefeldern und
  Anleitung als `TextArea` mit Markdown-Hinweis; dazu Datum und Notiz. Ein
  belegter Termin erscheint nur lesbar („Erledigt am 6.10.“) mit Link auf
  seine Session bzw. seinen Lauf.
- **`PlanSeriesSheet`** – Workout oder Lauf (mit denselben Vorgabefeldern),
  Wochentage (die Chips aus dem bisherigen `WeekdayPicker`, dorthin
  umgezogen), Startdatum, Anzahl Wochen; Meldung `{ created, skipped }`.

### Home

- **Offene Termine heute:** die NowCard zeigt den ersten. Workout:
  „Heute · Einheit B“ startet die Session mit dieser `planEntryId`. Lauf:
  „Heute · Intervalle 6×400“ öffnet das Lauf-Sheet mit vorausgewähltem Termin.
  Weitere offene Termine von heute als schlichte Zeilen darunter.
- **Keiner heute, aber künftige:** Karte „Nächster Termin · Do · Einheit A“
  – **ohne Lime**, sie ist eine Vorschau, nicht „jetzt“.
- **Gar keine Termine:** weiter „Am längsten her“ (`pickNextTemplate`).
- Die Karte „Heute · …“ im Programm-Tab nutzt dieselbe Ableitung.

### Lauf-Sheet (`RunLogSheet`)

- Neues `SelectField` „Geplanter Lauf“: offene `run`-Termine der laufenden
  Woche plus der bereits verknüpfte, Option „keiner“; vorbelegt über
  `findMatchingPlanEntry` mit dem Datum des Laufs.
- Ist ein Termin gewählt, steht seine Vorgabe in einer Zeile darüber und die
  Anleitung eingeklappt dahinter – dasselbe Muster wie `ExerciseGuideBlock`:
  eine Zeile, der Rest per Tipp.
- **Lauf-Detailseite:** Vorgabe gegen Ist, wenn ein `runPlanSnapshot` da ist.

### Workout-Detail und Einstellungen

- `TemplateDetailPage`: der `WeekdayPicker` entfällt, an seiner Stelle ein
  Link „Termine im Programm-Tab“.
- Einstellungen: „Wochentage in Termine umwandeln“ bei den anderen
  Datenkorrekturen.

## 6. Bibliotheks-Import

Neuer optionaler Block; `LIBRARY_IMPORT_SCHEMA_VERSION` bleibt `1`, weil
additiv.

```json
{
  "schemaVersion": 1,
  "planRange": { "from": "2026-10-05", "to": "2026-11-01" },
  "planEntries": [
    { "date": "2026-10-05", "workout": "Einheit A" },
    {
      "date": "2026-10-06",
      "run": {
        "title": "Intervalle 6×400",
        "targetDistanceKm": 7,
        "targetPaceSecondsPerKm": 300,
        "instructions": "- 2 km einlaufen\n- 6×400 m, 90 s Trabpause"
      },
      "notes": "Bahn"
    }
  ]
}
```

- Ein Eintrag trägt **genau eines** von `workout` (Name) oder `run`; die Art
  folgt daraus. Die Reihenfolge am Tag ist die Reihenfolge in der Datei.
- Identität über `planEntryKey`; dieselbe Datei zweimal ergibt *unverändert*.
  Wie überall im Import: ein fehlender Schlüssel ändert nichts, `null` leert.
- **Mit `planRange`** ist die Datei der vollständige Plan dieses Zeitraums
  (einschließlich beider Grenzen): offene Termine darin, die in der Datei
  fehlen, werden entfernt (`ENTFERNT`, rot). **Ohne `planRange`** wird nur
  ergänzt und aktualisiert.
- **Belegte Termine** werden weder geändert noch entfernt; die Vorschau zeigt
  sie als „erledigt, bleibt“.
- **Abbruch statt Warnung**, mit benannter Zeile: unbekanntes Workout, das auch
  die Datei nicht anlegt; ungültiges Datum; doppelter Schlüssel; Termin
  außerhalb von `planRange`; `planRange.from` nach `to`; ein Eintrag mit
  beiden oder keinem von `workout`/`run`; `planRange` ohne `planEntries`.
- Vorschau NEU / AKTUALISIERT / UNVERÄNDERT / ENTFERNT; bei Entfernungen lädt
  die App vorher ein Backup herunter, wie bei `replaceAssignments`, und ein
  gescheitertes Backup bricht ab.
- `applyLibraryImport` plant innerhalb seiner Transaktion neu, wie bisher.
  `LibraryImportLog` zählt die Termine mit.

## 7. Backup und Analyse-Export

- **Backup (`export.ts`):** `planEntries` als
  `z.array(...).optional().default([])`, die neuen Felder an Session und Lauf
  als `.optional()`; **kein** `SNAPSHOT_SCHEMA_VERSION`-Sprung.
  `templateId` und `planEntryId` werden **nicht** auf Integrität geprüft – ein
  belegter Termin darf ein gelöschtes Workout überleben, und das eigene Backup
  darf daran nicht scheitern.
- **Analyse-Export:**
  - **`plan.csv`** als siebte Datei: alle Termine, auch künftige (der
    `zeitraum` in `meta.json` leitet sich aus Sessions ab und würde genau die
    Termine abschneiden, die das Planungsprojekt braucht), Spalten
    `datum, reihenfolge, art, name, soll_km, soll_dauer_min, soll_hm,
    soll_puls, soll_pace, notiz, status`. `status` ist `erledigt`, `offen`
    (heute oder künftig) oder `verstrichen` (vergangen und nicht erledigt).
    `art` ist `kraft` / `mobility` / `lauf`.
  - `sessions.csv` bekommt **hinten** `geplant_am`, `laeufe.csv` hinten
    `geplant_am` und `plan_titel` – hinten, damit Leser nach Position weiter
    funktionieren.
  - `meta.json`: `plan.anzahl` und ein Hinweis, dass `verstrichen` nicht
    „ausgelassen“ heißt, sondern nur „nicht verknüpft“.
  - Die Paste-Variante übernimmt die Datei automatisch über
    `loadAnalysisFiles`.

## 8. Tests

**Domain (vitest):** `planEntryKey`; `findMatchingPlanEntry` (heute vor
Woche, vorgezogener Termin, belegte ausgeschlossen, Reihenfolge am Tag,
Wochengrenze Sonntag/Montag); `expandSeries` über die Zeitumstellung;
`describeRunTarget`; Kalender-Ableitung mit Terminen und Läufen;
Import-Planung (Ersetzen im Zeitraum, belegte bleiben, alle Abbruchgründe,
Idempotenz); `plan.csv` und die neuen Spalten.

**DB (vitest + fake-indexeddb):** Sperren für belegte Termine; dichte
Nummerierung nach Löschen und Datumswechsel; Serie mit übersprungenen
Duplikaten; Verknüpfung beim Start inklusive zweier paralleler Starts;
Abbruch gibt frei; Lauf verknüpfen, wechseln, lösen, löschen;
`deleteTemplate` löscht nur offene Termine; Umwandlung (Zeitraum mit und ohne
`startedOn`, „schon erledigt“); Backup-Roundtrip mit und ohne `planEntries`.

**E2E (WebKit, zwei iPhone-Breiten):** Termin und Serie anlegen; Home-Karte
startet ein Workout und der Termin steht danach als erledigt; Lauf-Sheet
wählt den Termin vor und zeigt die Vorgabe; Umwandlung in den Einstellungen;
Terminliste bei 320 px ohne Überlauf. Testanker: `data-plan-entry` (id),
`data-plan-entry-state`, `data-plan-day`.

## 9. Doku

- CLAUDE.md: neuer Abschnitt zum datierten Plan; der Kalender-Abschnitt wird
  von `scheduledWeekdays` auf Termine umgeschrieben; der Analyse-Export nennt
  sieben Dateien und hat jetzt Plandaten.
- Architekturvertrag `.claude/skills/gym-book-architect/SKILL.md` und sein
  Spiegel in `.trae/` gemeinsam.

## Nicht in Teil 2

- Icons, zwei Zustände, Wegfall von `verpasst`, Antippen im Raster,
  Wochenzahlen unter dem Raster – Teil 3.
- Lauftyp und Pace-Filter in der Grafik.
- Zerlegung einer Laufanleitung in Wiederholungen oder ein Lauf-Timer.
- Wiederkehrende Regeln jeder Art – eine Serie ist eine Kopie.
