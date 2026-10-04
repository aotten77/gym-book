# Läufe erfassen

Stand: 04.10.2026 · Status: Entwurf, abgestimmt im Gespräch

## Ziel

Neben dem Krafttraining sollen Läufe in die App. Nach dem Lauf werden
Strecke, Höhenmeter, Dauer und durchschnittlicher Puls eingetragen. Die Daten
dienen der **Analyse**: das Wochenvolumen von Kraft, Mobility und Ausdauer
nebeneinander sehen und daraus die nächsten Wochen planen – in der App und im
Analyse-Export.

## Einordnung: Teil 1 von 3

Das Gesamtvorhaben ist in drei Teilprojekte zerlegt, jedes mit eigener Spec
und eigenem Plan. Diese Spec beschreibt nur Teil 1.

1. **Läufe erfassen** (diese Spec) – Lauf eintragen, Verlauf, Grafik,
   Wochenübersicht, Analyse-Export, Art des Workouts (Kraft/Mobility).
2. **Datierter Trainingsplan** – Plan-Einträge mit Datum für Workouts *und*
   Läufe (Laufvorgaben: km, HM, Dauer, Ø Puls, Pace, Markdown-Anleitung, z. B.
   für Intervalle), Anlegen in der App und per Import, Serienhilfe („Einheit A,
   Mo + Do, 6 Wochen“ legt Einzeltermine an), Umstellung von
   `scheduledWeekdays`, Verknüpfung Plan ↔ Durchführung. Mehrere Einheiten an
   einem Tag.
3. **Kalender** – Icons (Hantel, Läufer, Mobility), zwei Zustände (geplant für
   heute und Zukunft, umgesetzt; ein verpasster Plan in der Vergangenheit
   verschwindet), Antippen zum Ansehen oder Anlegen, am heutigen Tag ist jede
   Einheit anlegbar. Unter dem Raster die Wochenzahlen aus `weekly-volume.ts`.

Was Teil 1 bewusst offenhält, damit Teil 2 nur ergänzt: `RunLog` bekommt dort
einen Verweis auf den Plan-Eintrag und einen Snapshot der Vorgabe, beides
additiv.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Modell | eigene Tabelle `runLogs`, keine Workout-Session |
| Erfasste Werte | Strecke, Dauer (Pflicht); Höhenmeter, Ø Puls, Notiz (optional) |
| Pace | wird immer berechnet, nie gespeichert |
| Datum | lokaler Kalendertag (`YYYY-MM-DD`), nicht in der Zukunft |
| Änderbar? | ja, und löschbar – anders als abgeschlossene Sessions |
| Eingang | Knopf „Lauf eintragen“ auf **Heute**; Formular als Sheet |
| Anzeige | Verlauf: Wochenübersicht, Karte „Läufe“ mit Grafik und Liste; Detailseite `/runs/:runId` |
| Wochenvolumen | in der App (Verlauf, Heute) **und** im Export (`laeufe.csv`, `wochen.csv`) |
| Mobility | Workouts bekommen eine Art (`category`), Snapshot auf der Session |

Verworfen:

- **Lauf als Session mit Übung „Laufen“** – jede Regel der Session-Welt
  (Aufwärmsatz, Satzfortschritt, Restzeit-Prognose, Kraftvolumen) müsste einen
  Lauf kennen, und an jeder kann er still falsch zählen.
- **Allgemeine `cardioLogs` mit Feld `sport`** – kein Bedarf; ein späterer
  Umbau wäre additiv.
- **Belastungswert aus dem Puls (TRIMP o. ä.)** – bräuchte Ruhe- und
  Maximalpuls und wäre eine Formel, die die App erfindet.
- **Formular als eigene Seite `/runs/new`** – die Leiste über der Tastatur
  (`FieldNavigationBar`) gibt es nur im Sheet; die iOS-Zifferntastatur hat keine
  Return-Taste, und sechs Zahlenfelder ohne Sprung sind im Alltag unbrauchbar.

