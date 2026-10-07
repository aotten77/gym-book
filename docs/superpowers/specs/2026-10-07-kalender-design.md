# Kalender

Stand: 07.10.2026 · Status: Entwurf, abgestimmt im Gespräch (Entwürfe im visuellen Begleiter, iPhone-16-Abbildung)

## Ziel

Der Trainingskalender im Programm-Tab wird von einer Zustandsanzeige mit
Kreismarken zur Übersicht: auf einen Blick sehen, **was** an welchem Tag
geplant ist und was gemacht wurde, und von dort direkt zur Einheit kommen —
ansehen, starten, eintragen oder planen.

**Erfolg heißt:** Das Raster zeigt pro Tag Icons für Kraft, Mobility und
Laufen in zwei Zuständen; es funktioniert ohne Programm und nach
Programmende; die Liste darunter führt mit einem Tipp zu jeder Einheit; am
heutigen Tag lässt sich jede Einheit anlegen; die Wochenzahlen stehen unter
dem Raster.

## Einordnung: Teil 3 von 3

Teil 1: [Läufe erfassen](2026-10-04-laeufe-erfassen-design.md). Teil 2:
[Datierter Trainingsplan](2026-10-05-datierter-trainingsplan-design.md). Beide
sind umgesetzt und ausgeliefert. Teil 3 ist **reine Lese- und
Oberflächenarbeit**: kein neues Feld, keine neue Tabelle, keine
Dexie-Version, keine Änderung am Backup oder am Import.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Achse | Kalenderwochen rund um heute, nicht Programmwochen |
| Fenster | 6 Zeilen: letzte Woche, aktuelle, 4 weitere; ‹ › verschiebt um 4 Wochen |
| Zeilenbeschriftung | Montag als Datum („05.10.“), darunter Programmwoche („W2“, „W5 · Deload“), wenn ein Programm die Woche abdeckt |
| Zustände | nur *geplant* und *umgesetzt*; `verpasst` und `teilweise` entfallen |
| Icons | Kraft = Hantel, Laufen = Läufer (`RunIcon`), Mobility = offene Figur mit ausgebreiteten Armen (neu, `MobilityIcon`) |
| Tippmodell | Raster = Übersicht (Zeile wählt Woche), Liste darunter = Bedienung |
| Liste | Plan und Wirklichkeit gemeinsam, nach Tagen |
| Heute | „+ Einheit“ öffnet ein Sheet mit allen Workouts und „Lauf eintragen“, unabhängig vom Plan |
| Künftige Tage | „+ Termin“ öffnet das Termin-Sheet mit vorbelegtem Tag |
| Wochenzahlen | unter dem Raster, aus `loadWeeklyVolume` / `describeWeekVolume` |

Verworfen:

- **Jeder Tag als Knopf (Tages-Sheet aus der Zelle).** Sieben Kacheln bei
  320 px sind ca. 38 px breit und reißen die 44-px-Regel.
- **Nur eine Woche, Tage untereinander.** Gut bedienbar, aber der Blick über
  mehrere Wochen — der Grund für ein Raster — geht verloren.
- **Programmwochen als Achse (wie bisher).** Ohne Startdatum leer, nach
  Programmende veraltet; Termine, Läufe und Mobility hängen an keinem
  Programm.
- **Monatsblatt.** Wochenzahlen und die Liste der gewählten Woche passen
  nicht zu einem Monat.
- **Yoga-Motive (Lotussitz, Baum, Krieger, Lotusblüte), Wellen, Blatt** fürs
  Mobility-Icon — gewählt wurde die offene Figur mit kräftigem Rumpf.

## 1. Regeln und Daten (`src/domain/training-calendar.ts`)

Das Modul wird um Kalenderwochen herum neu geschnitten; `programWeekStart`,
`isoWeekday`, Wochentagsbeschriftungen und `normalizeScheduledWeekdays`
(Migration) bleiben.

- **`buildCalendarWeeks({ firstMonday, weeks, today, program, programWeeks,
  planEntries, planLinks, templates, completedSessions, runs, testDates })`**
  liefert `weeks` Zeilen ab `firstMonday` (lokales Datum, Weiterzählen per
  `setDate`). Jede Zeile: `start`, `end`, `isCurrent` (enthält heute),
  optional `programWeek: { number, label?, kind? }` — nur wenn das aktive
  Programm ein `startedOn` hat und die Woche in seine Spanne fällt —, sieben
  Tage, `hasTestAppointment`/`testDone` wie bisher (nur aus
  `ProgramWeek.kind`, rein beschreibend).
