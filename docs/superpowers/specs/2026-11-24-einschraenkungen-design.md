# Einschränkungen: Pausen und Anpassungen über einen Zeitraum

Stand: 24.11.2026 · Status: Entwurf, abgestimmt im Grilling und in der
Rückfragen-Runde mit dem Trainings-Assistenten (Abschnitt 13)

Alle Beispiele in diesem Dokument sind erfunden. Das Repo ist öffentlich;
echte Gesundheitsangaben, Gründe und Termine gehören nur in die Nutzdaten und in
das claude.ai-Projekt, nie in Spec, Tests oder Fixtures.

## Ziel

Vorübergehende Änderungen am Training – „Sprungkniebeuge pausiert, bis die
Einschränkung endet“, „Kniebeuge bis zum 14.12. nur 40 kg, nur bis
Parallel“ – sind heute nur als Notiz an einem Termin oder als Umbau des
Workouts per Ersetzen möglich. Die Notiz liest im Training niemand (die
Session-Seite zeigt `PlanEntry.notes` nirgends an), und der Umbau muss nach
der Pause wieder zurückgebaut werden. In geführten Einheiten gibt es gar
keinen Weg, einen Schritt vorübergehend herauszunehmen.

Künftig kennt die App **Einschränkungen** als Daten: Sie pausieren oder passen
Ziele für einen Zeitraum an, ohne die Workouts anzufassen, sind im Training
ohne Lesen sichtbar und stehen im Analyse-Export getrennt von echtem
Auslassen.

**Erfolg heißt:** Eine Einschränkung kommt per Import, die betroffene Übung
steht in der nächsten Einheit sichtbar pausiert oder angepasst an ihrem Platz,
das Workout ist danach unverändert, und nach Ablauf oder Aufheben trainiert
die nächste Einheit wieder mit den alten Werten, als wäre nichts gewesen.
Weder die letzten Werte noch der Steigerungshinweis lernen aus der
Schonphase.

## Einordnung

- **Schritt 0: Banner für die Termin-Notiz.** Unabhängig von den
  Einschränkungen und klein; kommt zuerst (Abschnitt 10).
- **Phase 1: Einschränkungen** (dieses Dokument).
- **Zurückgestellt: Abweichungen pro Termin** (`overrides` an einem
  `planEntry`). Sie kommen erst, wenn ein echter Einzeltag-Fall auftaucht, den
  eine Einschränkung mit `from` = `until` nicht abdeckt.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Was eine Einschränkung tut | Ziele **pausieren** oder **anpassen**, über einen Zeitraum |
| Ziele einer Pause | Übung überall · Übung in einem Workout · Schritt eines geführten Workouts · Schritt in allen geführten Workouts |
| Ziele einer Anpassung | dieselben vier Formen |
| Anpassbare Werte (Übung) | `workSetCount`, `targetReps`, `targetRepsMax`, `targetSeconds`, `targetWeight`, `targetHeightCm`, `note`, `holdProgression` |
| Anpassbare Werte (Schritt) | `seconds`, `note` |
| Ersatzübung | optional an einer Pause einer Übung (`replacement`); steht in der Einheit direkt hinter der pausierten Übung |
| „Übung überall“ und Schritte | trifft keine geführten Schritte, auch bei gleichem Namen |
| Wann sie gilt | `from` ≤ Tag ≤ `until` (beide inklusive), nicht aufgehoben; ohne `until` bis zum Aufheben |
| Wann ausgewertet | beim Start der Einheit und beim Hinzufügen einer Übung, als Snapshot an der Session |
| Wer schreibt | Import legt an und ändert; die App kann nur **aufheben** (mit Rückfrage) |
| Aufheben | nur `lifted: true` bzw. der Knopf; ein vergangenes `until` heißt „abgelaufen“, nicht „aufgehoben“; nichts wird gelöscht |
| Wieder aktiv | nur mit ausdrücklichem `lifted: false`; ein fehlender Schlüssel ändert nichts |
| Überschneidung | Pause schlägt Anpassung; zwei Anpassungen, die am selben Ziel im selben Zeitraum **denselben Wert** setzen, brechen den Import ab; Notizen stapeln sich |
| „Angepasst“ | nur, wenn ein Wert **tatsächlich** vom Plan abweicht (Zuordnung plus Wochenregel); sonst `hinweis` bzw. `gehalten` |
| Wochenregel | die Anpassung gewinnt; der Wochenwert bleibt als „statt …“ sichtbar; `holdProgression` hält nur den Hinweis, nicht die Wochenregel |
| Letzte Werte, Steigerungshinweis | `angepasst`, `trotzdem` und `ausgenommen` zählen **nicht** (im Diagramm gekennzeichnet); `ersatz`, `gehalten` und `hinweis` zählen normal |
| Rückwirkend | der Import schreibt nie in Einheiten; in der Historie nimmt ein Schalter je Übung einer abgeschlossenen Einheit sie aus dem Leistungsstand („Zählt nicht als Leistungsstand“, zurücknehmbar) |
| Art einer Zeile im Export | genau eine, Rangfolge `pausiert` > `trotzdem` > `angepasst` > `ausgenommen` > `ersatz` > `gehalten` > `hinweis` |
| Pausierte Übung in der Einheit | mit Sätzen angelegt, markiert, beim Durchgehen übersprungen, aus dem Nenner von „unvollständig“ |
| „Trotzdem machen“ | Kraft ja, zurücknehmbar bis zum ersten abgehakten Satz; geführt nein |
| Supersatz | ein pausierter Partner fällt aus der Runde, der andere läuft allein mit eigener Pause |
| Farbe | neutrale Tinte, kein Lime, kein Grün, kein Rot |
| Startseite | neutrale Karte „Einschränkungen“ mit aktiven und angekündigten; ohne solche keine Karte |
| Speicherung | eigene Tabelle `restrictions`, DB-Version 8, in Backup und Wiederherstellung |
| Formatbeschreibung für den Assistenten | `docs/claude-projekt/import-format.md` im Repo, im selben Arbeitsschritt wie der Code geändert, Beispiele per Unit-Test geprüft |

Verworfen:

- **Abweichungen pro Termin als Hauptweg** – das Problem hat einen Zeitraum,
  keinen Tag. Pro Termin müsste dieselbe Abweichung in jeden Termin kopiert
  werden, und eine spontane Einheit ohne Termin bekäme sie nicht, weil ein
  Start seit dem 24.11.2026 nur noch den Termin von heute oder einen
  ausdrücklich gewählten verknüpft.