## 1. Datenmodell

```ts
interface RunLog {
  id: string;
  /** Lokaler Kalendertag des Laufs, `YYYY-MM-DD`, gelesen über `parseLocalDate`. */
  date: string;
  distanceKm: number;          // > 0
  durationSeconds: number;     // ganze Zahl > 0
  elevationGainM?: number;     // ganze Zahl ≥ 0; fehlt = nicht erfasst, nicht 0
  averageHeartRate?: number;   // ganze Zahl 30–250
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
```

- **Datum statt Zeitstempel.** Ein Lauf gehört zu einem Tag. `date` wird wie
  `Program.startedOn` gelesen und landet deshalb westlich von Greenwich nicht
  einen Tag zu früh. Zwei Läufe am selben Tag ordnet `createdAt`.
- **Pace** ist `durationSeconds / distanceKm`, formatiert von `formatPace`
  (`5:12 /km`). Sie wird nie gespeichert – eine korrigierte Strecke darf keine
  veraltete Pace stehen lassen.
- **Persistenz:** Dexie `version(5)` mit `runLogs: 'id, date'`, ohne
  `upgrade()`. Backup (`export.ts`): `runLogs` als
  `z.array(...).optional().default([])`, **ohne**
  `SNAPSHOT_SCHEMA_VERSION`-Erhöhung – alte Backups bleiben importierbar.
  `runLogs` verweist auf nichts, die Restore-Reihenfolge ist unkritisch.
  `restoreDatabaseSnapshot` und der lokale Reset leeren die Tabelle mit.

## 2. Schreib-API: `src/db/run-actions.ts`

- `createRunLog(input)` – prüft und legt an, liefert die Id.
- `updateRunLog(id, input)` – schreibt **nur übergebene Schlüssel**. Ein
  optionales Feld wird ausdrücklich mit `null` geleert, nie mit `undefined`
  (`Table.update` löscht bei `undefined` die Eigenschaft – hier wäre das
  zufällig richtig, aber dieselbe Regel wie überall hält die Lesart einfach).
- `deleteRunLog(id)`.

Validierung in der Action, Fehlermeldungen deutsch und für den Nutzer:

- Strecke fehlt oder ≤ 0 → „Bitte eine Strecke über 0 km eintragen.“
- Dauer fehlt oder ≤ 0 → „Bitte eine Dauer eintragen.“
- Datum ungültig → „Bitte ein gültiges Datum eintragen.“
- Datum nach heute (Ortszeit) → „Ein Lauf kann nicht in der Zukunft liegen.“
- Höhenmeter < 0 oder nicht ganzzahlig → „Höhenmeter bitte als ganze Zahl ab 0.“
- Puls außerhalb 30–250 → „Puls bitte zwischen 30 und 250.“

Die reinen Regeln (Dauer aus Std/Min/Sek, Pace, Prüfung) liegen in
`src/domain/run.ts`, die Action ruft sie nur.

## 3. Oberfläche

### Formular (Sheet)

[Sheet.tsx](../../../src/components/ui/Sheet.tsx) mit `fieldNavigation`, Komponente
`RunLogSheet`. Geöffnet über „Lauf eintragen“ auf Heute (neu) und über
„Bearbeiten“ auf der Detailseite (vorbefüllt).

Felder, in dieser Reihenfolge, alle über `TextField` mit echtem `<label>`:

1. **Datum** – `type="date"`, Vorgabe heute, `max` = heute.
2. **Strecke** (km) – `inputMode="decimal"`, Komma erlaubt.
3. **Dauer** – drei Felder **Std · Min · Sek** in einer Zeile,
   `inputMode="numeric"`. Ein einzelnes Feld „52:30“ geht nicht: die
   Zifferntastatur hat keinen Doppelpunkt. Min und Sek 0–59.
4. **Höhenmeter** – `inputMode="numeric"`.
5. **Ø Puls** (bpm) – `inputMode="numeric"`.
6. **Notiz** – `TextArea`.

