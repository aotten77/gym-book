# Navigation neu: Zeitstrahl, Jetzt, Abgleich, Bestand

Stand: 19.11.2026 · Status: Etappe 1 umgesetzt, offene Fragen für Etappe 2 entschieden

## Ausgangslage

Die App hat sechs Tabs (Heute, Programm, Workouts, Übungen, Verlauf, Tests) plus Einstellungen hinter dem Zahnrad. Sie folgen den Entitäten statt den Fragen, die man der App stellt. Das führt zu diesen Befunden:

- Ein Workout lässt sich an vier Stellen starten (Heute, Programm-Tagesliste, Workouts-Tab, Workout-Detail), mit zwei Heuristiken. Der Workouts-Tab zeigt „Am längsten her“ in Lime und kennt den Plan nicht.
- „Diese Woche“ steht an fünf Stellen.
- Das Programm ist auf vier Orte verteilt: `/programs`, `/programs/manage`, Einstellungen › Programm und Workout-Detail › Wochenprogression.
- Es gibt keine chronologische Liste „was habe ich wann gemacht“. Fortschritt pro Übung steckt hinter „Verlauf anzeigen“ in der Stammdatenpflege.
- Tests haben einen eigenen Tab, obwohl sie nur alle paar Wochen vorkommen.
- Die Einstellungen sind zur Abstellkammer geworden (Bänder, Import, Programm, Export).

Die Session-Seite mit dem Fokus-Sheet gilt als gelungen und bleibt bis auf den Startpunkt (siehe unten) unverändert.

## Die wichtigste Randbedingung: geplant wird außerhalb der App

Der Nutzer plant in einem **claude.ai-Projekt** (Ziele, Gesundheitsdaten, Trainingshistorie). Von dort kommt ein **JSON** für den Bibliothek-Import: neue Übungen, geänderte Workouts, Termine. Zurück geht der Stand per **„Analyse kopieren“** (`copyAnalysisSnapshot`), eingefügt ins Eingabefeld des Projekt-Threads.

```
claude.ai-Projekt ─ JSON-Import ─▶ App: Plan ─▶ Training (geplant oder spontan) ─ „Analyse kopieren“ ─▶ claude.ai-Projekt
```

Daraus folgt: **Die App plant kaum noch selbst.** Import und Export sind zentrale Funktionen und keine Einstellungen.

## Zielstruktur

Tab-Leiste mit fünf Einträgen, die Mitte ist ein erhöhter Aktionsknopf:

| Tab | Frage | Inhalt |
|---|---|---|
| **Plan** | Was steht an, was war? | Zeitstrahl über Tage und Wochen, öffnet auf heute |
| **Fortschritt** | Werde ich besser? | Wochensummen (8 Wochen), „Steigerung möglich“, Kurven pro Übung, Läufe, Seitenvergleich |
| **▶ Jetzt** (Mitte) | Was mache ich jetzt? | Sheet: heute geplant, „Kurz & spontan“, Filter, Lauf/Test erfassen |
| **Abgleich** | Austausch mit dem Projekt | „Stand an Claude senden“ (= Analyse kopieren), Import einspielen (Datei/Einfügen + Vorschau), letzte Importe |
| **Bestand** | Was hat die App gespeichert? | Workouts, Übungen, Programm, Bänder: zum Nachschlagen und für kleine Korrekturen |
| ⚙ (Kopfzeile) | App selbst | Signale, Bildschirm, Backup, Speicher, Datenkorrekturen, Beispieldaten, Reset |

Der Streifen der laufenden Session über der Tab-Leiste bleibt (`ActiveSessionBar`).

## Plan (View 1)