- **Live auswerten statt Snapshot** – eine Einheit, die gestern „pausiert“
  zeigte, darf nach dem Aufheben nicht nachträglich „ausgelassen“ zeigen.
  Gleiches Prinzip wie `resolvedProgramWeek`.
- **Enddatum in der App ändern** – zweite Stelle, an der der Plan entsteht.
  Verschiebt sich das Ende, sagt man es dem Planungsprojekt.
- **Kleinerer Wert gewinnt bei zwei Anpassungen** – eine erfundene Regel, die
  niemand sieht. Ein Abbruch mit benannter Zeile ist ehrlicher.
- **„Trotzdem“ in geführten Einheiten** – neue Bedienung vor dem Start für
  einen seltenen Fall; der Ablauf ist freihändig. Wer den Schritt will, hebt
  die Einschränkung auf.
- **Ziel-Band als anpassbarer Wert** – im Grilling noch genannt, aber der
  Import kann heute kein Ziel-Band setzen (`targetBand` ist im Bestand nur
  Information). Eine Anpassung kann es deshalb auch nicht. Kommt mit dem Tag,
  an dem der Import Bänder als Ziel setzen kann.
- **Ersatz als bedingte Zuordnung im Workout** (Idee B) – jeder Leser eines
  Workouts (Detailseite, Zeitschätzung, Bestand, Ersetzen-Modus) müsste
  Bedingungen verstehen. Der Ersatz gehört zur Einschränkung, nicht zum
  Workout.
- **Rückwirkend per Import markieren** – der Import schreibt nie in
  Einheiten; eine abgeschlossene Einheit ist Geschichte. Der Schalter in der
  Historie ist eine bewusste Handlung des Nutzers.

## 1. Datenmodell

### `Restriction` (neue Tabelle `restrictions`)

```ts
interface Restriction {
  id: string;
  /** Anzeigename und Identität im Import (über `normalizeImportKey`). */
  name: string;
  /** Freitext, nur in der App und im Export; nie im Repo. */
  reason?: string;
  /** Ortszeit-Tag `YYYY-MM-DD`, inklusive. */
  from: string;
  /** Ortszeit-Tag, inklusive; fehlt er, gilt die Einschränkung bis zum Aufheben. */
  until?: string;
  /** Gesetzt durch „Aufheben“ oder `lifted: true`; `lifted: false` entfernt ihn. */
  liftedAt?: string;
  pauses: RestrictionPause[];
  adjustments: RestrictionAdjustment[];
  createdAt: string;
  updatedAt: string;
}

/** Ohne templateId: überall. */
type ExerciseTarget = { exerciseId: string; templateId?: string };
/** Mit templateId: ein Schritt einer geführten Vorlage; ohne: in allen, auch künftigen. */
type StepTarget = { stepName: string; templateId?: string };

type RestrictionPause =
  | (ExerciseTarget & { replacement?: RestrictionReplacement })
  | StepTarget;

/** Die Ersatzübung einer pausierten Übung (Q1). */
interface RestrictionReplacement {
  exerciseId: string;
  workSetCount: number;
  targetReps?: number;
  targetRepsMax?: number;
  targetSeconds?: number;
  targetWeight?: number;
  targetHeightCm?: number;
  /** Fehlt sie, erbt der Ersatz die Pause der pausierten Übung. */
  restSeconds?: number;
}

type RestrictionAdjustment =
  | (ExerciseTarget & {
      workSetCount?: number;
      targetReps?: number;
      targetRepsMax?: number;
      targetSeconds?: number;
      targetWeight?: number;
      targetHeightCm?: number;
      note?: string;
      /** Unterdrückt nur den Steigerungshinweis, nicht die Wochenregel (Q5). */
      holdProgression?: boolean;
    })
  | (StepTarget & {
      /** Bei einem beidseitigen Schritt je Seite, wie `GuidedStep.seconds`. */
      seconds?: number;
      note?: string;
    });
```

- Ziele verweisen auf **Ids**, damit ein Umbenennen der Übung oder des Workouts
  die Einschränkung nicht bricht. Schritte haben keine Ids, sie werden über
  den Namen getroffen (`normalizeImportKey`).
- Ein Schrittziel ohne `templateId` trifft den Namen in **allen** geführten
  Vorlagen, auch in künftigen. Trifft es gerade nichts, bleibt es stehen und
  heißt im Sheet „trifft derzeit nichts“.
- Ein Ersatz gibt es nur an einer Pause einer Übung, nicht an einem Schritt.
- Die Ziele liegen als Listen am Datensatz, nicht in einer eigenen Tabelle –
  dieselbe Abwägung wie `WorkoutTemplate.steps`: Sie gehören zur
  Einschränkung, werden nie einzeln gelesen und mit ihr zusammen ersetzt.
- Store: `restrictions: 'id'`. Die Tabelle ist klein und wird ganz gelesen;
  kein Index auf `liftedAt` (sonst Boolean-ähnliche Abfragen, die IndexedDB
  nicht kann).
- `appDb.ts` bekommt `version(8)` mit der neuen Tabelle, **ohne
  `upgrade()`** – es gibt nichts umzubauen.
- Fallstrick: `liftedAt` wird beim Wieder-Aktivieren **gezielt** entfernt. Das
  ist der eine Fall, in dem `Table.update` mit `undefined` gewollt ist; im Code
  so kommentieren.

### Snapshot an `WorkoutSessionExercise`

Additive, optionale Felder (keine Migration, alte Zeilen haben sie nicht):