Unter der Dauer steht die **Pace live** („5:12 /km“), sobald Strecke und Dauer
gültig sind – die schnellste Kontrolle auf Tippfehler. Eingaben laufen über
`parseNumberInput`, das „leer“ von „ungültig“ trennt; ein ungültiges Feld wird
am Feld markiert. Der große Knopf im Fuß („Lauf speichern“) ist gesperrt,
solange Strecke oder Dauer fehlen oder ein Feld ungültig ist. Ein Fehler aus
der Action erscheint im Sheet, das Sheet bleibt offen.

Auf Heute ist „Lauf eintragen“ ein **sekundärer** Knopf: die eine
Limettenfläche gehört der nächsten Einheit.

### Detailseite `/runs/:runId`

`RunDetailPage`: Datum, Strecke, Dauer, Pace, Höhenmeter, Ø Puls groß
(`font-display`, alle Zahlen über `formatNumber`), darunter die Notiz.
Aktionen „Bearbeiten“ (öffnet das Sheet) und „Löschen“ mit `ConfirmDialog` –
auf der Seite, nicht im Sheet, weil ein Dialog im Sheet zwei gestapelte Dialoge
wären. Nach dem Löschen zurück in den Verlauf. Eine unbekannte Id zeigt einen
`Empty`-Zustand mit Link zum Verlauf. Nicht erfasste Werte stehen als „–“.

### Verlauf

Der Verlauf ist nach Übungen gruppiert, nicht chronologisch. Neue Reihenfolge:

1. Die bestehende `DoneCard` (Zusammenfassung).
2. **Wochenübersicht** – die letzten 8 Kalenderwochen, neueste oben:

   ```
   KW 40 · 28.9.–4.10.
   Kraft     3 Einheiten · 3:10 h · 12.450 kg · 54 Sätze
   Mobility  1 Einheit · 0:25 h
   Laufen    2 Läufe · 14,2 km · 180 HM · 1:21 h
   ```

   Eine Zeile entfällt, wenn ihre Art in der Woche nichts hat; eine Woche ganz
   ohne Training bleibt als „Kein Training“ stehen – eine Lücke ist eine
   Aussage. Fehlende Höhenmeter: „≥ 180 HM“. Waldgrün nur für Wochen mit
   Training (erledigt), sonst neutral – eine gefüllte Fläche behauptet keinen
   Zustand, den es nicht gibt.
3. **Karte „Läufe“** – oben die Grafik, darunter die Liste (Datum · km ·
   Dauer · Pace · Ø Puls), jeder Eintrag mit Läufer-Icon als Link auf
   `/runs/:runId`. Ohne Läufe entfällt die Karte.

   Die installierte lucide-Version hat **kein** Läufer-Piktogramm (nur
   `Footprints` und `PersonStanding`). Deshalb entsteht `RunIcon`
   (`src/components/icons/RunIcon.tsx`): ein eigenes Inline-SVG im Strichstil
   von lucide (24er-Raster, `stroke="currentColor"`, `strokeWidth` 2, runde
   Enden), mit derselben Props-Form wie ein lucide-Icon. Teil 3 benutzt es im
   Kalender weiter.
4. Die Übungen wie bisher.

**Grafik:** Pace je Lauf über `ProgressChart` mit neuer Option
`lowerIsBetter` (dreht die y-Achse, damit „schneller“ nach oben zeigt) und
`formatValue` (`5:12`). Bekannte Grenze: ohne Lauftyp mischt die Kurve lockere
Läufe und Intervalle; den robusten Trend liefert die Wochen-km-Zeile. Teil 2
bringt den Plan-Typ als Filter.

### Heute

Die Wochenkarte („diese Woche“) zählt nach Art:
„3 Kraft · 1 Mobility · 2 Läufe · 14,2 km“. Sie liest dieselbe Rechnung wie die
Wochenübersicht.

