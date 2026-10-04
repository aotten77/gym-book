# Workouts per Import ersetzen

Stand: 04.10.2026 · Status: Entwurf, abgestimmt im Gespräch

## Ziel

Die Workouts werden im Planungsprojekt auf claude.ai geplant und über den
Bibliotheks-Import in die App gebracht. Heute kann der Import nur
**hinzufügen**: eine Übung, die aus einem Workout heraus soll, muss von Hand
gelöscht werden, bestehende Zuordnungen behalten ihre Position, und
Supersätze lassen sich gar nicht ausdrücken. Künftig soll eine Importdatei
ein Workout **vollständig** beschreiben können – welche Übungen, in welcher
Reihenfolge, in welchen Supersätzen – und die App bringt es auf genau diesen
Stand.

## Ausgangslage

- [library-import.ts](../../../src/domain/library-import.ts) trägt drei Regeln,
  die dritte lautet „Gelöscht wird nie“.
- Eine bestehende Zuordnung behält ihre Position; der `orderIndex` der Datei
  sagt nur, wo etwas *Neues* hinsoll. Die Datei vom 28.08. musste das in einem
  eigenen `_reihenfolge`-Hinweis erklären.
- `supersetGroupId` ist im Importschema nicht vorhanden.
- `targetRepsMax` ist im Importschema nicht vorhanden – „3 × 8–10“ lässt sich
  nicht aus claude.ai planen.
- `deleteTemplateExercise` löscht die Progressionsregeln der Zuordnung mit.
- Sessions verweisen nur über `sourceTemplateExerciseId` auf eine Zuordnung.
  Das Feld liest außer dem Backup-Schema niemand, und
  `assertReferentialIntegrity` prüft es nicht. Eine entfernte Zuordnung
  beschädigt also weder History noch Backup – genau wie heute beim Löschen
  von Hand.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Wie sagt die Datei „raus damit“? | `replaceAssignments: true` am Workout; ohne Flag bleibt alles additiv |
| Was ersetzt das Flag? | Zusammensetzung: Mitglieder, Reihenfolge, Supersätze |
| Fehlendes Feld an einer bleibenden Zuordnung | bleibt stehen; `null` leert es ausdrücklich |
| Supersätze | kommen aus der Datei (`superset`-Gruppenname), nur bei ersetzten Workouts |
| Wochenprogressionen per Import | nicht in diesem Schritt, eigene Spec |
| Umsetzung | bestehenden Planer erweitern (Ansatz A), kein zweites Importformat |

Verworfen: eine explizite Entfernen-Liste (Claude müsste den Ist-Stand
kennen), implizites Ersetzen jedes genannten Workouts (eine Delta-Datei wie
die vom 28.08. würde dann Übungen löschen), Löschen und Import als zwei
getrennte Schritte (nicht atomar).

## 1. Dateiformat

Alles ist additiv: `schemaVersion` bleibt `1`, eine Datei ohne die neuen
Felder verhält sich exakt wie heute.

```jsonc
{
  "schemaVersion": 1,
  "templates": [
    { "name": "Einheit A", "replaceAssignments": true }
  ],
  "templateAssignments": [
    { "template": "Einheit A", "exercise": "Front Squat LH", "orderIndex": 1,
      "workSetCount": 4, "targetReps": 5, "superset": "Block 1" },
    { "template": "Einheit A", "exercise": "Klimmzug", "orderIndex": 2,
      "workSetCount": 4, "targetReps": 6, "targetRepsMax": 8, "superset": "Block 1" },
    { "template": "Einheit A", "exercise": "Beinbeuger", "orderIndex": 3,
      "workSetCount": 3, "targetWeight": null }
  ]
}
```

Neue Felder:

- **`templates[].replaceAssignments?: boolean`** – die Zuordnungen dieses
  Workouts in der Datei sind der vollständige Soll-Stand seiner
  Zusammensetzung. Das Flag wird nicht gespeichert und ist keine
  Feldänderung des Workouts.