```ts
/** Namen der Einschränkungen, die die Übung beim Start pausiert haben. */
pausedBy?: string[];
/** Spätestes `until` der pausierenden Einschränkungen; fehlt bei offenem Ende. */
pausedUntil?: string;
/** Gesetzt bei „Trotzdem machen“; entfernt bei „Wieder pausieren“. */
pauseOverriddenAt?: string;
/** Namen aller Einschränkungen mit einer Anpassung an dieser Zeile, auch nur mit Notiz. */
adjustedBy?: string[];
/** Die Notizen der Anpassungen, je eine Zeile unter dem Übungsnamen; sie stapeln sich. */
adjustmentNotes?: { by: string; note: string }[];
/**
 * Nur die Werte, die die Anpassung **tatsächlich** geändert hat, mit ihrem
 * Wert vor der Anpassung (nach der Wochenregel) – das „statt …“. Leer oder
 * fehlend heißt: kein Wert weicht vom Plan ab.
 */
targetsBeforeAdjustment?: Partial<Pick<WorkoutSessionExercise,
  'workSetCount' | 'targetReps' | 'targetRepsMax' | 'targetSeconds' | 'targetWeight'
  | 'targetHeightCm'>>;
/** Gesetzt, wenn eine Anpassung `holdProgression` trägt: kein Steigerungshinweis. */
progressionHeld?: boolean;
/** Bei einem Ersatz: die Session-Zeile der pausierten Übung und der Name der Einschränkung. */
replacementFor?: { sessionExerciseId: string; restrictionName: string };
/** Gesetzt durch den Schalter in der Historie (Q2); entfernt beim Zurücknehmen. */
excludedFromProgressAt?: string;
```

Die Zielfelder der Session-Zeile tragen bereits die **angepassten** Werte;
`workSetCount` bestimmt, wie viele Sätze angelegt werden. Damit ist „trotzdem
machen“ bei pausiert + angepasst automatisch richtig (Q19): Es gelten die
angepassten Werte.

Abgeleitete Art einer Zeile (pure Funktion, für UI und Export). Es gilt die
erste zutreffende Zeile:

| Zustand | Art | zählt als Leistungsstand |
|---|---|---|
| `pausedBy` gesetzt, kein `pauseOverriddenAt` | `pausiert` | – (keine Sätze) |
| `pausedBy` und `pauseOverriddenAt` | `trotzdem` | nein |
| `targetsBeforeAdjustment` nicht leer | `angepasst` | nein |
| `excludedFromProgressAt` | `ausgenommen` | nein |
| `replacementFor` | `ersatz` | ja |
| `progressionHeld` | `gehalten` | ja, aber kein Hinweis in dieser Einheit |
| nur `adjustmentNotes` | `hinweis` | ja |
| nichts | – | ja |

`ausgenommen` steht unter `angepasst`, weil eine angepasste Zeile ohnehin
nicht zählt; der Schalter ist dort trotzdem setzbar und bleibt erhalten.

### Geführte Einheiten: `GuidedRun`

```ts
/** Beim Start herausgenommene Schritte, mit ihrer Position in der Vorlage. */
pausedSteps?: { index: number; step: GuidedStep; pausedBy: string[]; pausedUntil?: string }[];
/** Angepasste Schritte, `index` zählt in `steps` (den abgespielten). */
adjustedSteps?: {
  index: number;
  adjustedBy: string[];
  /** Nur gesetzt, wenn die Sekunden tatsächlich geändert wurden. */
  secondsBefore?: number;
  notes?: { by: string; note: string }[];
}[];
```

`GuidedRun.steps` enthält **nur die abgespielten** Schritte, mit den
**angepassten** Sekunden. Damit bleibt `guided-run.ts` (die Faltung über
Schritte und Ereignisse) unberührt; `pausedSteps` und `adjustedSteps` dienen
nur der Anzeige und dem Protokoll.

`GuidedProtocolEntry` bekommt optional `restrictedBy?: string[]` (Namen der
Einschränkungen, die den Schritt pausiert oder angepasst haben).
`plannedSeconds` ist bei einem angepassten Schritt der angepasste Wert.

### `LibraryImportLog`

Optional, fehlen bei älteren Zeilen: `createdRestrictions`,
`updatedRestrictions`, `liftedRestrictions`, `reactivatedRestrictions`.
`describeImportCounts` zählt sie mit, damit eine Datei, die nur aufhebt, nicht
„keine Änderungen“ heißt.

## 2. Pure Regeln: `src/domain/restriction.ts`

- `isRestrictionActive(restriction, day)` – nicht aufgehoben, `from ≤ day`,
  `until` fehlt oder `day ≤ until`.
- `describeRestrictionState(restriction, day)` – `aktiv` / `angekündigt`
  (`from` in der Zukunft) / `abgelaufen` / `aufgehoben`.
- `resolveRestrictionEffect({ restrictions, day, templateId, exerciseId })` –
  liefert `{ pausedBy, pausedUntil, replacements, adjustments }` für eine
  Zuordnung oder eine in der Session hinzugefügte Übung. Eine Pause „überall“
  und eine Pause im Workout greifen gleichermaßen. Ist die Übung pausiert,
  werden die Anpassungen trotzdem mitgeliefert (für „trotzdem“).
- `resolveGuidedSteps({ restrictions, day, templateId, steps })` – teilt die
  Schritte in abgespielte und pausierte, setzt die angepassten Sekunden und
  liefert `pausedSteps` und `adjustedSteps`. Pause schlägt Anpassung.
- `applyAdjustments(targets, adjustments)` – setzt die genannten Felder,
  sammelt die Notizen und gibt in `targetsBeforeAdjustment` **nur** die Felder
  zurück, deren Wert sich dadurch tatsächlich geändert hat. `targets` sind die
  Werte nach Zuordnung und Wochenregel.
- `findAdjustmentConflicts(restrictions)` – zwei nicht aufgehobene
  Einschränkungen mit sich überschneidendem Zeitraum, die am selben Ziel
  **denselben Wert** setzen („überall“ überschneidet sich mit jedem Workout,
  ein Schritt ohne Vorlage mit jeder Vorlage). Zwei reine Notizen oder zwei
  `holdProgression` sind kein Konflikt. Dazu zwei Ersatzübungen für dieselbe
  Übung im selben Geltungsbereich und Zeitraum. Grundlage des Import-Abbruchs.
- `sessionRestrictionKind(sessionExercise)` – die Art aus der Tabelle oben.
- `isRestrictedExecution(sessionExercise)` – Art `trotzdem`, `angepasst` oder
  `ausgenommen`. Einzige Stelle, die über „zählt nicht als letzte Werte“
  entscheidet.

## 3. Start und laufende Einheit

### Materialisieren

`materializeSession` bleibt frei von Dexie und Datum: `startSessionFromTemplate`
liest die Einschränkungen zusammen mit den Wochenregeln (vor der Transaktion,
wie diese), löst sie mit `resolveRestrictionEffect` für den **Starttag** auf
und reicht das als pure Funktion herein – parallel zu
`progressionRulesByTemplateExerciseId`.
Reihenfolge der Zielwerte: Zuordnung → Wochenregel → Anpassung.
`holdProgression` ändert keinen Wert; die Wochenregel gilt weiter. Wer den
Wert festhalten will, setzt zusätzlich den Zielwert.