## 4. Art des Workouts: Kraft oder Mobility

Mobility ist in der App ein normales Workout und würde ohne Unterscheidung die
Kraftzahlen aufblähen.

- `WorkoutTemplate.category?: 'strength' | 'mobility'` – fehlt = Kraft;
  `normalizeWorkoutCategory` schreibt nie `'strength'`, „Kraft“ hat genau eine
  Schreibweise (wie `normalizeTracksHeight`). Eingestellt in
  [TemplateDetailPage.tsx](../../../src/pages/TemplateDetailPage.tsx) über ein
  `SelectField` „Art“.
- `startSessionFromTemplate` kopiert sie als
  `WorkoutSession.templateCategorySnapshot`. `materializeSession` bleibt
  unverändert. Eine spätere Umstellung des Workouts verschiebt die
  Vergangenheit nicht.
- Unindiziert und additiv: kein Dexie-Index, `.optional()` im Backup, keine
  Versionserhöhung.
- **Bibliotheks-Import:** Workouts dürfen `category` tragen (`"mobility"`,
  `"strength"`); ein unbekannter Wert bricht den Import mit Zeilenangabe ab.
  Fehlt das Feld, bleibt die Art unverändert. Vorschau zeigt die Änderung wie
  jedes andere Feld.
- **Datenkorrektur** in [data-fix-actions.ts](../../../src/db/data-fix-actions.ts),
  hinter `ConfirmDialog` in den Einstellungen: „Art auf frühere Sessions
  übertragen“ setzt `templateCategorySnapshot` an jeder Session ohne Snapshot,
  deren Workout heute auf Mobility steht. Der Dialog nennt die Anzahl.
  „Erledigt“ wird aus den Daten abgeleitet (keine solche Session mehr), nicht
  gespeichert. Abgeschlossene Sessions bleiben ansonsten unberührt – der
  Snapshot beschreibt, was die Einheit *war*, und ändert keinen Messwert.

## 5. Wochenrechnung: `src/domain/weekly-volume.ts`

Eine reine Funktion, drei Leser: Verlauf, Heute, `wochen.csv` (in Teil 3 auch
der Kalender).

```ts
buildWeeklyVolume(input: {
  sessions: {
    id: string;
    startedAt: string;
    completedAt: string;
    category: 'strength' | 'mobility';
  }[];
  /** Abgehakte Arbeitssätze, schon der Session zugeordnet. */
  workSets: { sessionId: string; log: WorkoutSetLog }[];
  runs: RunLog[];
  from: Date; to: Date;          // Wochen dazwischen, auch leere
}): WeekVolume[]
```

- **Woche** = Kalenderwoche ab Montag, Ortszeit, über
  [calendar-week.ts](../../../src/domain/calendar-week.ts). Mit der
  Programmwoche hat sie nichts zu tun. Leere Wochen im Bereich sind enthalten.
- **Gezählte Sessions:** `status === 'completed'` **und** mindestens ein
  abgehakter Satz – dieselbe Auswahl, die `sessions.csv` nicht verwirft, damit
  App und Export dieselbe Zahl nennen. Woche nach `completedAt`, Art nach
  `templateCategorySnapshot` (fehlt = Kraft).
- **Dauer** = `completedAt − startedAt`, also inklusive Pausen.
- **Volumen** = `sumWorkVolume` über abgehakte Arbeitssätze (nur Kraft).
- **Sätze** = Anzahl abgehakter Arbeitssatz-Zeilen, eine je Seite – die Summe
  der Spalte `arbeitssaetze` aus `sessions.csv`.
- **Laufen:** Woche nach `date`; Summe von Strecke, Dauer, Höhenmeter. Ein Lauf
  ohne Höhenmeter zählt mit 0 und setzt `elevationIncomplete`.

## 6. Analyse-Export