- **Eine Liste**: oben Vergangenheit (Protokoll), in der Mitte heute, unten Zukunft. Sie öffnet auf heute. Ein „↓ Heute“-Pill erscheint, sobald man wegscrollt.
- **Reichweite**: nach vorn bis zum Ende der Woche, in der der letzte Termin liegt, mindestens bis Ende nächster Woche. Eine importierte 12-wöchige Laufvorbereitung ist damit vollständig sichtbar, ohne dass dahinter leere Wochen stehen. Nach hinten unbegrenzt mit Nachladen.
- **Wochenkopf** über jedem Montag: `17.–23.11. · W3 · diese Woche   1 von 4 ▬▭▭▭ ›`. Er gliedert die Liste und **klebt** beim Scrollen oben. Ein Tap öffnet das Wochen-Sheet. Die laufende Woche hat einen Tinten-Rahmen. Der Zähler ist `countWeekProgress`.
- **Tag**: Datumsspalte links, Einheiten rechts. Freie Tage als dünne gestrichelte Linie „frei“.
- **Einheit** in drei Zuständen, wie im heutigen Kalender:
  - erledigt: Waldgrün, Detailzeile aus `describeCalendarUnitDetail` (Volumen · Dauer, km · Pace, „nicht geplant“ bzw. „spontan“). Ein Tap öffnet `/history/session/:id` bzw. `/runs/:id`.
  - geplant: weiß mit Ring-Icon. Ein Tap öffnet den Termin **nur zum Lesen**: Termine werden in der App weder angelegt noch bearbeitet, verschoben oder gelöscht.
  - heute offen: **die erste** ist das eine Lime-Feld, die ganze Karte startet. Weitere offene von heute sind weiß mit „Start“/„Eintragen“ als Text. Eine laufende Session sagt „läuft · Satz 7 von 18“ und führt zurück.
- **Heute ohne Plan**: kein Lime. Stattdessen eine gestrichelte Zeile „Heute trainieren“ mit dem Hinweis „am längsten her: …“, die das Jetzt-Sheet öffnet.
- Vergangene offene Termine verschwinden wie heute. Erledigtes steht immer da, auch ungeplant.
- Die Backup-Erinnerung wandert als schmale Zeile an den Kopf des Plans.
- **Kein** „+ Termin“, **kein** „Serie anlegen“, kein Bearbeiten: geplant wird im Projekt. Ändert sich der Plan, kommt eine neue Importdatei. Wer einen Termin an einem anderen Tag derselben Woche trainiert, wird über `findMatchingPlanEntry` trotzdem zugeordnet; ein ausgelassener Termin verschwindet nach seinem Tag wie bisher.

## Wochen-Sheet (View 3)

Öffnet sich über den Wochenkopf. Mit ‹ › blättert man zur Nachbarwoche, ohne das Sheet zu schließen. Das ist reines Ansehen und schreibt nichts, genau wie die heutige ephemere Wochenauswahl.

- **Kacheln** Kraft / Mobility / Laufen als „erledigt / geplant“ (`1 / 2`, darunter kg bzw. km). Waldgrün erst, wenn in der Kachel etwas erledigt ist. In einer künftigen Woche steht nur „geplant“.
- **Testtermin** aus `ProgramWeek.kind === 'test'`, nur Anzeige. Waldgrün, sobald ein Test in der Woche liegt.
- **Vorgaben der Programmwoche** pro Workout über `buildWeekPlan` / `foldProgressionRule`. Felder aus der Wochenregel tragen ein Abzeichen `W4`, unveränderte Übungen sind eingeklappt („+ 3 weitere wie im Workout“). Gezeigt werden **nur Workouts mit Termin in dieser Woche**. Hat die Woche keine Termine, werden als Fallback alle Workouts gezeigt.
- **Nur lesen.** Das Bearbeiten-Sheet (heute `ProgressionRuleFields` im Programm-Tab) entfällt mit Etappe 2. Zielbild: Programm, Programmwochen und Wochenregeln kommen per Import. **Heute kann der Import das nicht** (er legt weder Programme noch Wochen noch Regeln an, `bestand.json` exportiert sie nur zur Information). Bis die eigene Etappe „Programm-Import“ (siehe Später) umgesetzt ist, bleiben `TemplateProgressionSection` im Workout-Detail und `/programs/manage` als Übergangs-Editoren stehen.
- Ohne Programmwoche (kein Programm, kein `startedOn`, außerhalb der Spanne) entfällt der Vorgaben-Block.

