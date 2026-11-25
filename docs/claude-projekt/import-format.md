# Gym Book: Import-Format (Bibliotheks-Import)

Stand: App-Version vom 25.11.2026, `schemaVersion: 1`.

Diese Datei liegt im Repo unter `docs/claude-projekt/import-format.md`. Jeder
Codeblock vom Typ `json` darin ist eine vollständige, gültige Importdatei (ein
Test prüft das); Ausschnitte stehen als `text`. Ändert sich das
Import-Format, ändert sich diese Datei im selben Schritt.

Diese Datei beschreibt vollständig, wie eine Import-Datei für die Gym-Book-App
aussieht und was die App beim Import mit ihr macht. Sie ersetzt
`workout-ersetzen.md`. Wie der Text im Feld `instructions` geschrieben wird,
steht in `anleitungstexte.md`. Für Lauf-Anleitungen gelten dieselben Regeln.

---

## 1. Der Weg in die App

1. In der App öffnet man den Tab **Abgleich** (`/sync`). Unter **„Bibliothek
   importieren“** lädt man die Datei hoch oder fügt das JSON in das Feld
   **„Oder JSON einfügen“** ein.
2. Die App zeigt dann eine **Vorschau** (Dry-Run). Jeder Eintrag ist markiert
   als `NEU`, `AKTUALISIERT` (mit *Feld: alt → neu*), `UNVERÄNDERT` oder
   `ENTFERNT` (rot); Einschränkungen zusätzlich als `AUFGEHOBEN` oder
   `WIEDER AKTIV`.
3. Geschrieben wird erst nach dem Bestätigen. Enthält die Vorschau
   `ENTFERNT`-Einträge, lädt die App vorher automatisch ein vollständiges
   Backup herunter.

Ein Import ist **atomar**: Bei einem Fehler wird gar nichts geschrieben, und
die App nennt die Zeile („Zuordnung 3: …“, „Termin 5: …“). Ein erfolgreicher
Import lässt sich **nicht rückgängig machen**.

---

## 2. Was der Import kann und was nicht

**Kann:**

- Übungen anlegen und ändern (Name, Erfassungsart, Seiten, Belastungsart, Höhe,
  Anleitung, Tempo).
- Workouts anlegen und ändern (Name, Art, Notiz).
- Ein Workout zur **geführten Vorlage** machen: eine Liste von Schritten, die
  die App von selbst abspielt (Abschnitt 6.1). Eine geführte Vorlage hat
  stattdessen keine Übungen.
- Übungen einem Workout zuordnen, inklusive Sätzen, Zielwerten, Pause, Notiz,
  Reihenfolge und Supersätzen.
- Bandstufen anlegen.
- **Termine** im datierten Plan anlegen, ändern und entfernen, sowohl Workouts
  als auch Läufe mit Vorgaben.
- **Einschränkungen** anlegen, ändern, aufheben und wieder aktivieren: Übungen
  oder Schritte für einen Zeitraum pausieren (mit Ersatz) oder anpassen,
  ohne die Workouts anzufassen (Abschnitt 12).

**Kann nicht.** Das muss der Nutzer von Hand in der App erledigen; nenn es ihm
ausdrücklich:

- Übungen, Workouts oder Bänder **löschen**. Auch eine Einschränkung lässt
  sich nicht löschen, nur aufheben (`"lifted": true`).
- **Wochenprogressionen** (Regeln pro Programmwoche), **Programme**,
  Programmwochen, das Programm-Startdatum oder einen Wochen-Override setzen.
- Das **Ziel-Band** einer Zuordnung setzen. Bei Bandübungen gibt es per Import
  keinen Zielwert.
- Den Standard-Wiederholungswert einer Übung ändern oder die Markierung
  „Steigerung möglich“ für eine Übung abschalten.
- Bilder hochladen.
- Trainingsdaten anfassen: Sessions, Sätze, Läufe und Tests.
- Einzelne **Schritte** einer geführten Vorlage ändern. Die Datei ersetzt immer
  die ganze Liste. Eine geführte Vorlage wieder zu einem gewöhnlichen Workout
  zu machen, geht per Import nicht.
- Die **Anleitung** oder das **Tempo** einer Übung leeren, ebenso die **Notiz
  eines Workouts**. Ein leerer Text zählt dort als „nicht angegeben“.

---

## 3. Grundregeln

1. **Identität über den Namen, nicht über eine Id.** Verglichen wird getrimmt
   und ohne Groß-/Kleinschreibung. Daraus folgt:
   - Ein **Tippfehler** im Namen führt zu `NEU` und damit zu einer zweiten
     Übung bzw. einem zweiten Workout neben dem echten. Namen deshalb immer
     **exakt** aus dem Bestand übernehmen.
   - Eine abweichende **Groß-/Kleinschreibung** benennt das Bestehende um
     (`AKTUALISIERT`, „Name: … → …“).
2. **Ein fehlender Schlüssel bedeutet „unverändert“.** Geschrieben wird nur,
   was in der Datei steht. Das gilt auch für `steps`: Ohne den Schlüssel bleibt
   die Schrittliste einer geführten Vorlage stehen, mit ihm wird sie **ganz**
   ersetzt.
3. **`null` leert ein Feld**, aber nur an den Stellen, an denen es unten
   ausdrücklich erlaubt ist.
4. **Dieselbe Datei zweimal importiert ändert nichts.** Beim zweiten Mal steht
   alles auf `UNVERÄNDERT`.