`addSessionExercise` löst die Einschränkungen für den heutigen Tag genauso
auf (Q20). Eine Übung, die schon in der Session steht, wird **nicht** neu
ausgewertet.

### Ersatzübung

- Beim Start legt `materializeSession` für jede pausierte Zuordnung mit
  Ersatz eine Session-Übung **direkt dahinter** an: `addedInSession: false`,
  ohne `sourceTemplateExerciseId`, mit `replacementFor`, den Zielwerten und
  `workSetCount` aus dem Ersatz, `restSeconds` aus dem Ersatz oder sonst von
  der pausierten Zeile. Aufwärmsatz wie bei `addSessionExercise`. Das Workout
  bleibt unverändert. Wurde ein Ersatz eingefügt, werden die `orderIndex` der
  Session dicht `1..n` neu nummeriert; ohne Ersatz bleiben sie wie bisher.
- Keine Wochenregeln für den Ersatz – er hat keine Zuordnung.
- Einschränkungen, die die **Ersatzübung** selbst betreffen, werden für sie
  aufgelöst wie bei `addSessionExercise`; sie kann also selbst pausiert oder
  angepasst sein.
- Supersatz: Der Ersatz übernimmt die `supersetGroupId` der pausierten
  Übung und nimmt in der Runde ihren Platz ein.
- „Trotzdem machen“ an der pausierten Übung lässt den Ersatz stehen; im
  Supersatz sind dann beide in der Runde. Wer den Ersatz nicht will,
  überspringt ihn wie jede andere Übung.
- Der Ersatz ist eine normale Ausführung seiner Übung: Er zählt als letzte
  Werte und für den Steigerungshinweis.

### Durchgehen

- `findNextOpenExercise` und `resolveNextFocus` behandeln `pausiert` wie
  `wasSkipped`: nicht offen, wird übersprungen.
- `session-summary.ts`: eine pausierte Übung gilt als erledigt im Sinne von
  „nichts mehr offen“, mit eigener Kennzeichnung (nicht „übersprungen“).
- Supersatz: Die Runde besteht nur aus den nicht pausierten Mitgliedern; ist
  nur eins übrig, läuft es als Einzelübung mit seiner eigenen `restSeconds`.
  `supersetGroupId` bleibt an allen Zeilen stehen.

### Schreib-API (`src/db/session-actions.ts`)

- `overrideSessionExercisePause(sessionExerciseId)` – setzt
  `pauseOverriddenAt`.
- `restoreSessionExercisePause(sessionExerciseId)` – entfernt es; wirft mit
  deutscher Meldung, sobald ein Satz der Übung abgehakt ist.
- `setSessionExerciseExcludedFromProgress(sessionExerciseId, excluded)` –
  setzt oder entfernt `excludedFromProgressAt`; nur an einer
  **abgeschlossenen** Einheit, sonst wirft es. Es ist die eine bewusste
  Ausnahme von „eine abgeschlossene Einheit ist Geschichte“: Kein Wert, kein
  Satz, keine Zielgröße ändert sich, nur die Markierung. Der
  Architekturvertrag bekommt dazu einen Satz.

Alle ändern nie das Workout.

## 4. Oberfläche Kraft-Einheit

- **Liste:** Eine pausierte Übung steht an ihrem Platz, ausgegraut, eingeklappt,
  mit Etikett „Pausiert bis 14.12. · Beispiel A“ bzw. „Pausiert · Beispiel
  A“. Mehrere Namen werden mit Komma getrennt. Neutrale Tinte wie
  „Altdaten“ – kein `danger`, kein `highlight`.
- **Tipp aufs Etikett:** kleines Sheet mit Name(n), Grund, Zeitraum und dem
  Knopf „Trotzdem machen“. Danach Etikett „Trotzdem · Beispiel A“ und
  „Wieder pausieren“, solange kein Satz abgehakt ist.
- **Angepasst:** Unter dem Übungsnamen, in Liste und Fokus-Sheet, eine Zeile
  „40 kg statt 45 · Beispiel A“ (nur die tatsächlich geänderten Felder,
  Zahlen über `formatNumber`), darunter jede Notiz einer Anpassung als eigene
  Zeile – nicht nur hinter dem „i“. Eine Anpassung nur mit Notiz zeigt nur
  die Notiz, ohne „statt“-Zeile.
- **Gehalten:** Kein Steigerungshinweis an dieser Übung in dieser Einheit;
  das Etikett sagt „Steigerung gehalten · Beispiel A“.
- **Ersatz:** Etikett „Ersatz für Sprungkniebeuge · Beispiel A“ unter dem
  Namen der Ersatzübung.
- **Historie** (`HistorySessionPage`): dieselben Etiketten, damit eine alte
  Einheit erklärt, warum eine Übung fehlt oder leichter war. Dazu je Übung
  einer abgeschlossenen Einheit der Schalter „Zählt nicht als
  Leistungsstand“ (zurücknehmbar, ohne Rückfrage, weil nichts verloren geht);
  gesetzt zeigt die Übung das Etikett „Nicht als Leistungsstand“. Nicht an
  pausierten Zeilen (sie haben keine Sätze).
- Die Session-Seite wird **nicht** umgebaut (`session-screen.md`): Liste außen,
  Fokus-Sheet innen, ein großer Satz.

## 5. Geführte Einheiten

- `startGuidedSession` löst `resolveGuidedSteps` für den Starttag auf und
  schreibt `steps` (abgespielt, mit angepassten Sekunden), `pausedSteps` und
  `adjustedSteps`.
- **Startbildschirm:** Die Schrittliste zeigt pausierte Schritte an ihrem
  Platz, ausgegraut, mit Etikett; die Gesamtdauer (`summarizeGuidedSteps`)
  rechnet nur die abgespielten, mit den angepassten Sekunden. Sind alle
  Schritte pausiert, ist Starten gesperrt, mit Text statt Knopf. Ein
  angepasster Schritt zeigt „30 s statt 45 · Beispiel A“ und seine Notizen
  als eigene Zeilen.
- Kein „trotzdem“. Sind alle Schritte pausiert, wirft auch
  `startGuidedSession` („Heute sind alle Schritte pausiert.“).