## Jetzt-Sheet

Mittlerer Tab-Knopf, von jedem Bildschirm aus erreichbar. Er ersetzt `TodayUnitSheet`, „Weitere Workouts“ und „Lauf eintragen“ auf Home.

- Oben die **heute geplante** offene Einheit (Lime), falls es eine gibt.
- Filter-Chips: Alle · Kurz · Mobility · Kraft (später Meditation).
- **„Kurz & spontan“** als Kacheln: Workouts mit geschätzter Dauer unter ~15 min (`estimateRemainingSessionSeconds` auf den Plan angewandt), z. B. Schreibtisch-Mobility.
- Danach die übrigen Workouts mit `zuletzt …` (`describeLastTrained`).
- Erfassen: Lauf (`RunLogSheet`), Seitenvergleich (Test-Formular).
- Gestartet wird **ohne** `planEntryId`, die Zuordnungsregel aus `findMatchingPlanEntry` verknüpft selbst. Die Einheit erscheint danach im Plan als erledigt, ohne Termin als „spontan“.

**Entscheidung: Ein Start öffnet direkt das Fokus-Sheet** auf dem ersten offenen Block. Das kehrt die bisherige Regel in CLAUDE.md um („never automatically on session start“). Die Antwort des Nutzers war „direkt in den Fokus-Sheet wechseln“. Der Umsetzungsplan soll klären, ob das für jeden Start gilt oder nur für Starts über „Jetzt“. Im Zweifel gilt es für jeden Start, denn so lautete die Antwort.

## Abgleich

- **„Stand an Claude senden“**: der Hauptknopf ist `copyAnalysisSnapshot`, ein Tap. Darunter steht „Zuletzt gesendet am … Seitdem: 4 Einheiten, 1 Lauf, 1 Test“. Dafür braucht es einen neuen Zeitstempel (z. B. `AppSettings.lastAnalysisCopiedAt`, additiv). Er darf **nicht** `lastBackupAt` sein, siehe CLAUDE.md, Analyse-Export. Die ZIP-Variante bleibt höchstens als Nebenknopf.
- **Import einspielen**: der bestehende `LibraryImportSection` (JSON-Datei oder Einfügen, Vorschau, Backup vor Entfernungen), herausgelöst aus den Einstellungen.
- **Letzte Importe** aus `libraryImports` (`LibraryImportLog`).

## Bestand

Workouts (Liste und Detail **ohne** Startknopf), Übungen (Formular, Bild, Anleitung), Programm (zusammengeführt aus `/programs/manage` und Einstellungen › Programm: aktives Programm, Startdatum, „Woche von Hand setzen“ als **einziger Schreiber** von `weekOverride`), Bänder. Wochenprogression „Übung × alle Wochen“ (`TemplateProgressionSection`) bleibt übergangsweise im Workout-Detail und entfällt mit dem Programm-Import, siehe oben.

## Fortschritt

Wochensummen (`buildWeeklyVolume`, `WeeklyVolumeList`), „Steigerung möglich“ (aus `progression-hint`), Übungen mit Kurve (`ProgressChart`, heute `ExerciseDetail` in `ExercisesPage`). Ein Tap auf eine Übung öffnet die Detailseite mit Kurve, letzten Einheiten und Link „Übung bearbeiten“ in den Bestand. Dazu Läufe (`RunHistoryCard`) und Seitenvergleich (Ergebnisse aus `TestsPage`).

## Was wohin wandert