5. **Unbekannte Blöcke brechen ab.** Auf oberster Ebene sind nur die Blöcke
   aus Abschnitt 4 und `"_hinweis": "…"` erlaubt; jeder andere Schlüssel
   bricht mit „Unbekannter Block ‚…‘ – ist die App aktuell?“ ab. In den
   Einträgen von `exercises`, `templates`, `templateAssignments`, `bandLevels`
   und `planEntries` werden unbekannte Schlüssel ignoriert, dort darf also ein
   `_hinweis` stehen. In `restrictions` ist **jeder** unbekannte Schlüssel ein
   Abbruch, auch `_hinweis`.
6. **Formate:**
   - Datum als `JJJJ-MM-TT`.
   - Zahlen als JSON-Zahlen mit Punkt (`62.5`, nicht `"62,5"`).
   - Zeiten in **Sekunden**.
   - Gewicht in kg, Höhe in cm.
7. **Alle Blöcke sind optional.** Eine Datei, die nur Termine enthält, ist
   gültig.

## 4. Gerüst

```text
{
  "schemaVersion": 1,
  "_hinweis": "Was diese Datei ändert, in einem Satz.",
  "exercises": [ … ],
  "templates": [ … ],
  "templateAssignments": [ … ],
  "bandLevels": [ … ],
  "planRange": { "from": "JJJJ-MM-TT", "to": "JJJJ-MM-TT" },
  "planEntries": [ … ],
  "restrictions": [ … ]
}
```

Blöcke, die nichts enthalten, lässt man weg. `planRange` steht nur zusammen
mit mindestens einem Termin.

---

## 5. `exercises`: Übungen

| Feld | Pflicht | Werte | Bedeutung |
|---|---|---|---|
| `name` | **ja** | Text | Identität, siehe 3.1 |
| `trackingMode` | **ja** | `reps_weight` \| `time` \| `time_weight` | Wiederholungen + Gewicht \| Zeit \| Zeit + Gewicht |
| `unilateral` | **ja** | `true` \| `false` | `true`: Links und rechts werden getrennt erfasst |
| `loadKind` | nein | `weight` \| `band` | Belastung als kg oder als Widerstandsband |
| `tracksHeight` | nein | `true` \| `false` | Erfasst zusätzlich eine Höhe in cm (Stufe, Kasten) |
| `instructions` | nein | Text (Markdown-Teilmenge) | Anleitung, siehe `anleitungstexte.md` |
| `tempo` | nein | Text | z. B. `"3-1-1-0"` |

**Vorsicht bei den Pflichtfeldern.** `trackingMode` und `unilateral` sind auch
dann Pflicht, wenn man an einer bestehenden Übung nur die Anleitung ändern
will. Ein **falscher** Wert stellt die Übung um. Die Werte kommen deshalb immer
aus `bestand.json` im Analyse-Export und werden nie geraten. Ist eine solche Umstellung nicht
beabsichtigt, verrät sie sich in der Vorschau als „Erfassung: … → …“ oder
„Seiten: … → …“.

## 6. `templates`: Workouts

| Feld | Pflicht | Werte | Bedeutung |
|---|---|---|---|
| `name` | **ja** | Text | Identität |
| `category` | nein | `strength` \| `mobility` \| `yoga` \| `faszien` | Kraft, Mobility, Yoga oder Faszien (Faszienrolle). Fehlt der Schlüssel bei einem neuen Workout, wird es Kraft. Mobility, Yoga und Faszien zählen in der Wochenrechnung als Einheiten mit Dauer, nicht als Kraftvolumen; jede Art hat in der App ein eigenes Zeichen und einen eigenen Filter. |
| `notes` | nein | Text | Notiz zum Workout. Lässt sich per Import nicht leeren. |
| `steps` | nein | Liste von Schritten, mindestens einer | Macht das Workout zur **geführten Vorlage**, siehe 6.1. Ersetzt eine vorhandene Liste vollständig. |
| `replaceAssignments` | nein | `true` | Modus „Ersetzen“ für die Zuordnungen, siehe 7.2. Wird nicht gespeichert. |

Ein Workout, das nur Zuordnungen oder Termine bekommt, muss hier **nicht**
aufgeführt werden. Es reicht, wenn es schon existiert. Nötig ist ein Eintrag in
diesem Block nur in drei Fällen: Das Workout ist neu, man ändert eines seiner
Felder, oder man braucht `replaceAssignments`.

### 6.1 `steps`: geführte Vorlagen

Eine Vorlage mit `steps` ist eine **geführte Vorlage**. Die App spielt sie als
Ablauf ab: ein Wechsel, eine Übung, ein Wechsel und so weiter, rein nach der
Zeit. Es gibt keine Wiederholungen, keine Sätze, keine Runden und kein Gewicht.
Was als Wiederholungen oder Runden gedacht ist, rechnest du in Sekunden um
oder schreibst es als einzelne Schritte aus. „3 Runden Katze-Kuh“ sind drei
Schritte oder ein Schritt mit der Gesamtdauer.

**Geführt ist unabhängig von `category`.** Eine Mobility-Vorlage kann geführt
sein, eine Yoga-Vorlage muss es nicht.

Jeder Schritt ist ein Objekt:

| Feld | Pflicht | Werte | Bedeutung |
|---|---|---|---|
| `name` | **ja** | Text, nicht leer | Was auf dem Screen steht |
| `seconds` | **ja** | ganze Zahl ≥ 1 | Dauer in Sekunden. Bei `bothSides: true` die **Gesamtzeit beider Seiten**: jede Seite läuft die Hälfte (abgerundet). |
| `bothSides` | nein | `true` | Aus dem Schritt werden links und rechts, mit 3 s Seitenwechsel dazwischen. Fehlt der Schlüssel, ist der Schritt einseitig. |
| `hint` | nein | Klartext | Der Hinweis hinter dem „i“. **Kein Markdown**, er wird so angezeigt, wie er dasteht. Ein oder zwei Sätze. |
| `transitionSeconds` | nein | ganze Zahl ≥ 1 | Der Wechsel **vor** diesem Schritt in Sekunden. Fehlt er, sind es 5. Sinnvoll nach einer aufwendigen Position, aus der man mehr Zeit zum Umbauen braucht. |
| `spokenName` | nein | Text | Was die Ansage statt `name` sagt, siehe unten. |

**Wie die App die Liste abspielt:**

- Vor dem ersten Schritt läuft ein Wechsel von **immer 5 Sekunden**. Ein
  `transitionSeconds` am ersten Schritt ändert daran nichts.
- Vor jedem weiteren Schritt läuft ein Wechsel mit dessen `transitionSeconds`
  (Standard 5).
- Ein beidseitiger Schritt wird zu **links**, 3 Sekunden Seitenwechsel,
  **rechts**. Jede Seite dauert die Hälfte von `seconds`.
- Nach dem letzten Schritt kommt kein Wechsel mehr.
- Die Gesamtdauer ist die Summe aus allem, Wechsel und Seitenwechseln
  eingerechnet. Für `Taube` mit `seconds: 150` und `bothSides: true` sind das
  75 + 3 + 75 = 153 Sekunden, dazu der Wechsel davor. Die Ansage nennt die
  Zeit einer Seite („Als Nächstes: Taube, links, 75 Sekunden“). Rechne damit, wenn die
  Einheit eine bestimmte Länge haben soll, und zähle die Wechsel mit.
- Die Reihenfolge der Liste ist die Reihenfolge des Ablaufs.

**Regeln für die Datei:**

- **Eine geführte Vorlage hat keine Übungs-Zuordnungen.** Eine Datei, die
  einem Workout `steps` **und** Einträge in `templateAssignments` gibt, wird
  abgelehnt. Dasselbe gilt für `steps` an einem Workout, das in der App schon
  Übungen hat, und für Zuordnungen an einer Vorlage, die schon Schritte hat.
- **`steps` ersetzt die Liste ganz.** Jeder Import, der `steps` nennt, nennt
  alle Schritte, auch die unveränderten. Die heutige Liste steht in
  `bestand.json` unter `templates[].steps`, in denselben Feldnamen. Die Namen der Schritte sind keine
  Identität: es gibt keine Möglichkeit, „nur Schritt 4“ zu ändern.
- `steps: []` ist verboten. Eine Liste hat mindestens einen Schritt.
- `bothSides: false` ist erlaubt, wird aber wie ein fehlender Schlüssel
  behandelt. Lass ihn weg.
- Neu angelegt werden Schritte nur mit der Vorlage oder an einer bestehenden
  Vorlage ohne Übungen. Den Namen der Vorlage nimmst du, wie bei allem,
  **exakt** aus dem Bestand.

**Sprechnamen (`spokenName`).** Die App spricht die Ansage „Als Nächstes: {Name},
{links/rechts}, {Dauer}“ mit einer Computerstimme. Sie liest, was dasteht,
Buchstabe für Buchstabe. Ein Name, den man nicht so liest, wie er geschrieben
ist, bekommt deshalb einen `spokenName`. Für ihn gilt:

- **Keine Abkürzungen.** „BWS“ wird „Brustwirbelsäule“, „Hüftbeuger li.“ wird
  „Hüftbeuger links“.
- **Keine Klammern.** „Taube (tief)“ wird „Tiefe Taube“. Was in der Klammer
  steht, gehört in `hint`.
- **Keine Schrägstriche.** „Katze/Kuh“ wird „Katze und Kuh“.
- **Kein Markdown** (kein `*`, `_`, `#`, kein Backtick) **und keine URLs.**
- Zahlen ausgeschrieben, wo sie gesprochen anders klingen als gelesen:
  „90/90“ wird „neunzig neunzig“.
- Nur der Name, keine Seite, keine Dauer und kein „Als Nächstes“. Das setzt die
  App selbst davor und dahinter.

Ist `name` schon sprechbar („Kindhaltung“, „Herabschauender Hund“), lass
`spokenName` weg. Der Name wird dann unverändert gesprochen.

**Vorschau.** Für eine geführte Vorlage steht in der Vorschau
`Schritte: — → geführt, 12 Schritte`. Ersetzt die Datei eine vorhandene Liste,
steht dort `geführt, 12 Schritte → geführt, 14 Schritte`, bei gleicher Zahl
`geführt, 12 Schritte (Inhalt geändert)`. Eine Liste, die sich nicht von der
gespeicherten unterscheidet, bleibt `UNVERÄNDERT`.

## 7. `templateAssignments`: Übungen in einem Workout