- **Ansagen:** Sie nennen die Dauer („Als Nächstes: Taubenpose, 30
  Sekunden“). Die Texte, die eine Vorlage braucht, sind deshalb die ihrer
  Schritte **plus** die der heute wirksamen Schritte; „Ansagen erzeugen“ auf
  dem Startbildschirm erzeugt die fehlenden mit. Ohne erzeugte Ansage läuft
  die Einheit wie bisher mit „Nur Ton“.
- **Bühne** (`/guided/run/…`): kennt pausierte Schritte nicht. Die Notiz
  eines angepassten Schritts steht während des Schritts als Textzeile unter
  dem Namen. **Keine Ansage** der Notiz: Die Ansagen sind vorab erzeugte
  MP3s, eine Notiz aus dem Import hätte keine.
- `completeGuidedSession` schreibt für jeden pausierten Schritt (je Seite bei
  `bothSides`) eine Protokollzeile mit neuem Status `paused`
  (`GuidedProtocolStatus` wird erweitert), `ist_sekunden` 0, und setzt
  `restrictedBy` an pausierten und angepassten Zeilen. `stepIndex` ist in
  jeder Protokollzeile die Position in der **Vorlage**, nicht in den
  abgespielten Schritten, damit `schritt_nr` im Export stabil bleibt.

## 6. Letzte Werte, Steigerungshinweis, Diagramm

- `loadLastValuesForExercises` überspringt Ausführungen mit
  `isRestrictedExecution` und nimmt die letzte ohne Einschränkung.
- Der Steigerungshinweis vergleicht gegen dieselbe Ausführung; er wird für
  eine Übung der Art `trotzdem`, `angepasst` oder `gehalten` in der laufenden
  Einheit nicht angezeigt.
- `buildProgressSeries` behält die Punkte (echte Messwerte), markiert die
  von `isRestrictedExecution` aber; das Diagramm zeigt sie abgesetzt, die
  Legende sagt „unter Einschränkung“. Der Schalter in der Historie wirkt
  sofort auf Diagramm, letzte Werte und Steigerungshinweis.
- Architekturvertrag, Abschnitt „History and ‚last values‘“, bekommt den Satz:
  *eine Ausführung unter Einschränkung (angepasst, trotzdem trotz Pause oder
  in der Historie ausgenommen) zählt nicht als letzte Werte und nicht für den
  Steigerungshinweis; ein Ersatz zählt normal*.

## 7. Außerhalb der Einheit

- **Plan-Seite (`/`):** neutrale Karte „Einschränkungen“, nur wenn es aktive
  oder angekündigte gibt. Je Zeile: Name, „bis 14.12.“ / „ab 01.12.“ /
  „ohne Enddatum“, Zahl der Ziele. Tipp öffnet ein Sheet mit Grund, Zeitraum,
  den Zielen in Klarnamen und „Aufheben“ hinter einem `ConfirmDialog`.
  `liftRestriction(id)` in `src/db/restriction-actions.ts` ist der einzige
  Schreibweg der App.
- **Workout-Detail:** neutrales Etikett an jeder heute betroffenen Übung bzw.
  jedem Schritt („Pausiert bis … · Ersatz: Ausfallschritt“, „Angepasst:
  40 kg“, „Hinweis“, „Steigerung gehalten“, „30 s statt 45“).
- **Jetzt-Sheet:** an der Workout-Karte eine Zeile „1 Übung pausiert · 1
  angepasst“, berechnet für den Tag des Termins (bei Nachholen/Vorziehen für
  heute, weil die Einheit heute startet). Gezählt werden nur `pausiert` und
  tatsächlich `angepasst`.
- **Zeitschätzung** (`session-estimate.ts`): pausierte Übungen fallen heraus
  wie übersprungene, ein Ersatz kommt mit seinen Sätzen dazu; geführte Dauer
  siehe Abschnitt 5.
- **Sheet einer Einschränkung:** Ziele in Klarnamen, je mit Ersatz und
  angepassten Werten; tote Ziele „gibt es nicht mehr“, Schrittziele ohne
  Treffer „trifft derzeit nichts“, beide ausgegraut und nicht mitgezählt.
- **Wochen-Sheet:** nichts.

## 8. Bibliotheks-Import: Block `restrictions`