- **`templateAssignments[].superset?: string`** – freier Gruppenname, gültig
  nur innerhalb des Workouts, verglichen über `normalizeImportKey`.
- **`templateAssignments[].targetRepsMax?: number | null`**.
- **`null`** ist zusätzlich erlaubt bei `targetReps`, `targetRepsMax`,
  `targetSeconds`, `targetWeight`, `targetHeightCm`, `restSeconds`, `notes`
  und leert das Feld – in beiden Modi. Ein fehlender Schlüssel ändert weiter
  nichts. `workSetCount` bleibt Pflicht, `includeWarmup` bleibt Boolean.

## 2. Validierung

Abbruch mit Zeilenangabe, wie bisher gesammelt in `problems`:

- Ein Workout mit `replaceAssignments: true` hat **keine** Zuordnung in der
  Datei („Workout ‚Einheit A' soll ersetzt werden, die Datei nennt aber keine
  Übung dafür.“). Ein Tippfehler im Workoutnamen darf kein Workout leeren.
- Ein `orderIndex` kommt innerhalb eines ersetzten Workouts doppelt vor.
  Lücken sind erlaubt, es wird ohnehin dicht neu nummeriert.
- Eine Supersatz-Gruppe steht nach Sortierung nicht zusammenhängend.
- Eine Supersatz-Gruppe hat nur ein Mitglied.
- `superset` steht an einer Zuordnung eines **nicht** ersetzten Workouts –
  dort ist unklar, wie sich die Gruppe zum Bestand verhält, also wird nicht
  geraten.

## 3. Planung

Alles im reinen [library-import.ts](../../../src/domain/library-import.ts).
`LibraryImportState` bekommt `progressionRules: ProgressionRule[]`.

**Identität.** Zuordnungen werden wie bisher über Workout + Übung erkannt.
Eine Übung, die im ersetzten Workout bleibt, behält ihre Id – und damit ihre
Progressionsregeln. Ersetzen heißt nicht „alles löschen, neu anlegen“.

**Reihenfolge.** Für ein ersetztes Workout ist die Sortierung nach
`orderIndex` der Datei die Zielreihenfolge (`templateOrder`), dicht ab 1.
`resolveInsertPosition` wird dort nicht benutzt – die Datei beschreibt die
Gruppen selbst. Hat sich die Position einer bleibenden Zuordnung geändert,
erscheint `Position: 3 → 1` als Feldänderung (Eintrag wird `update`). Der
Hinweis „Position x bleibt (Datei nennt y)“ gilt nur noch im additiven Modus.

**Entfernen.** Neue Eintragsart `removed` in `ImportEntryKind`. Jede
bestehende Zuordnung eines ersetzten Workouts, die die Datei nicht nennt,
wird ein `removed`-Eintrag; hängen Progressionsregeln daran, trägt er den
Hinweis „2 Wochenregeln gehen mit“.

**Supersatz-Ids.** Aus jedem Gruppennamen wird eine `supersetGroupId`:
Tragen alle Mitglieder bereits dieselbe Id und trägt keine andere bleibende
Zuordnung des Workouts diese Id, bleibt sie; sonst entsteht eine neue über
`createId()`. Eine Zuordnung ohne `superset` in einem ersetzten Workout
verliert ihre Gruppe. Die Vorschau beschreibt eine Gruppenänderung über die
Partner (`Supersatz: allein → mit Klimmzug`), nie über die Id. Folge der
Wiederverwendung: ein **zweiter Lauf derselben Datei ist durchgehend
„UNVERÄNDERT“**.

**`null`.** `Ziel-Gewicht: 82,5 → —` in der Vorschau. In `values` steht das
Feld bewusst als `undefined`, weil `Table.update` es genau dann entfernt –
die einzige Stelle, an der diese Dexie-Eigenheit gewollt ist, und der
Kommentar sagt das. Bei einer neuen Zuordnung wird `null` einfach
weggelassen. Ein `null` auf ein ohnehin leeres Feld ist keine Änderung.