| Feld | Pflicht | Werte | `null` erlaubt |
|---|---|---|---|
| `template` | **ja** | Workout-Name | – |
| `exercise` | **ja** | Übungsname | – |
| `orderIndex` | **ja** | ganze Zahl ≥ 1 | – |
| `workSetCount` | **ja** | ganze Zahl ≥ 1 (Arbeitssätze) | – |
| `includeWarmup` | nein | `true`/`false` (fehlt = Warmup-Runde ja) | – |
| `targetReps` | nein | Wiederholungen bzw. Untergrenze einer Spanne | ja |
| `targetRepsMax` | nein | Obergrenze der Spanne (`8` + `10` → „8–10“) | ja |
| `targetSeconds` | nein | Zielzeit pro Satz in s | ja |
| `targetWeight` | nein | kg | ja |
| `targetHeightCm` | nein | cm | ja |
| `restSeconds` | nein | Pause nach dem Satz in s | ja |
| `notes` | nein | Klartext ohne Markdown, nur was in *diesem* Workout gilt | ja |
| `superset` | nein | Gruppenname, **nur** im Modus Ersetzen | – |

**Welche Zielwerte zu welcher Übung passen:**

| Übung | Passende Zielwerte |
|---|---|
| `reps_weight` | `targetReps` (+ `targetRepsMax`), `targetWeight` |
| `time` | `targetSeconds` |
| `time_weight` | `targetSeconds`, `targetWeight` |
| `tracksHeight: true` | zusätzlich `targetHeightCm` |
| `loadKind: band` | kein `targetWeight`. Das Ziel-Band setzt man in der App. |

Eine einseitige Übung (`unilateral: true`) bekommt die Sätze automatisch für
beide Seiten. `workSetCount: 3` ergibt also 3 × links und 3 × rechts.

**`workSetCount` ist Pflicht und wird immer geschrieben.** Wer an einer
bestehenden Zuordnung nur die Pause ändern will, übernimmt die Satzzahl
deshalb aus dem Bestand, sonst ändert er sie mit.

**Wochenprogressionen haben Vorrang.** Gibt es für eine Programmwoche eine
Regel (`programm.wochen[].regeln` in `bestand.json`), überschreibt deren Wert
in dieser Woche den Zielwert des Workouts, und zwar feldweise. Ein geänderter
`targetWeight` im Workout bleibt also wirkungslos in jeder Woche, deren Regel
selbst ein Gewicht vorgibt. Weise darauf hin, wenn das passiert, denn
Regeln lassen sich nur in der App ändern.

### 7.1 Modus Ergänzen (Standard, ohne Flag)

- **Neue** Zuordnungen werden an ihrem `orderIndex` eingefügt. Was ab dieser
  Stelle steht, rückt nach hinten. Liegt die Stelle mitten in einem Supersatz,
  kommt die neue Zuordnung hinter den Supersatz.
- **Bestehende** Zuordnungen behalten ihre Position. Ihr `orderIndex` in der
  Datei wird ignoriert; die Vorschau meldet dann „Position 4 bleibt (Datei
  nennt 2)“. Geändert werden nur ihre Werte.
- Entfernt wird nichts, und `superset` ist in diesem Modus verboten.

Der Modus eignet sich, um Zielwerte anzupassen oder einzelne Übungen
hinzuzufügen.

### 7.2 Modus Ersetzen (`"replaceAssignments": true` im Block `templates`)

Die Zeilen der Datei sind dann die **vollständige** Zusammensetzung dieses
Workouts:

- Was die Datei für dieses Workout nicht nennt, wird **entfernt**, und zwar
  **samt seinen Wochenprogressions-Regeln**. Diese Regeln kommen über einen
  Import nicht zurück. Deshalb gilt: jede Übung auflisten, die bleiben soll.
- Die Reihenfolge der Datei gilt. Lücken sind erlaubt (1, 2, 5 wird zu
  1, 2, 3), doppelte Werte nicht.
- `superset` ist ein frei gewählter Name, der nur in diesem Workout gilt
  (z. B. `"S1"`). Alle Zeilen mit demselben Namen bilden einen Supersatz. Sie
  müssen im `orderIndex` **direkt hintereinander** stehen, und ein Supersatz
  braucht **mindestens zwei** Übungen. Eine Zeile ohne `superset` gehört zu
  keinem Supersatz, und eine bestehende Gruppe wird dann aufgelöst.
- Ersetzt wird die Zusammensetzung, nicht die Werte. Fehlt `targetWeight` in
  einer Zeile, bleibt der Wert aus der App stehen; nur `null` leert ihn.
- Eine Zuordnung, die bleibt, behält ihre Wochenregeln.

Der Modus eignet sich, um ein Workout umzubauen: Übungen herausnehmen, neu
sortieren oder Supersätze bilden.

## 8. `bandLevels`: Widerstandsbänder

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `name` | **ja** | z. B. `"grün"` |
| `orderIndex` | **ja** | Stufe, 1 = leichtestes Band. Gilt nur für **neue** Bänder; bestehende behalten ihre Stufe. |

## 9. `planEntries` und `planRange`: der datierte Plan

Ein Termin ist **ein Workout oder ein Lauf an einem Tag**. Nichts wiederholt
sich von selbst: Eine Serie besteht aus einzelnen Terminen. Mehrere Termine an
einem Tag sind erlaubt.

### 9.1 Ein Termin

| Feld | Pflicht | Werte |
|---|---|---|
| `date` | **ja** | `JJJJ-MM-TT`, muss ein echter Kalendertag sein |
| `workout` | genau eines von beiden | Name eines bestehenden oder in derselben Datei angelegten Workouts |
| `run` | genau eines von beiden | Objekt, siehe unten |
| `notes` | nein | Klartext, für beide Arten. `null` leert. |

**`run`:**