```json
"restrictions": [
  {
    "name": "Beispiel A",
    "reason": "Erfundener Beispielgrund.",
    "from": "2026-12-01",
    "until": "2026-12-14",
    "pauses": [
      {
        "exercise": "Sprungkniebeuge",
        "replacement": { "exercise": "Step-up", "workSetCount": 3, "targetReps": 8 }
      },
      { "template": "Einheit B", "exercise": "Ausfallschritt rückwärts" },
      { "template": "Mobility geführt", "step": "Tiefe Hocke" },
      { "step": "Kosakenhocke" }
    ],
    "adjustments": [
      { "exercise": "Kniebeuge (LH)", "targetWeight": 40, "note": "nur bis Parallel" },
      { "exercise": "Beinpresse", "holdProgression": true },
      { "exercise": "Hip Thrust", "note": "nicht ganz strecken" },
      { "step": "Taubenpose", "seconds": 30, "note": "langsam ausführen" }
    ]
  }
]
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `name` | ja | Identität (`normalizeImportKey`); gleicher Name aktualisiert |
| `reason` | nein | Freitext; `null` leert |
| `from` | ja (beim Anlegen) | `YYYY-MM-DD`, inklusive |
| `until` | nein | `YYYY-MM-DD`, inklusive; `null` macht das Ende offen |
| `lifted` | nein | `true` hebt auf, `false` aktiviert wieder; fehlt: keine Änderung |
| `pauses` | nein | ersetzt die Liste **ganz**, wenn genannt; fehlt: unverändert |
| `adjustments` | nein | ersetzt die Liste **ganz**, wenn genannt; fehlt: unverändert |

Ziele, genau eine Form je Eintrag, für Pausen und Anpassungen gleich:
`{ "exercise" }` (überall), `{ "template", "exercise" }`,
`{ "template", "step" }`, `{ "step" }` (alle geführten Vorlagen, auch
künftige).

- **Pause einer Übung:** optional `replacement` mit `exercise` und
  `workSetCount` (Pflicht), optional `targetReps`, `targetRepsMax`,
  `targetSeconds`, `targetWeight`, `targetHeightCm`, `restSeconds` (fehlt:
  Pause der pausierten Übung). An einem Schritt bricht `replacement` ab.
- **Anpassung einer Übung:** mindestens eines von `workSetCount`,
  `targetReps`, `targetRepsMax`, `targetSeconds`, `targetWeight`,
  `targetHeightCm`, `note`, `holdProgression: true`.
- **Anpassung eines Schritts:** mindestens eines von `seconds` (ganze Zahl
  über 0, bei beidseitigen je Seite) und `note`. Übungswerte an einem Schritt
  oder `seconds` an einer Übung brechen ab.
- Zahlen mit denselben Grenzen wie bei `templateAssignments` bzw. `steps`.

Regeln:

- Namen von Übungen, Workouts und Schritten werden aufgelöst wie bei
  Zuordnungen; eine Übung oder ein Workout, die dieselbe Datei anlegt, zählt.
- `{ "step" }` ohne Vorlage muss beim Import **mindestens einen** Schritt in
  einer geführten Vorlage treffen (Bestand oder dieselbe Datei). Die
  Schutzregel gegen verlorene Schritte (Nachträglich entschieden, 2) gilt
  dafür nicht, nur für `template` + `step` – bei Pausen wie bei
  Anpassungen.
- Ein `from` in der Vergangenheit ist erlaubt. Es wirkt nur auf Einheiten,
  die ab dem Import starten; schon gespeicherte bleiben unverändert. Die
  Vorschau sagt das ausdrücklich („gilt ab 20.11.; bereits gespeicherte
  Einheiten ändern sich nicht – in der Historie ausnehmen“).
- **Vorschau:** `NEU`, `AKTUALISIERT` (Feld: alt → neu, Ziele als Liste),
  `AUFGEHOBEN`, `WIEDER AKTIV`, `UNVERÄNDERT`. Je Einschränkung die Ziele in
  Klarnamen (mit Ersatz und Werten) und der Zustand nach dem Import (aktiv,
  angekündigt, abgelaufen).
- `planLibraryImport` plant den Block mit; `applyLibraryImport` plant ihn
  innerhalb der Transaktion neu, wie alle Blöcke.
- Alle Objekte des Blocks `restrictions` sind streng (`.strict()`): ein
  vertippter Feldname bricht ab, statt still zu fehlen.
- `restrictions` **ohne `.default([])`** im Schema, damit der Hash alter
  Dateien gleich bleibt (Golden-Hash-Test).
- `LIBRARY_IMPORT_SCHEMA_VERSION` bleibt `1`.

Abbruch mit benannter Zeile („Einschränkung 1, Pause 2: …“):

- `name` fehlt oder ist zweimal in der Datei;
- `from` fehlt bei einer neuen Einschränkung; ungültiges Datum; `until` vor
  `from`;
- eine neue Einschränkung ohne ein einziges Ziel;
- unbekannte Übung (auch als Ersatz), unbekanntes Workout, unbekannter
  Schritt; ein `{ "step" }`, der in keiner geführten Vorlage vorkommt;
- `step` an einem Workout ohne `steps`; `exercise` mit `template`, wenn das
  Workout diese Übung nicht enthält (auch nicht durch dieselbe Datei);
- ein Ziel zweimal in derselben Pausen- bzw. Anpassungsliste;
- eine Anpassung ohne Wert, Notiz oder `holdProgression`; Übungswerte an
  einem Schritt, `seconds` an einer Übung; `replacement` an einem Schritt;
  ein Ersatz ohne `workSetCount`;
- zwei Anpassungen, die am selben Ziel mit sich überschneidendem Zeitraum
  denselben Wert setzen, oder zwei Ersatzübungen für dieselbe Übung (Datei
  und Bestand zusammen, `findAdjustmentConflicts`);
- ein unbekannter Schlüssel auf oberster Ebene (außer `_hinweis`);
- ein `steps`-Import, der einen pausierten oder angepassten Schritt
  (`template` + `step`) verliert, ohne dieselbe Einschränkung mitzuändern
  (siehe „Nachträglich entschieden“).

## 9. Backup und Analyse-Export

**Backup:** `restrictions` kommt in `createDatabaseSnapshot`, in das Zod-Schema
in `export.ts` (als `.optional()`, damit ältere Backups gültig bleiben), in
`restoreDatabaseSnapshot` (leeren und schreiben) und in die Zählung der
Wiederherstellung. „Alle Daten löschen“ leert die Tabelle ohnehin.

**Analyse-Export:**

- `sessions.csv`: drei Spalten **am Ende**, in dieser Reihenfolge:
  `einschraenkung` (Name bzw. Namen), `einschraenkung_art` (eine Art aus der
  Rangfolge `pausiert` > `trotzdem` > `angepasst` > `ausgenommen` > `ersatz` >
  `gehalten` > `hinweis`, sonst leer) und `ersatz_fuer` (bei einem Ersatz der
  Name der pausierten Übung, sonst leer). Eine pausierte Übung bekommt eine
  Zeile, wie heute eine übersprungene. `uebersprungen` bleibt für echtes
  Auslassen. Beim Anteil abgeschlossener Sätze (`MINIMUM_COMPLETION_RATIO`)
  fällt eine pausierte Übung aus dem Nenner wie eine übersprungene; ein
  Ersatz zählt wie jede andere Übung.
- `protokoll.csv`: Status `pausiert` für nicht abgespielte Schritte; neue
  Spalte `einschraenkung` **am Ende** (Namen aus `restrictedBy`, sonst
  leer). `soll_sekunden` ist bei einem angepassten Schritt der angepasste
  Wert.
- `meta.json`: `einschraenkungen` – alle, die im Exportzeitraum galten oder
  heute aktiv bzw. angekündigt sind, mit `name`, `grund`, `von`, `bis`,
  `aufgehoben_am`, `zustand`, `ziele` (Klarnamen, mit Ersatz und Werten).
  Dazu ein `hinweis`: Werte mit `einschraenkung_art` `angepasst`, `trotzdem`
  oder `ausgenommen` sind kein Leistungsstand; `ersatz`, `gehalten` und
  `hinweis` sind es.
- `bestand.json`: Block `restrictions` in **Importform**, alle nicht
  aufgehobenen und nicht abgelaufenen. `library-inventory.test.ts` liest den
  Bestand weiterhin als Import zurück und verlangt *keine Änderung*.

## 10. Schritt 0: Banner für die Termin-Notiz

- **Kraft:** Ist die Session mit einem Termin verknüpft (`planEntryId`) und
  hat der Termin `notes`, steht oben auf der Session-Seite ein Banner mit der
  Notiz. Ein Tipp blendet es aus; das ist Komponenten-Zustand, nach einem
  Reload steht es wieder da.
- **Geführt:** Der Startbildschirm zeigt die Notiz des Termins, den der Start
  verknüpfen würde – den ausdrücklich gewählten aus dem Jetzt-Sheet
  (`location.state`), sonst den offenen Termin von heute (dieselbe pure Regel
  wie `findPlanEntryForStart`).
- Spontane Einheiten ohne Termin zeigen nichts.
- Neutral, kein Lime.

## 11. Tests

Unit (`domain/`, `db/`, Import, Export):

- `restriction.test.ts`: aktiv/angekündigt/abgelaufen/aufgehoben an den
  Grenztagen; Pause überall vs. im Workout; Pause schlägt Anpassung;
  `applyAdjustments` mit `targetsBeforeAdjustment` (nur echte Abweichungen,
  Anpassung gleich Wochenwert ist keine); gestapelte Notizen; Konfliktsuche
  inklusive „überall“ gegen Workout, `{ step }` gegen Vorlage, verschiedene
  Werte kein Konflikt, zwei Ersatzübungen ein Konflikt;
  `sessionRestrictionKind` in jeder Stufe der Rangfolge;
  `isRestrictedExecution`.
- `session.test.ts`: Materialisieren mit Wochenregel **und** Anpassung
  (Anpassung gewinnt, „statt“ ist der Wochenwert); `workSetCount` angepasst;
  `holdProgression` lässt die Wochenregel wirken; Ersatz direkt hinter der
  pausierten Übung mit geerbter Pause; Ersatz im Supersatz;
  `findNextOpenExercise` überspringt pausierte; Supersatz mit pausiertem
  Partner.
- `session-actions`: Start schreibt den Snapshot; Aufheben nach dem Start
  ändert die laufende Session nicht; `addSessionExercise` wertet aus;
  „Wieder pausieren“ nach abgehaktem Satz wirft; „trotzdem“ lässt den Ersatz
  stehen; der Historien-Schalter wirft an einer laufenden Einheit und lässt
  Sätze unverändert.
- `history-queries`: letzte Werte überspringen `angepasst`, `trotzdem` und
  `ausgenommen`, nehmen `ersatz`, `gehalten` und `hinweis`.
- `guided-session-actions` / `guided-steps`: pausierte Schritte fehlen in
  `steps`, stehen in `pausedSteps`; angepasste Sekunden in `steps`,
  `adjustedSteps` mit `secondsBefore` nur bei echter Änderung; `{ step }`
  trifft mehrere Vorlagen; Protokoll mit `paused` und `restrictedBy`;
  Gesamtdauer.
- `import-format.test.ts`: jeder ```json-Block aus
  `docs/claude-projekt/import-format.md` geht durch den Parser.