- **Ein Tag besteht aus Einheiten** `CalendarUnit { kind: 'strength' |
  'mobility' | 'run'; state: 'geplant' | 'erledigt'; name; ref }`, wobei
  `ref` sagt, wohin ein Tipp führt (Session, Lauf oder Termin).
  - *Erledigt* kommt aus dem Verlauf: abgeschlossene Sessions am lokalen Tag
    von `completedAt` (Art aus `templateCategorySnapshot`, fehlt = Kraft) und
    Läufe an ihrem `date`. Ein erledigter Termin erscheint **einmal** — über
    seine Session oder seinen Lauf, nicht zusätzlich als Termin.
  - *Geplant* sind Termine, die nicht erledigt sind, **ab heute**
    (einschließlich). Ein belegter Termin (laufende Session) zählt als
    geplant. Offene Termine in der Vergangenheit erscheinen nicht.
  - Die Art eines Workout-Termins kommt aus `WorkoutTemplate.category`
    (`resolveWorkoutCategory`); ein gelöschtes Workout zählt als Kraft.
  - Reihenfolge: erledigte zuerst (nach Zeit), dann geplante nach
    `orderInDay`.
- **Tageszustand** `data-day-state`: `erledigt`, sobald eine Einheit
  erledigt ist, sonst `geplant`, wenn eine geplant ist, sonst `leer`.
- **Zelle:** bis zu zwei Icons übereinander. Ab drei Einheiten steht an der
  zweiten Stelle „+n“ (n = übrige Einheiten). Die vollständige Aufzählung
  steht in der Liste.
- **`countWeekProgress`** bleibt: Termine *mit Datum in der Woche* und davon
  erledigte (auch an anderem Tag erledigt) — für die Ansage der Zeile.
- **Fenster:** `defaultFirstMonday(today)` = Montag der Vorwoche;
  `shiftWindow(firstMonday, ±4)` per `setDate`. Die Auswahl (Montag der
  gewählten Woche) ist ephemerer `useState` in `ProgramsPage`; beim Öffnen
  ist die aktuelle Woche gewählt. Raster und Liste teilen **diese eine**
  Auswahl — die eigene Wochenwahl von `PlanWeekSection` entfällt. Liegt die
  gewählte Woche nach einem Verschieben außerhalb des Fensters, wird die
  erste Woche des neuen Fensters gewählt.
- **Lesen:** `ProgramsPage` lädt für das Fenster `loadPlanBetween`,
  `loadCompletedSessionsBetween` (braucht zusätzlich
  `templateCategorySnapshot`), eine neue Abfrage `loadRunsBetween(from, to):
  Promise<RunLog[]>` (ersetzt `loadRunDatesBetween` an dieser Stelle, weil die
  Liste Strecke, Dauer und Titel braucht), `loadTestDatesBetween` und für die
  gewählte Woche
  `loadWeeklyVolume(weekStart, weekStart)`.

## 2. Oberfläche

### Raster (`TrainingCalendar.tsx`)

- Kopf: „Trainingskalender“ und Pfeile ‹ › (`IconButton`, Labels
  „Frühere Wochen“ / „Spätere Wochen“).
- Spaltenköpfe Mo–So; Zeile: links Datum des Montags (`font-display`,
  tabellarische Ziffern) und darunter klein `W2` bzw. `W5 · Deload`;
  rechts sieben Zellen.
- Icons 17 px im Kreis: *erledigt* = gefüllt Waldgrün (`success`) mit hellem
  Icon, *geplant* = Tinten-Ring auf Weiß. Leerer Tag = kleiner Punkt. Heute =
  Tinten-Ring um die Zelle.
- Die Zeile bleibt das 44-px-Tippziel und wählt die Woche (`role="tab"`).
  Gewählte Woche hinterlegt (`surface-raised`), aktuelle Woche umrandet.
  Zugänglicher Name: „05.10.–11.10. · W2 · diese Woche · 3 von 6 erledigt“;
  die Zellen bleiben `aria-hidden`.
- Testanker: `data-training-calendar`, `data-calendar-week` (Montag als
  `YYYY-MM-DD`), `data-calendar-day` mit `data-day-state` (`leer | geplant |
  erledigt`) und `data-calendar-today`, neu `data-calendar-unit` (Art) mit
  `data-unit-state`.
- Keine Limette im Raster: die eine Limettenfläche bleibt die `NowCard`.

### Wochenzahlen

Drei Kacheln unter dem Raster — Kraft, Mobility, Laufen — mit Icon und
den Texten aus `describeWeekVolume` (z. B. „1 · 4,2 t · 52 min“,
„20 min“, „7,0 km · 1 Lauf“). Leere Woche: „–“. Neutral (weiß), keine
Zustandsfarbe. Testanker `data-week-volume`.

### Tagesliste (`PlanWeekSection.tsx`, umgebaut)

- Überschrift „Woche 05.–11.10. · W2“. Für jeden Tag Mo–So eine Zeile mit
  Datum, am heutigen Tag die Marke „Heute“.