| Feld | Pflicht | Einheit / Grenzen | `null` erlaubt |
|---|---|---|---|
| `title` | **ja** | Text, z. B. `"Intervalle 6×400"` | – |
| `targetDistanceKm` | nein | km, > 0, Dezimalzahl erlaubt | ja |
| `targetDurationSeconds` | nein | s, ganze Zahl > 0 (45 min = `2700`) | ja |
| `targetPaceSecondsPerKm` | nein | s pro km, > 0 (5:30 /km = `330`) | ja |
| `targetElevationGainM` | nein | m, ganze Zahl ≥ 0 | ja |
| `targetAverageHeartRate` | nein | Schläge/min, ganze Zahl 30–250 | ja |
| `instructions` | nein | Markdown-Teilmenge wie bei Übungen | ja |

Alle Vorgaben sind optional. „45 min locker“ besteht zum Beispiel nur aus
`targetDurationSeconds` und braucht keine Strecke. Die Pace wird ausdrücklich
als Vorgabe gespeichert und nicht berechnet.

### 9.2 Identität eines Termins

Ein Termin wird über **Datum + Workout** bzw. **Datum + Lauftitel**
wiedererkannt; beim Lauftitel zählen Leerzeichen am Rand und
Groß-/Kleinschreibung nicht.

- Stimmen Datum und Workout bzw. Lauftitel überein, wird der bestehende Termin
  aktualisiert (`AKTUALISIERT` oder `UNVERÄNDERT`).
- Hat ein Lauf einen **anderen Titel** oder ein Termin ein **anderes Datum**,
  ist das ein *neuer* Termin. Der alte bleibt stehen, außer er liegt in
  `planRange` (siehe 9.3). Einen Termin **verschiebt** man also, indem
  `planRange` das alte Datum mit abdeckt.
- Derselbe Schlüssel zweimal in der Datei führt zum Abbruch.
- Die **Reihenfolge innerhalb eines Tages** ist die Reihenfolge in der Datei.

### 9.3 Ohne und mit `planRange`

- **Ohne `planRange`** ergänzt und ändert die Datei nur, entfernt aber nichts.
- **Mit `planRange`** (`from` und `to`, beide Tage eingeschlossen) ist die
  Datei der **vollständige Plan dieses Zeitraums**. Offene Termine darin, die
  die Datei nicht nennt, werden entfernt (`ENTFERNT`). Jeder Termin der Datei
  muss dann im Zeitraum liegen.
- `planRange` ohne `planEntries` ist verboten, denn das würde den ganzen
  Zeitraum leeren.

Der übliche Fall „Plan für die nächsten zwei Wochen neu“ ist `planRange` vom
Montag bis zum Sonntag der zweiten Woche, darin alle Termine.

### 9.4 Erledigte Termine sind Geschichte

Ein Termin ist **belegt**, sobald eine laufende oder abgeschlossene Session oder
ein eingetragener Lauf auf ihn zeigt. Ein belegter Termin wird **nie** geändert
oder entfernt, egal was die Datei sagt. Die Vorschau zeigt ihn als
`UNVERÄNDERT`, und er behält seinen Platz im Tag.

Ob ein Termin offen, belegt oder erledigt ist, leitet die App selbst ab. Einen
Status kann man nicht importieren.

### 9.5 Wie die App Termine benutzt

- **Home** zeigt den ersten offenen Termin von heute als „Jetzt“-Karte. Gibt es
  heute keinen, steht dort „Nächster Termin“.
- Beim Start eines Workouts nimmt die App den offenen passenden Termin von
  heute. Gibt es den nicht, nimmt sie den frühesten offenen passenden Termin
  der **laufenden Kalenderwoche (Mo–So)**, auch einen künftigen. Wer
  Donnerstags Einheit am Mittwoch trainiert, erledigt also Donnerstags Termin.
- Ein Lauf wird beim Eintragen nach derselben Regel einem Lauf-Termin
  zugeordnet.
- Der Plan ist ein Angebot und keine Sperre: Jedes Workout lässt sich immer
  starten.
- Ein Termin bestimmt **nicht** die Programmwoche. Die ergibt sich aus dem
  Programm-Startdatum (Kalenderwochen ab Montag).

---

## 10. Wann der Import abbricht

Bei jedem der folgenden Fehler schreibt der Import gar nichts und nennt die
Zeile:

- `schemaVersion` fehlt oder ist nicht `1`.
- Ein Pflichtfeld fehlt, oder ein Wert hat den falschen Typ bzw. ist kein
  erlaubter Wert, etwa ein unbekannter `trackingMode`.
- Dieselbe Übung, dasselbe Workout oder dasselbe Band steht zweimal in der
  Datei.
- Eine Zuordnung oder ein Termin verweist auf ein Workout oder eine Übung, die
  es nicht gibt und die auch die Datei nicht anlegt.
- Dieselbe Übung steht zweimal im selben Workout in der Datei.
- `superset` steht in einem Workout ohne `replaceAssignments`.
- Ein Workout mit `replaceAssignments` hat in der Datei keine Zuordnung (meist
  ein Tippfehler im Namen).
- Ein Schritt hat einen leeren `name`, fehlende oder nicht ganzzahlige
  `seconds`, `seconds` oder `transitionSeconds` kleiner als 1, oder `steps` ist
  eine leere Liste. Die App nennt Workout und Schritt: „Workout 2, Schritt 5,
  Feld "seconds": Sekunden müssen größer als 0 sein.“