- `library-import.test.ts` / `-actions.test.ts`: jede Abbruchregel; Vorschau
  aller fünf Zustände; zweiter Import unverändert; `lifted` beide Richtungen;
  Golden Hash alter Dateien unverändert; fehlgeschlagener Import schreibt
  nichts; unbekannter Schlüssel bricht ab, `_hinweis` nicht; `steps`-Import
  ohne pausierten Schritt bricht ab, mit geänderter Einschränkung nicht;
  totes Ziel fehlt in `bestand.json`; `{ step }` ohne Treffer bricht ab;
  falsche Werte je Zielform brechen ab; `from` in der Vergangenheit mit
  Hinweis in der Vorschau.
- `analysis-export.test.ts`: neue Spalten am Ende, jede Art, `ersatz_fuer`,
  Nenner, `protokoll.csv` mit `einschraenkung`, `meta.json`;
  `library-inventory.test.ts`: Rückimport ohne Änderung, auch mit Ersatz,
  `{ step }` und Schrittanpassung.
- `export.test.ts`: Backup und Wiederherstellung mit und ohne `restrictions`.

E2E (WebKit): pausierte Übung in der Liste, Fokus springt darüber,
„trotzdem“ und zurück; Ersatz hinter der pausierten Übung; angepasste Übung
mit „statt“-Zeile; geführter Start mit pausiertem und angepasstem Schritt
und kürzerer Dauer; Notiz auf der Bühne; Schalter in der Historie; Karte auf
der Plan-Seite mit Aufheben; Banner der Termin-Notiz; alles bei 320px ohne
Überlauf.

Alle Testdaten erfunden.

## 12. Doku

- Neu: `docs/architecture/restrictions.md`, plus Zeile in der Tabelle in
  `CLAUDE.md`.
- Ergänzen: `session-screen.md` (pausiert/angepasst, Banner),
  `guided-templates.md` (`pausedSteps`, Status `paused`), `import-export.md`
  (Block, Backup, Export-Spalten), `ui-palette.md` (pausiert ist neutral).
- Architekturvertrag in **beiden** Kopien: Abschnitt zu Einschränkungen, Satz
  zu den letzten Werten, v1-Umfang.
- **`docs/claude-projekt/import-format.md`** (neu im Repo, Q7): Die
  Formatbeschreibung für den Trainings-Assistenten zieht aus
  `~/Documents/gym-book-daten/claude-projekt/` ins Repo. Vorher auf
  Persönliches prüfen; sie enthält nur das Format, Beispiele bleiben erfunden.
  Dabei den veralteten Weg in Abschnitt 1 korrigieren (Import liegt auf
  `/sync`, „Abgleich“). Neuer Abschnitt mit Feldtabelle, Abbruchgründe in
  Abschnitt 10, Beispiel in Abschnitt 11. Ab dann ändert jede Änderung am
  Import-Format diese Datei **im selben Arbeitsschritt**.