| Heute | Neu |
|---|---|
| Heute-Tab | Plan (heutige Zeile, Wochenkopf) + Jetzt-Sheet |
| Programm-Tab: Raster, Wochensummen, Tagesliste | Plan |
| Programm-Tab: Vorgaben, Testtermin | Wochen-Sheet |
| Programm-Tab: Termin anlegen/bearbeiten, Serie | entfällt (Import) |
| `/programs/manage` + Einstellungen › Programm | Bestand › Programm |
| Workouts-Tab, Übungen-Tab, Einstellungen › Bänder | Bestand |
| Einstellungen › Bibliothek importieren, Backup › Analyse | Abgleich |
| Verlauf-Tab, Übungen › „Verlauf anzeigen“ | Fortschritt |
| Tests-Tab | erfassen: Jetzt-Sheet · Ergebnisse: Fortschritt · Termin: Wochen-Sheet |

## Später

- **Programm-Import** (eigene Etappe nach dem Zeitstrahl, eigene Spec): Der Bibliothek-Import lernt Programm, Programmwochen (Label, `kind`) und Wochenregeln pro Workout × Übung × Woche. Danach entfallen die Editoren in der App (`TemplateProgressionSection`, Programm-CRUD in `/programs/manage`), Bestand › Programm zeigt nur noch an. Offen für deren Spec: ersetzt oder ergänzt ein zweiter Import, wer setzt `startedOn` (heute schreiben es bewusst nur die Einstellungen), was passiert mit einem in der App angelegten Programm.
- **Meditation** als dritte Workout-Art neben Kraft und Mobility. Technisch ein Workout mit einer Übung auf Zeit, damit funktionieren Satz-Timer, Ansagen und Plan ohne neuen Mechanismus. Neu wären Kategorie, Icon (`UnitKindIcon`) und eine Spalte in `buildWeeklyVolume`.

## Entschieden am 19.11.2026 (für Etappe 2)

- **Reichweite des Strahls**: nach vorn bis zur Woche des letzten Termins, mindestens bis Ende nächster Woche; nach hinten unbegrenzt mit Nachladen. Nicht an das Programmende gekoppelt: Läufe hängen an keinem Programm, und eine Laufvorbereitung kommt als datierte Termine, nicht als Programm.
- **Termine nur lesen.** Geplant wird ausschließlich in claude.ai. `PlanEntrySheet` wird zur reinen Anzeige, `PlanSeriesSheet` und „+ Termin“ entfallen.
- **Wochenregeln**: Zielbild nur per Import, die App zeigt nur an. Weil der Import das heute nicht kann, kommt zuerst der Zeitstrahl (Etappe 2) und danach der Programm-Import als eigene Etappe; bis dahin bleiben `TemplateProgressionSection` und `/programs/manage` als Übergangs-Editoren.

## Offen für den Umsetzungsplan

6. Welche Abschnitte in CLAUDE.md umgeschrieben werden müssen: Home-Fälle, Programm-Tab/Kalender, „Never automatically on session start“, Tab-Labels, e2e-Anker.

## Mockups

Liegen im Orca-Chat-Ordner dieser Sitzung (nicht im Repo):
`~/Library/Application Support/orca/chat-scratch/1e1d241004e894a8ccab6115b3d8d2e8/`

- `navigation-konzepte-a1.html`: die drei Ausgangsrichtungen (gewählt: B, Zeitstrahl)
- `zeitstrahl-vertiefung-b2.html`: Gesamtablauf in acht Bildschirmen
- `plan-view1-view3-c3.html`: Plan und Wochen-Sheet im Detail. Achtung: „+ Termin“, „Serie anlegen“ und 3c (Regel bearbeiten) sind durch die Entscheidung oben überholt.
- `abgleich-jetzt-d4.html`: Jetzt-Sheet, Abgleich, Tab-Leiste mit fünf Einträgen
- **`finale-screens-e5.html`: der finale Stand aller elf Screens; maßgeblich für die Umsetzung**