- Ein Workout hat `steps` und Zuordnungen in derselben Datei, `steps` an einem
  Workout mit Übungen oder Zuordnungen an einer geführten Vorlage.
- Derselbe `orderIndex` steht zweimal im selben ersetzten Workout.
- Das zu ersetzende Workout enthält in der App dieselbe Übung doppelt. Das muss
  der Nutzer erst in der App bereinigen.
- Ein Supersatz steht nicht am Stück oder hat nur eine Übung.
- Ein Termin hat beides oder keines von `workout` und `run`.
- Ein Termin hat ein ungültiges Datum, liegt außerhalb von `planRange` oder
  steht mit gleichem Schlüssel doppelt in der Datei.
- Ein Lauf hat keinen Titel oder eine Vorgabe außerhalb der Grenzen aus 9.1.
- In `planRange` liegt `from` nach `to`, oder `planRange` steht ohne
  `planEntries`.
- Ein unbekannter Block auf oberster Ebene (alles außer den Blöcken aus
  Abschnitt 4 und `_hinweis`).
- **Einschränkungen** (Abschnitt 12), die App nennt „Einschränkung 1, Pause 2:
  …“:
  - `name` fehlt oder steht zweimal in der Datei.
  - Eine neue Einschränkung ohne `from` oder ohne ein einziges Ziel; ein
    ungültiges Datum; `until` vor `from`.
  - Ein Eintrag ohne genau eine Zielform, oder mit einem unbekannten
    Feldnamen.
  - Eine Übung (auch als Ersatz), ein Workout oder ein Schritt, die es nicht
    gibt und die auch die Datei nicht anlegt; ein neuer `{ "step" }`, der in
    keiner geführten Vorlage vorkommt; `step` an einem Workout ohne Schritte;
    `template` + `exercise`, wenn das Workout die Übung nicht enthält.
  - Dasselbe Ziel zweimal in derselben Pausen- bzw. Anpassungsliste.
  - Eine Anpassung ohne Wert, Notiz oder `holdProgression`; Übungswerte an
    einem Schritt; `seconds` an einer Übung; `replacement` an einem Schritt;
    ein Ersatz ohne `workSetCount`.
  - Zwei Einschränkungen, die am selben Ziel im selben Zeitraum denselben Wert
    setzen oder beide einen Ersatz für dieselbe Übung stellen (Datei und
    Bestand zusammen).
  - Ein `steps`-Import, der einen Schritt verliert, den eine nicht aufgehobene,
    nicht abgelaufene Einschränkung über `template` + `step` pausiert oder
    anpasst, ohne dass dieselbe Datei diese Einschränkung mitändert.

---

## 11. Beispiele

Die Namen in den Beispielen sind ausgedacht. Echte Namen kommen immer aus dem
Bestand.

### 11.1 Zwei Wochen Plan, vollständig

```json
{
  "schemaVersion": 1,
  "_hinweis": "Beispielplan über zwei Wochen: Kraft Mo/Do, Mobility Mi, drei Läufe.",
  "planRange": { "from": "2026-10-12", "to": "2026-10-25" },
  "planEntries": [
    { "date": "2026-10-12", "workout": "Einheit A" },
    { "date": "2026-10-13", "run": { "title": "Locker 45 min", "targetDurationSeconds": 2700, "targetAverageHeartRate": 140 } },
    { "date": "2026-10-14", "workout": "Beispiel-Mobility" },
    { "date": "2026-10-15", "workout": "Einheit B", "notes": "Beispielnotiz: letzte Übung nur 2 Sätze." },
    { "date": "2026-10-17", "run": {
        "title": "Intervalle 6×400",
        "targetDistanceKm": 8,
        "instructions": "- 15 min einlaufen\n- 6 × 400 m in **4:10 /km**, 200 m Trabpause\n- 10 min auslaufen"
    } },
    { "date": "2026-10-19", "workout": "Einheit A" },
    { "date": "2026-10-20", "run": { "title": "Locker 45 min", "targetDurationSeconds": 2700 } },
    { "date": "2026-10-22", "workout": "Einheit B" },
    { "date": "2026-10-25", "run": { "title": "Lang 18 km", "targetDistanceKm": 18, "targetPaceSecondsPerKm": 375, "targetElevationGainM": 250 } }
  ]
}
```

### 11.2 Zielwerte anpassen (Modus Ergänzen)

```json
{
  "schemaVersion": 1,
  "_hinweis": "Front Squat +2,5 kg, Pause Beinbeuger auf 90 s.",
  "templateAssignments": [
    { "template": "Einheit A", "exercise": "Front Squat", "orderIndex": 4, "workSetCount": 4, "targetWeight": 62.5 },
    { "template": "Einheit A", "exercise": "Beinbeuger", "orderIndex": 6, "workSetCount": 3, "restSeconds": 90 }
  ]
}
```

`orderIndex` und `workSetCount` stammen hier unverändert aus dem Bestand.

### 11.3 Workout umbauen (Modus Ersetzen)

```json
{
  "schemaVersion": 1,
  "templates": [ { "name": "Einheit A", "replaceAssignments": true } ],
  "templateAssignments": [
    { "template": "Einheit A", "exercise": "Front Squat", "orderIndex": 1, "workSetCount": 4, "targetReps": 5, "superset": "S1" },
    { "template": "Einheit A", "exercise": "Klimmzug", "orderIndex": 2, "workSetCount": 4, "targetReps": 6, "targetRepsMax": 8, "superset": "S1" },
    { "template": "Einheit A", "exercise": "Beinbeuger", "orderIndex": 3, "workSetCount": 3, "targetWeight": null }
  ]
}
```