- Unit-Test dazu: liest die Datei, schickt **jeden** ```json-Block durch den
  echten Import-Parser und verlangt Erfolg. Darum ist jeder ```json-Block eine
  vollständige Importdatei; Ausschnitte stehen als ```text (wie heute schon
  das Gerüst in Abschnitt 4).
- Das claude.ai-Projekt bindet die Datei über die GitHub-Anbindung ein,
  sofern es sie dort gibt (prüft der Nutzer); sonst lädt er sie von Hand
  hoch.
- Außerhalb des Repos bleibt `projekt-anweisungen.md` (wann pausieren, wann
  anpassen, wann Ersatz, wann Termin-Notiz) – sie ist persönlich.
- **Austausch mit dem Assistenten:** Rückfragen laufen als Dateien unter
  `~/Documents/gym-book-daten/austausch/<datum>-<thema>.md` mit den
  Abschnitten „Frage Trainings-Assistent“, „Antwort Claude Code“,
  „Entscheidung Andreas“. Keine GitHub-Issues: Das Repo ist öffentlich.

## Nachträglich entschieden (24.11.2026)

1. **Unbekannte Blöcke im Import werden abgelehnt.** Das Payload-Schema
   verwarf unbekannte Schlüssel bisher still: Eine Datei mit `restrictions`
   wäre in einer älteren App ohne Fehler durchgelaufen, und die Einschränkung
   hätte gefehlt. Mit dieser Funktion bricht der Import bei einem unbekannten
   Schlüssel der obersten Ebene ab (außer `_hinweis`), mit benannter Zeile
   („Unbekannter Block ‚…‘ – ist die App aktuell?“). Erst ab dieser Version
   wirkt der Schutz; für die heutige App gilt im Planungsprojekt die Regel
   „noch keinen Block `restrictions` liefern“.
2. **Ein umbenannter oder entfernter Schritt bricht den Import ab.** Ersetzt
   ein `steps`-Import die Liste so, dass ein Schritt fehlt, den eine nicht
   aufgehobene, nicht abgelaufene Einschränkung über `template` + `step`
   pausiert oder anpasst (Q6), bricht der Import mit benannter Zeile ab –
   außer dieselbe Datei ändert auch diese Einschränkung (`pauses` bzw.
   `adjustments` genannt). Für `{ "step" }` ohne Vorlage gilt die Regel
   nicht (Q3).
3. **Tote Ziele werden ignoriert und angezeigt, nicht mitgelöscht.** Ein Ziel,
   dessen Workout gelöscht oder dessen Zuordnung entfernt wurde (in der App
   oder per Ersetzen), bleibt im Datensatz, trifft beim Start nichts und fehlt
   in `bestand.json`. Im Sheet der Einschränkung steht es ausgegraut als „gibt
   es nicht mehr“; die Zahl auf der Karte zählt nur Ziele, die es gibt. Kein
   Kaskadenlöschen, keine Sperre beim Löschen. Eine Übung selbst lässt sich
   ohnehin nur löschen, wenn sie in keinem Workout mehr steckt. Wird ein
   gelöschtes Workout später per Import neu angelegt, hat es eine neue Id; die
   alte Pause greift nicht wieder, und `bestand.json` zeigt die Lücke.

## 13. Rückfragen-Runde mit dem Trainings-Assistenten (24.11.2026)

Der Assistent hat mit der Vorschau einen Entwurf für einen echten Fall gebaut
und sechs Lücken gemeldet; dazu kam die Frage nach dem Austausch. Alle
Vorschläge angenommen, eingearbeitet in die Abschnitte oben:

| # | Lücke | Entscheidung |
|---|---|---|
| Q1 | Ersatzübung während einer Pause | `replacement` an der Pause einer Übung; direkt dahinter in der Einheit, Workout unverändert, zählt normal, keine Wochenregeln; Export `ersatz` und `ersatz_fuer` |
| Q2 | Einheiten, die schon unter der Beschwerde liefen | Schalter „Zählt nicht als Leistungsstand“ in der Historie, Export `ausgenommen`; Import schreibt nie in Einheiten; `from` in der Vergangenheit erlaubt, wirkt nur auf neue Einheiten |
| Q3 | Derselbe Schritt in mehreren geführten Vorlagen | Zielform `{ "step" }` für alle Vorlagen; Abbruch ohne Treffer beim Import, später „trifft derzeit nichts“; keine Schutzregel |
| Q4 | Hinweis ohne geänderten Wert | Anpassung nur mit Notiz erlaubt, zählt normal, Export `hinweis`; „angepasst“ nur bei echter Abweichung; Konflikt nur bei demselben Wert |
| Q5 | Steigerung anhalten ohne Wert zu senken | `holdProgression: true` unterdrückt nur den Hinweis; Export `gehalten` |
| Q6 | Schritte kürzen oder kommentieren | Anpassung an Schritten mit `seconds`/`note`; Notiz als Text, keine Ansage; `protokoll.csv` Spalte `einschraenkung` |
| Q7 | Austausch zwischen Assistent und Claude Code | `import-format.md` ins Repo mit Beispieltest; Rückfragen als Dateien unter `~/Documents/gym-book-daten/austausch/`; keine Issues |

Ohne eigene Frage mitentschieden (Folgen der Antworten, zum Widersprechen
markiert): Ein Ersatz unterliegt selbst den Einschränkungen wie eine
hinzugefügte Übung; zwei Ersatzübungen für dieselbe Übung im selben
Zeitraum brechen den Import ab; ein Ersatz übernimmt im Supersatz die Gruppe
der pausierten Übung; der Schalter in der Historie fragt nicht nach, weil er
zurücknehmbar ist.

Beim Schreiben des Umsetzungsplans ergänzt: Ansagen der angepassten
Schrittdauer (Abschnitt 5), `stepIndex` im Protokoll als Position in der
Vorlage, strenge Objekte im Block `restrictions`, Neu-Nummerieren nur bei
einem Ersatz, Einschränkungen werden vor der Start-Transaktion gelesen.

Für die Planung offen (eigene Entscheidung von Nutzer und Assistent, kein
App-Thema): ob ein bestehender Umbau per Ersetzen zurückgebaut und als
Einschränkung mit Ersatz neu gefasst wird. Die Wochenregeln der
zurückgebauten Zuordnung müssen dann von Hand neu gesetzt werden.

## Nicht in Phase 1

- Abweichungen pro Termin (`overrides`).
- Anlegen oder Bearbeiten von Einschränkungen in der App.
- Ziel-Band als Anpassung.
- „Trotzdem“ in geführten Einheiten.
- Automatisches Aufheben nach einem Ereignis (etwa „nach drei schmerzfreien
  Einheiten“) – das wäre adaptive Steuerung, die v1 ausschließt.