[analysis-export.ts](../../../src/domain/analysis-export.ts) bekommt zwei
Dateien, im ZIP und im Zwischenablage-Text (`buildAnalysisPasteText`, nach
`meta.json`). `loadAnalysisFiles` lädt die Läufe, damit Archiv und
Zwischenablage nicht auseinanderlaufen. Der Export markiert weiterhin **kein**
Backup.

**`laeufe.csv`** – ein Lauf je Zeile, neueste zuerst:

```
datum,wochentag,strecke_km,dauer_sek,pace_sek_pro_km,hoehenmeter,puls_avg,notiz
```

**`wochen.csv`** – eine Zeile je Kalenderwoche über den ganzen Exportzeitraum,
leere Wochen als Nullzeile:

```
woche_beginn,kraft_einheiten,kraft_dauer_min,kraft_volumen_kg,kraft_arbeitssaetze,
mobility_einheiten,mobility_dauer_min,lauf_anzahl,lauf_km,lauf_hm,
lauf_hm_unvollstaendig,lauf_dauer_min
```

**`sessions.csv`** bekommt die Spalte `art` (`kraft` / `mobility`).

Zahlen mit Dezimalpunkt wie bisher, leeres Feld = nicht erfasst, Minuten
gerundet auf ganze. `meta.json` nennt den Zeitraum über Sessions *und* Läufe,
die Zahl der Läufe und beschreibt in einer Zeile, dass `kraft_dauer_min` die
Session-Dauer inklusive Pausen ist.

## 7. Architekturvertrag

Beide Kopien (`.claude/skills/gym-book-architect/SKILL.md` und
`.trae/skills/gym-book-pwa-architect/SKILL.md`) bekommen einen Abschnitt
„Läufe“: eigene Tabelle, keine Sätze und keine Session-Maschinerie, Pace wird
berechnet, Läufe sind änderbar, keine von der App erfundenen Pulsformeln. Die
v1-Liste „Must include“ ergänzt „run logging (distance, duration, elevation,
average heart rate)“. CLAUDE.md bekommt einen kurzen Abschnitt zu Läufen,
Wochenrechnung und Workout-Art.

## 8. Tests

**Domain** (`run.test.ts`, `weekly-volume.test.ts`, `analysis-export.test.ts`):
Dauer aus Std/Min/Sek, Pace und `formatPace`, Prüfregeln; Wochengrenze Montag
Ortszeit, Woche über die Zeitumstellung, abgebrochene Session zählt nicht,
Session ohne abgehakten Satz zählt nicht, Trennung Kraft/Mobility, fehlender
Snapshot = Kraft, `elevationIncomplete`, leere Wochen; Spalten und Werte von
`laeufe.csv`, `wochen.csv`, Spalte `art`; `normalizeWorkoutCategory`.

**DB** (`run-actions.test.ts`, bestehende Dateien erweitert): anlegen, ändern
nur übergebener Felder, Leeren mit `null`, löschen, jede Validierungsmeldung;
`startSessionFromTemplate` schreibt `templateCategorySnapshot`; Datenkorrektur
samt abgeleitetem Erledigt-Zustand; Backup-Roundtrip mit `runLogs` und ein
altes Backup ohne `runLogs`; Bibliotheks-Import mit `category`, auch ein
ungültiger Wert.

**E2E** (WebKit, beide iPhone-Größen, `e2e/run-log.spec.ts`): Lauf über Heute
eintragen, dabei mit der Tastaturleiste von Feld zu Feld springen; Live-Pace;
Eintrag erscheint im Verlauf; Detailseite, Bearbeiten, Löschen; die
Wochenübersicht läuft bei 320 px nicht über; der Analyse-Export enthält
`laeufe.csv` (über den Zwischenablage-Text).

## Nicht-Ziele

Stoppuhr oder GPS in der App, Strava- oder Uhren-Import, Herzfrequenzzonen,
Lauftypen (kommen mit dem Plan in Teil 2), geplante Läufe, Kalender-Icons,
andere Ausdauersportarten.