Jede Übung, die heute in „Einheit A“ steht und hier fehlt, wird entfernt,
samt ihren Wochenregeln.

### 11.4 Neue Übung, neues Workout, gleich eingeplant

```json
{
  "schemaVersion": 1,
  "exercises": [
    { "name": "Step-down", "trackingMode": "reps_weight", "unilateral": true, "tracksHeight": true,
      "instructions": "- Knie bleibt **über dem zweiten Zeh**\n- 3 s absenken\n\n*Beispieltext*" }
  ],
  "templates": [ { "name": "Beispiel-Stabi", "category": "mobility" } ],
  "templateAssignments": [
    { "template": "Beispiel-Stabi", "exercise": "Step-down", "orderIndex": 1, "workSetCount": 3,
      "includeWarmup": false, "targetReps": 8, "targetHeightCm": 20, "restSeconds": 60 }
  ],
  "planEntries": [ { "date": "2026-10-16", "workout": "Beispiel-Stabi" } ]
}
```

### 11.5 Geführte Vorlage

```json
{
  "schemaVersion": 1,
  "_hinweis": "Neue geführte Yoga-Einheit „Yoga Abendflow“, 7 Schritte.",
  "templates": [
    {
      "name": "Yoga Abendflow",
      "category": "yoga",
      "steps": [
        { "name": "Kindhaltung", "seconds": 60 },
        { "name": "Katze-Kuh", "seconds": 45, "spokenName": "Katze und Kuh" },
        { "name": "Herabschauender Hund", "seconds": 60,
          "hint": "Hüfte nach hinten oben schieben, Fersen Richtung Boden, Nacken lang. Knie dürfen leicht gebeugt bleiben." },
        { "name": "Tiefer Ausfallschritt", "seconds": 90, "bothSides": true, "transitionSeconds": 10 },
        { "name": "Taube", "seconds": 150, "bothSides": true,
          "hint": "Das vordere Schienbein liegt quer, die Hüfte bleibt gerade." },
        { "name": "Liegender Twist", "seconds": 90, "bothSides": true },
        { "name": "BWS Rotation", "seconds": 60, "spokenName": "Brustwirbelsäule Rotation" }
      ]
    }
  ],
  "planEntries": [ { "date": "2026-11-26", "workout": "Yoga Abendflow" } ]
}
```

Erwartete Vorschau: `Yoga Abendflow` als `NEU` mit `Art` und
`Schritte: — → geführt, 7 Schritte`, dazu ein `NEU` unter Termine. Die
Gesamtdauer liegt bei etwa 10 Minuten (604 Sekunden, Wechsel und
Seitenwechsel eingerechnet).

### 11.6 Einschränkung: zwei Wochen Schonphase

```json
{
  "schemaVersion": 1,
  "_hinweis": "Schonphase Beispiel A, zwei Wochen.",
  "restrictions": [
    {
      "name": "Beispiel A",
      "reason": "Erfundener Beispielgrund.",
      "from": "2026-12-01",
      "until": "2026-12-14",
      "pauses": [
        {
          "exercise": "Sprungkniebeuge",
          "replacement": { "exercise": "Step-down", "workSetCount": 3, "targetReps": 8 }
        },
        { "template": "Yoga Abendflow", "step": "Tiefer Ausfallschritt" }
      ],
      "adjustments": [
        { "template": "Einheit A", "exercise": "Front Squat", "targetWeight": 40, "note": "Nur bis Parallel." },
        { "exercise": "Beinbeuger", "holdProgression": true },
        { "step": "Taube", "seconds": 120, "note": "Langsam ausführen." }
      ]
    }
  ]
}
```

Erwartete Vorschau: `Beispiel A` als `NEU`, Zustand nach dem Import
`angekündigt` (vor dem 01.12.) oder `aktiv`, darunter die Ziele in
Klarnamen. Ab dem 01.12. fällt die Sprungkniebeuge in jeder Kraft-Einheit
heraus, Step-down kommt mit 3 × 8 dazu; die Taube läuft je Seite 60 statt 75
Sekunden.

### 11.7 Einschränkung verlängern oder aufheben

```json
{
  "schemaVersion": 1,
  "_hinweis": "Beispiel A eine Woche länger, Beispiel B aufgehoben.",
  "restrictions": [
    { "name": "Beispiel A", "until": "2026-12-21" },
    { "name": "Beispiel B", "lifted": true }
  ]
}
```

Nur die genannten Felder ändern sich; die Ziele von „Beispiel A“ bleiben,
weil `pauses` und `adjustments` fehlen.

---

## 12. `restrictions`: Einschränkungen

Eine Einschränkung nimmt für einen Zeitraum Übungen oder Schritte heraus
(**Pause**, auf Wunsch mit Ersatzübung) oder ändert ihre Zielwerte
(**Anpassung**), ohne die Workouts anzufassen. Die Workouts bleiben der Plan;
die Einschränkung wirkt erst, wenn eine Einheit startet, und friert dort ein.
Schon gespeicherte Einheiten ändern sich nie.

### 12.1 Felder