- Pro Einheit eine Zeile (≥ 44 px, besser 58 px) mit großem Icon, Name und
  einer Zeile Detail:
  - erledigt (Waldgrün, `DoneRow`-Stil): Session — Volumen und Dauer; Lauf —
    Strecke, Dauer, Pace; ungeplant erledigt bekommt „nicht geplant“.
  - geplant: Workout — Art und Übungsanzahl; Lauf — `describeRunTarget`.
    Heute mit „Starten“-Marke (Dekoration, die Zeile ist der Knopf).
- **Antippen:**

  | Zeile | Ziel |
  |---|---|
  | erledigte Session | `/history/session/:id` |
  | Lauf | `/runs/:id` |
  | laufende Session (belegter Termin) | `/session/:id` |
  | heute geplant, Workout | `startSessionFromTemplate(id, { planEntryId })` → Session |
  | heute geplant, Lauf | Lauf-Sheet mit `initialPlanEntryId` |
  | künftig geplant | `PlanEntrySheet` |

- **Pluszeilen:** heute „+ Einheit“ (Tinte gefüllt) → `TodayUnitSheet`;
  künftige Tage „+ Termin“ → `PlanEntrySheet` mit diesem Tag; vergangene Tage
  ohne Plus. Leerer Tag: „frei“.
- ↑/↓ für mehrere geplante Termine eines künftigen Tages bleiben (wie in Teil
  2). „Serie anlegen“ bleibt als Knopf unter der Liste; der
  Umwandlungs-Hinweis (`data-plan-weekday-hint`) bleibt.

### „+ Einheit“: `TodayUnitSheet` (neu)

`Sheet` „Heute trainieren“, Untertitel „Mi., 07.10. · unabhängig vom Plan“.
Zuerst die heute geplanten, offenen Workouts (mit „Starten“), dann alle
übrigen Workouts nach Name (mit Art-Icon und „zuletzt Mo“ aus
`loadTemplateRecency`), zuletzt „Lauf eintragen“. Ein Workout startet mit
`startSessionFromTemplate(id)` — die Zuordnungsregel aus Teil 2 verknüpft
dabei einen passenden Termin von selbst. Ist schon eine Session aktiv, führt
der Start zu ihr (bestehendes Verhalten).

### `ProgramsPage`

- Raster, Wochenzahlen und Liste stehen **immer**, auch ohne aktives
  Programm; „Kein Programm aktiv“ wird zu einer schmalen Zeile mit Link auf
  „Programm verwalten“. Der Hinweis „Noch kein Startdatum“ entfällt (ohne
  Startdatum fehlen nur die „W…“-Beschriftungen).
- Die `NowCard` sagt „Heute · erledigt“, wenn heute Termine standen und alle
  erledigt sind; „Heute · frei“ nur, wenn nichts geplant war.
- Die Wochenvorgaben-Karten (Progression) bleiben unter der Liste und
  folgen der Programmwoche der gewählten Woche; liegt sie außerhalb des
  Programms, entfallen sie.

## 3. Tests

**Domain (vitest):** vergangene offene Termine verschwinden, heutige und
künftige bleiben; ein erledigter Termin erscheint einmal; eine ungeplante
Session und ein ungeplanter Lauf erscheinen; Art einer Einheit (Snapshot,
Workout-Art, gelöschtes Workout, Lauf); Tageszustand; „+n“ ab drei
Einheiten; Programmwoche nur innerhalb der Spanne und nur mit `startedOn`;
`defaultFirstMonday` und `shiftWindow` über die Zeitumstellung (25.10.2026);
`countWeekProgress` unverändert.

**E2E (WebKit, zwei iPhone-Breiten):** Raster ohne Programm; Wochenwechsel
per Pfeil und per Zeile, die Liste folgt; „+ Einheit“ startet ein ungeplantes
Workout, das nach Abschluss in Raster und Liste als erledigt steht; „+ Termin“
an einem künftigen Tag mit vorbelegtem Datum; erledigter Lauf führt zur
Detailseite; bei 320 px kein waagerechter Überlauf; `program-calendar.spec.ts`
auf die neuen Zustände umgeschrieben; `plan-entries.spec.ts` an die gemeinsame
Wochenauswahl angepasst.

## 4. Doku

CLAUDE.md, Abschnitt „The training calendar“: neu schreiben (Kalenderwochen,
zwei Zustände, Einheiten, Tippmodell, `TodayUnitSheet`), nicht ergänzen. Den
„Outlook“-Satz entfernen. Architekturvertrag und `.trae`-Spiegel prüfen, ob
sie Kalenderdetails nennen, und gemeinsam anpassen.

## Nicht in Teil 3

- Kein Antippen einzelner Zellen oder Icons im Raster.
- Keine Wiederholungsregeln, keine automatische Verschiebung verpasster
  Termine.
- Kein Pace-Filter nach Lauftyp.