**Zusammenfassung.** `LibraryImportSummary.removedAssignments`;
`planHasChanges` zählt `removed` und reine Umsortierungen mit.

## 4. Schreiben

`applyLibraryImport` nimmt `db.progressionRules` in die Transaktion auf und
plant wie bisher **innerhalb** der Transaktion neu. Für jeden
`removed`-Eintrag: erst die Regeln
(`progressionRules.where('templateExerciseId')`), dann die Zuordnung –
dieselbe Reihenfolge wie `deleteTemplateExercise`. Danach Positionen und
`supersetGroupId` (Setzen oder ausdrückliches Entfernen). Sessions,
Satzprotokolle, Tests und Einstellungen bleiben außerhalb der Transaktion.
Eine laufende Session aus dem ersetzten Workout ist nicht betroffen –
Plan/Ausführung bleiben getrennt.

`LibraryImportLog.removedAssignments?: number`, im Zod-Schema von
`export.ts` `.optional()` – ohne Versionssprung, ohne Dexie-Version (nicht
indiziert).

## 5. Oberfläche

[LibraryImportSection.tsx](../../../src/components/LibraryImportSection.tsx):
`KIND_LABELS.removed = 'Entfernt'`, Badge in `danger` (Rot heißt „gelöscht“).
Entfernte Einträge stehen bei den geänderten, nicht bei den unveränderten.
Die Zusammenfassung nennt die Zahl der entfernten Zuordnungen. Kein neuer
Bestätigungsdialog – die Vorschau mit ihrem expliziten Bestätigen ist es
bereits.

## 6. Tests

`domain/library-import.test.ts`:

- Ersetzen entfernt fehlende Zuordnungen, behält die Id bleibender, übernimmt
  die Reihenfolge dicht nummeriert.
- `removed`-Eintrag nennt die Zahl der Progressionsregeln.
- Supersatz: Gruppe entsteht, bleibt bei gleichen Mitgliedern unverändert
  (gleiche Id), wird bei fehlendem `superset` aufgelöst.
- Abbruch: leeres ersetztes Workout, doppelter `orderIndex`, nicht
  zusammenhängende Gruppe, Gruppe mit einem Mitglied, `superset` im
  additiven Workout.
- `null` leert ein Feld; `null` auf leerem Feld ist `unchanged`;
  `targetRepsMax` kommt an.
- Zweiter Plan nach Anwendung ist komplett `unchanged`.
- Datei ohne Flag: Verhalten wie bisher (bestehende Tests bleiben grün).

`db/library-import-actions.test.ts`:

- Regeln einer entfernten Zuordnung sind gelöscht, die einer bleibenden
  bestehen.
- Sessions und Satzprotokolle sind unberührt.
- Ein Fehler in der Planung rollt alles zurück.
- Protokollzeile trägt `removedAssignments`.

## 7. Dokumentation

- [CLAUDE.md](../../../CLAUDE.md), Abschnitt Bibliotheks-Import: Regel
  „Nothing is ever deleted“ präzisieren – gelöscht wird nur eine Zuordnung in
  einem Workout, dessen Ersetzung die Datei ausdrücklich verlangt; Übungen,
  Workouts und Bänder selbst bleiben unantastbar.
- Kopfkommentar von `library-import.ts` entsprechend.
- Formatbeschreibung für das claude.ai-Projekt unter
  `~/Documents/gym-book-daten/` (nicht im Repository, siehe CLAUDE.md).

## Nicht in diesem Schritt

- Progressionsregeln per Import.
- `null` für Übungsfelder (`instructions`, `tempo`, …).
- Löschen von Übungen, Workouts oder Bändern per Import.
- `targetBandId` im Import.