| Feld | Pflicht | Werte | Bedeutung |
|---|---|---|---|
| `name` | **ja** | Text | Identität wie bei Übungen (getrimmt, ohne Groß-/Kleinschreibung). Gleicher Name aktualisiert. |
| `reason` | nein | Klartext | Der Grund, steht im Sheet der Einschränkung. `null` leert. |
| `from` | **ja** beim Anlegen | `JJJJ-MM-TT` | Erster Tag, eingeschlossen. Darf in der Vergangenheit liegen; wirkt nur auf Einheiten, die ab dem Import starten. |
| `until` | nein | `JJJJ-MM-TT` | Letzter Tag, eingeschlossen. Fehlt er bei einer neuen, ist das Ende offen; `null` macht ein Ende wieder offen. |
| `lifted` | nein | `true` \| `false` | `true` hebt auf, `false` aktiviert eine aufgehobene wieder. Fehlt: keine Änderung. |
| `pauses` | nein | Liste | Ersetzt die Pausen **ganz**, wenn genannt. Fehlt: unverändert. |
| `adjustments` | nein | Liste | Ersetzt die Anpassungen **ganz**, wenn genannt. Fehlt: unverändert. |

Eine neue Einschränkung braucht `from` und mindestens eine Pause oder
Anpassung. Aufheben geht auch in der App; ändern und anlegen nur per Import.

### 12.2 Ziele

Jeder Eintrag in `pauses` und `adjustments` hat **genau eine** Zielform:

| Form | Trifft |
|---|---|
| `{ "exercise": "…" }` | die Übung in jedem Workout |
| `{ "template": "…", "exercise": "…" }` | die Übung nur in diesem Workout; das Workout muss sie enthalten |
| `{ "template": "…", "step": "…" }` | den Schritt in dieser geführten Vorlage |
| `{ "step": "…" }` | den Schritt in jeder geführten Vorlage, auch in künftigen; er muss beim Import in mindestens einer vorkommen – außer die Einschränkung trägt genau dieses Ziel schon (in `bestand.json` steht es dann, auch wenn es derzeit nichts trifft) |

Schritte werden über den Namen getroffen (getrimmt, ohne Groß-/
Kleinschreibung). Ein Schrittziel trifft nie eine Übung, auch nicht bei
gleichem Namen.

### 12.3 Pause

```text
{ "exercise": "Sprungkniebeuge",
  "replacement": { "exercise": "Step-down", "workSetCount": 3, "targetReps": 8 } }
```

Die pausierte Übung fällt in der Einheit heraus; sie steht ausgegraut mit
„Pausiert bis …“ da und lässt sich mit „Trotzdem machen“ zurückholen.
`replacement` (nur an Übungen) setzt eine Ersatzübung direkt dahinter:
`exercise` und `workSetCount` sind Pflicht, dazu optional `targetReps`,
`targetRepsMax`, `targetSeconds`, `targetWeight`, `targetHeightCm` und
`restSeconds` (fehlt: die Pause der pausierten Übung). Ein pausierter Schritt
wird in der geführten Einheit nicht abgespielt; sind alle Schritte pausiert,
startet sie nicht.

### 12.4 Anpassung

```text
{ "exercise": "Front Squat", "targetWeight": 40, "note": "Nur bis Parallel." }
{ "exercise": "Beinbeuger", "holdProgression": true }
{ "step": "Taube", "seconds": 120, "note": "Langsam ausführen." }
```

- **An einer Übung** mindestens eines von `workSetCount`, `targetReps`,
  `targetRepsMax`, `targetSeconds`, `targetWeight`, `targetHeightCm`, `note`,
  `holdProgression: true`. Die Werte gelten **nach** der Wochenregel: Workout →
  Wochenregel → Anpassung. Eine Anpassung gleich dem Wochenwert ist keine
  Abweichung.
- **An einem Schritt** mindestens eines von `seconds` (ganze Zahl ≥ 1, dieselbe
  Bedeutung wie `seconds` am Schritt, bei `bothSides` also die Gesamtzeit
  beider Seiten) und `note`.
- `note` steht in der Einheit als eigene Zeile unter der Übung bzw. auf dem
  Ablauf-Screen unter dem Schritt. Sie wird nicht angesagt.
- `holdProgression: true` hält die Steigerung: kein Steigerungshinweis, die
  Werte zählen aber als Leistungsstand.
- Zahlen mit denselben Grenzen wie in `templateAssignments` bzw. `steps`.

### 12.5 Was daraus in der App und im Export wird

- Werte einer **angepassten**, einer **trotzdem** gemachten und einer in der
  Historie **ausgenommenen** Übung sind kein Leistungsstand: Sie zählen nicht
  als letzte Werte und lösen keinen Steigerungshinweis aus. Ein Ersatz, eine
  gehaltene Steigerung und eine reine Notiz zählen normal.
- Im Analyse-Export stehen die Einschränkungen in `meta.json`
  (`einschraenkungen`), in `sessions.csv` in den letzten drei Spalten
  (`einschraenkung`, `einschraenkung_art`, `ersatz_fuer`) und in
  `protokoll.csv` (Status `pausiert`, Spalte `einschraenkung`).
- `bestand.json` enthält unter `restrictions` alle nicht aufgehobenen, nicht
  abgelaufenen Einschränkungen in genau dieser Importform, ohne Ziele, die es
  nicht mehr gibt. Wer eine ändert, übernimmt sie von dort; `pauses` und
  `adjustments` immer vollständig nennen, denn sie ersetzen die Liste.
- Zwei Einschränkungen dürfen dieselbe Übung treffen; sie dürfen nur nicht im
  selben Zeitraum denselben Wert setzen oder beide einen Ersatz stellen.
