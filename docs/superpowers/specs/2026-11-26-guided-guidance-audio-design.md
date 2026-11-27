# Gesprochene Anleitung für geführte Einheiten

Stand: 26.11.2026 · Status: Entwurf, im Brainstorming abgestimmt, Darstellung
per Mock-up bestätigt

Alle Beispiele in diesem Dokument sind erfunden. Das Repo ist öffentlich;
echte Übungsnamen aus dem eigenen Plan, Gesundheitsangaben und Termine gehören
nie in Spec, Tests oder Fixtures.

## Ziel

Die Ansage einer geführten Einheit nennt heute nur Name, Seite und Dauer
(„Als Nächstes: Beispiel A, links, 45 Sekunden“). Wer eine Übung noch nicht
kennt, kann den Namen nicht immer einer Position zuordnen und weiß nicht,
worauf er achten soll. Der Hinweis hinter dem „i“ hilft nur, wenn man auf den
Bildschirm schaut, und er wird nicht gesprochen.

Künftig kann ein Schritt eine **Anleitung** tragen: zwei bis vier gesprochene
Sätze wie von einem Trainer im Studio – wie man in die Position kommt, worauf
man achtet, was man spürt, welcher Fehler typisch ist. Die Texte schreibt der
Trainings-Assistent (claude.ai-Projekt), sie kommen per Bibliotheks-Import;
die App erfindet nichts.

**Erfolg heißt:** Mit eingeschalteter Anleitung hört man vor jeder Übung, wie
sie geht, und die Haltezeit beginnt erst, wenn die Erklärung zu Ende ist –
ohne auf den Bildschirm zu schauen. Ohne Anleitung läuft alles wie heute.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Für welche Einheiten? | Nur geführte Einheiten. Kraft bleibt ohne Sprachausgabe; der Weg dorthin wird nicht verbaut. |
| Verhältnis zu `hint` | Neues, getrenntes Feld `guidance`, eigens zum Hören geschrieben. `hint` bleibt der kurze Lesetext. Das „i“ zeigt beides. |
| Wann wird sie gesprochen? | Im Wechsel **vor** der Übung, direkt im Anschluss an „Als Nächstes: …“. Der Wechsel wird so lang wie die gesprochene Anleitung; die Uhr der Übung startet danach. |
| Woher kommt die Länge? | Die App misst die erzeugte MP3 und legt die Wechsel beim Start fest. Weder der Assistent noch eine Schätzung aus der Zeichenzahl bestimmt sie. |
| Ein- und ausschalten | Ein Schalter „Mit Anleitung“ je Einheit auf dem Start-Screen, nur bei „Stimme + Ton“. Die letzte Wahl wird gemerkt. Beim Start festgelegt. |
| Beidseitige Schritte | Anleitung nur vor der ersten Seite; vor der zweiten bleibt der 3-s-Seitenwechsel. |
| Audio-Aufbau | **Ein** gemeinsamer Satz je Schritt: „Als Nächstes: {Name}, {Seite}, {Dauer}. {Anleitung}“ als eine MP3. Keine zwei Clips hintereinander. |

Verworfen: zwei getrennte Clips (Verkettung und zwei Längen im Player), eine
Schätzung der Sprechdauer aus der Zeichenzahl (zu ungenau – die Uhr liefe
während der Erklärung), ein vom Assistenten verlängertes `transitionSeconds`
(er kennt die Sprechdauer nicht, und der lange Wechsel bliebe auch ohne
Anleitung), Anleitung während der Übung (man sucht die Position, während die
Haltezeit läuft), automatisch nur die ersten Male je Schritt (unsichtbare
Logik), Wahl je Schritt auf dem Start-Screen (zu viele Taps).

## 1. Datenmodell

### `GuidedStep.guidance` (Vorlage, per Import)

```ts
export interface GuidedStep {
  // … bestehende Felder
  /** Die gesprochene Anleitung: 2–4 Sätze, zum Hören geschrieben. */
  guidance?: string;
  /**
   * Nur im Snapshot einer Einheit (`GuidedRun.steps`), gesetzt von
   * `startGuidedSession`: die Länge des Wechsels vor diesem Schritt, wenn die
   * Anleitung gesprochen wird. Vorhanden heißt zugleich: hier wird sie gesprochen.
   */
  guidanceSeconds?: number;
}
```

- `guidance` steht an der Vorlage wie `hint` – ein Wert an `WorkoutTemplate.steps`,
  kein Index, **keine neue DB-Version**.
- `guidanceSeconds` schreibt nur `startGuidedSession`. Der Import kennt das Feld
  nicht: Das Schritt-Schema verwirft unbekannte Schlüssel, und
  `normalizeGuidedSteps` baut jeden Schritt Feld für Feld neu – es kommt nie
  in eine Vorlage. Es folgt dem Muster der Einschränkungen: Der Snapshot
  ist genau das, was abgespielt wird, und `guided-run.ts` muss nichts von der
  Anleitung wissen.

### `Announcement.durationMs`

```ts
export interface Announcement {
  // … bestehende Felder
  /** Gemessene Länge der MP3. Fehlt bei älteren Datensätzen und wenn die Messung scheiterte. */
  durationMs?: number;
}
```

Additiv, ohne Index, keine neue DB-Version. Die Tabelle bleibt außerhalb von
Backup, Restore und Analyse-Export.

### `AppSettings.guidedGuidance`

`guidedGuidance?: boolean` – die zuletzt gewählte Stellung des Schalters,
additiv, im Backup-Schema wie `guidedAudioMode`. Fehlt sie, ist der Schalter aus.

### Backup (`src/lib/export.ts`)

- Schritt-Schema: `guidance` und `guidanceSeconds` als `.optional()` (beide
  Felder können in einer gesicherten Einheit stehen; ein `z.object` ohne sie
  würde sie still verwerfen).
- Settings-Schema: `guidedGuidance` als `.optional()`.
- Kein `SNAPSHOT_SCHEMA_VERSION`-Sprung, wie bei `steps`.

## 2. Bibliotheks-Import

**Parser (`src/domain/library-import.ts`):** `guidance` kommt als
`z.string().optional()` in `importGuidedStepSchema`, wie `hint`, mit einer
Grenze von **600 Zeichen** nach dem Trimmen (gesprochen etwa 40 s). Eine
längere Anleitung wird mit deutscher Meldung abgelehnt wie die übrigen
Schrittfehler („Die Anleitung darf höchstens 600 Zeichen lang sein.“), ein
Nicht-Text ebenso („Die Anleitung muss Text sein.“). Leer oder nur Leerzeichen
wird wie bei `hint` weggelassen (`optionalText` in `normalizeGuidedSteps`).
`sameGuidedSteps` vergleicht `guidance` mit, damit eine geänderte Anleitung
als geänderte Schrittliste zählt. `guidanceSeconds` in einer Importdatei wird
wie jedes unbekannte Feld ignoriert.

**Format (`docs/claude-projekt/import-format.md`, Abschnitt 6.1), im selben
Schritt wie der Parser:**

- Neue Zeile in der Feldtabelle: `guidance` · nein · Klartext · „Die
  gesprochene Anleitung, siehe unten. Kein Markdown, höchstens 600 Zeichen.“
- Neuer Absatz **„Anleitungen (`guidance`)“** für den Assistenten:
  - Zwei bis vier kurze, gesprochene Sätze in dieser Reihenfolge: Einstieg in
    die Position → worauf achten → was man spürt → ein typischer Fehler.
  - Für die Computerstimme geschrieben: dieselben Regeln wie bei `spokenName`
    (keine Abkürzungen, keine Klammern, keine Schrägstriche, kein Markdown,
    Zahlen ausgeschrieben, wo nötig).
  - Kein Name, keine Seite, keine Dauer, kein „Als Nächstes“ – das setzt die
    App davor.
  - Bei beidseitigen Schritten für die erste Seite formuliert; die zweite
    Seite hört nur „Als Nächstes: …, rechts, …“.
  - Die Anleitung verlängert den Wechsel vor dem Schritt, **wenn** sie
    eingeschaltet ist. Die Dauer des Schritts (`seconds`) bleibt die reine
    Haltezeit; `transitionSeconds` bleibt der Wechsel ohne Anleitung.
  - `steps` ersetzt die Liste ganz – wer Anleitungen nachliefert, schickt die
    ganze Liste mit allen übrigen Feldern aus `bestand.json`.
- Das bestehende JSON-Beispiel in 6.1 bekommt an einem Schritt eine
  `guidance` mit allgemeinem, erkennbar erfundenem Text. `import-format.test.ts`
  prüft sie damit gegen den Parser.
- `bestand.json` gibt `guidance` unter `templates[].steps` mit aus (gleicher
  Feldname), damit der Assistent sie beim Ersetzen erhalten kann.

**Vorschau:** keine neue Zeile. Ein Schritt, der nur `guidance` ändert, zählt
als geänderte Schrittliste wie heute ein geänderter `hint`.

## 3. Sätze (`src/domain/guided-announcements.ts`, rein)

- `buildNextAnnouncement(step, side)` hängt `step.guidance` an, **wenn** der
  Schritt `guidanceSeconds` trägt und `side !== 'right'`:
  „Als Nächstes: Beispiel A, 45 Sekunden. {Anleitung}“. Ohne `guidanceSeconds`
  entsteht genau der heutige Satz.
- `requiredAnnouncementTexts(steps)` bleibt die eine Quelle für „welche Sätze
  braucht dieser Ablauf“ – für einen Snapshot mit `guidanceSeconds` liefert sie
  automatisch die Sätze mit Anleitung.
- Neu: `requiredGuidanceTexts(steps)` – für **Vorlagen**schritte die Sätze mit
  Anleitung, je Schritt mit `guidance` einer (die erste bzw. einzige Seite), in
  Ablaufreihenfolge, als Paare `{ stepIndex, text }`. Intern baut sie den
  Schritt mit einem Platzhalter-`guidanceSeconds` und ruft
  `buildNextAnnouncement` – so meinen Erzeugung, Messung und Ablauf garantiert
  denselben Satz.
- Neu: `guidanceTransitionSeconds(plannedSeconds, durationMs)` =
  `max(plannedSeconds, ⌈GUIDED_ANNOUNCEMENT_DELAY_SECONDS + durationMs / 1000 + GUIDED_GUIDANCE_PAD_SECONDS⌉)`,
  mit `GUIDED_GUIDANCE_PAD_SECONDS = 2`. `plannedSeconds` ist der Wechsel, den
  der Schritt ohne Anleitung hätte (beim ersten Schritt 5).
- `ANNOUNCEMENT_AFTER_SIGNAL_SECONDS` (0,7 s, heute in `src/lib/sound.ts`) zieht
  als `GUIDED_ANNOUNCEMENT_DELAY_SECONDS` ins `domain`; `sound.ts` bzw.
  `GuidedRunPage` lesen sie von dort. Eine Zahl, zwei Leser.

## 4. Zeitachse (`resolveGuidedSections`)

Die einzige Änderung: Trägt ein Schritt `guidanceSeconds`, ist das die Länge
seines Wechsels – **auch beim ersten Schritt**, wo sonst immer 5 s gelten.
Ohne das Feld bleibt alles wie heute; ältere Einheiten laufen unverändert.

Alles, was aus den Abschnitten abgeleitet wird – `deriveGuidedRunState`,
Sprünge, `startNow`, `+15 s`, Protokoll, `completedAt = Start + Gesamtdauer`,
`describeGuidedFacts` –, folgt ohne eigene Änderung. Wechsel erscheinen nicht
im Protokoll, die Anleitung also auch nicht.

## 5. Erzeugen und Messen (`src/db/announcement-actions.ts`)

- `loadGuidedTexts` nimmt zu den heutigen Sätzen die Anleitungssätze der
  Vorlagenschritte und der am Tag wirksamen Schritte (`requiredGuidanceTexts`)
  hinzu. Eine Vorlage mit Anleitungen erzeugt also **beide Varianten**, direkt
  nach dem Import wie heute – der Schalter ist ohne zweiten Erzeugungslauf
  nutzbar. Kontingent, Offline-Prüfung, Rückfrage bei Mehrkosten und Abbruch
  beim ersten Fehler bleiben unverändert. (Zum Maß: 15 Schritte à 300 Zeichen
  sind rund 4.500 Zeichen bei 1 Mio. Freizeichen im Monat.)
- **Messen:** Nach jeder erfolgreichen Synthese wird die MP3 dekodiert und
  `durationMs` mit gespeichert. Neue Funktion `measureAudioDuration(data:
  ArrayBuffer): Promise<number | null>` in `src/lib/announcement-audio.ts`,
  mit eigenem `OfflineAudioContext` (dekodieren braucht keine Nutzergeste) und
  auf einer **Kopie** des Puffers (`decodeAudioData` löst ihn ab). `null`, wo es
  Web Audio nicht gibt oder das Dekodieren scheitert. In Tests per Option
  `measure` ersetzt, wie heute `synth`.
- Scheitert die Messung, wird die Ansage trotzdem gespeichert, ohne
  `durationMs`. Für die Anleitung zählt ein Anleitungssatz ohne `durationMs`
  als **fehlend**: `findMissingTexts` behandelt ihn so, die Verfügbarkeit
  meldet `guidance.complete: false`, und der nächste Lauf „Ansagen erzeugen“
  erzeugt ihn neu und misst erneut. Die heutigen Sätze ohne Anleitung brauchen
  keine Dauer; für sie ändert sich nichts.
- **Messung im Ablauf vermeiden:** Gemessen wird nur beim Erzeugen; Start und
  Ablauf lesen `durationMs` aus IndexedDB.

## 6. Verfügbarkeit

`AnnouncementAvailability` bekommt einen Teil für die Anleitung:

```ts
guidance: {
  /** Mindestens ein (wirksamer) Schritt hat eine Anleitung. */
  available: boolean;
  /** Alle Anleitungssätze da und gemessen. */
  complete: boolean;
  /** Gesamtdauer der Einheit in Sekunden mit Anleitung; nur bei `complete`. */
  totalSeconds?: number;
}
```

`getAnnouncementAvailability(templateId, now)` rechnet ihn mit den am Tag
wirksamen Schritten (Einschränkungen wie heute). `totalSeconds` entsteht, indem
die wirksamen Schritte mit `guidanceSeconds` versehen (dieselbe Funktion wie
beim Start, Abschnitt 7) und durch `resolveGuidedSections` / `sumGuidedSeconds`
geschickt werden.

## 7. Start (`startGuidedSession`)

- Neue Option `guidance?: boolean`; fehlt sie, gilt `AppSettings.guidedGuidance`.
- Eine reine Funktion `applyGuidance(steps, durationsByText)` im `domain` setzt an
  jedem Schritt mit `guidance` das `guidanceSeconds`
  (`guidanceTransitionSeconds(geplanter Wechsel, gemessene Dauer)`). Fehlt für
  einen Schritt die Dauer, gibt sie `null` zurück – dann startet die Einheit
  **ohne** Anleitung.
- Bedingung für die Anleitung: `audioMode` ist nach der heutigen Prüfung `voice`,
  `guidance` ist gewünscht und `applyGuidance` gelingt. Sonst läuft die Einheit
  ohne Anleitung und die gemerkte Wahl bleibt, wie sie war – dieselbe Regel wie
  beim Herabstufen von „Stimme + Ton“.
- Der Start-Screen schreibt die Wahl des Schalters nach
  `AppSettings.guidedGuidance`, wenn er startet (wie `guidedAudioMode`).
- `getStepsAnnouncementAvailability(steps)` (Pille im Ablauf) nimmt den Snapshot
  und prüft damit automatisch die Sätze mit Anleitung.

## 8. Player (`GuidedRunPage`, `src/lib/sound.ts`)

Heute wird eine Ansage gestartet und nie gestoppt; bei Sätzen von zwei
Sekunden fällt das nicht auf. Eine Anleitung dauert bis zu 40 s und würde nach
einem Sprung, einem „Jetzt starten“ oder einer Pause weiterlaufen und sich mit
der nächsten Ansage überlagern. Deshalb:

- `playAudioBufferWhenAwake` gibt eine Stopp-Funktion zurück (oder `sound.ts`
  hält die eine laufende Ansage selbst). Es läuft **höchstens eine Ansage**.
- Gestoppt wird sie, wenn eine neue Ansage startet, wenn der Abschnitt wechselt
  (auch durch `startNow`, `skip`, `back`), bei Pause, beim Umschalten auf „Nur
  Ton“ und beim Verlassen des Screens.
- Nach einer Pause wird die Anleitung **nicht** wiederholt; der Wechsel läuft
  still weiter, die Anleitung steht hinter dem „i“. (Bewusst einfach; eine
  Wiederholung bräuchte einen neuen Ansage-Schlüssel im `domain`.)
- Schaltet man im Ablauf auf „Nur Ton“, bleiben die langen Wechsel – die
  Zeitachse ist beim Start festgelegt. „Jetzt starten“ kürzt sie ab.

## 9. Oberfläche

**Start-Screen (`GuidedStartPage`)** – so im Mock-up bestätigt:

- Unter der Wahl „Stimme + Ton / Nur Ton“ eine Zeile **„Mit Anleitung“** mit
  der Unterzeile „erklärt jede Übung vorher“; die ganze Zeile ist ein
  `role="switch"` (≥ 44 px), Optik wie `ToggleField`, kompakt in der Größe der
  Ton-Wahl. Tinte, kein Lime.
- Sichtbar nur bei gewähltem „Stimme + Ton“ und `guidance.available`.
  Gesperrt (wie „Stimme + Ton“ heute), solange `guidance.complete` fehlt; dann
  zeigt der vorhandene Hinweis „Ansagen erzeugen“, was zu tun ist.
- Ist der Schalter an, zeigt die Dauer-Pill „≈ {n} min mit Anleitung“ aus
  `guidance.totalSeconds` (Zahl über `formatNumber`).
- Anker: `data-guided-guidance` (mit `aria-checked`).

**Das „i“ (`GuidedHintDialog`)** – auf dem Start-Screen und im Ablauf:

- Erscheint, wenn ein Schritt `hint` **oder** `guidance` hat (heute nur bei
  `hint`).
- Unter dem Hinweis eine Überschrift „Anleitung“ (wie „Hinweis“: 10 px, Versalien,
  gesperrt, 60 % Deckkraft) und der Text in 15 px. Ohne `hint` steht nur die
  Anleitung. Die Anleitung ist **immer** lesbar, auch bei ausgeschaltetem
  Schalter. Bei langem Text scrollt die Karte (heute schon `overflow-y-auto`).
- Die Prop `hint` wird zu `hint?: string` plus `guidance?: string`; Aufrufer
  ist der Start-Screen und der Ablauf.
- Anker: `data-guided-guidance-text`.

**Bühne im Ablauf:** unverändert. Ein Wechsel mit Anleitung ist einfach ein
längerer Wechsel mit Ring und Restzeit.

**`GuidedStepsCard` (Vorlagen-Detail):** keine Änderung.

## 10. Fehlerfälle

| Fall | Verhalten |
|---|---|
| Kein Schlüssel, offline, Fehler beim Erzeugen | Wie heute: Meldung, Schalter gesperrt, Einheit läuft ohne Anleitung. |
| Messung gescheitert | Ansage gespeichert ohne Dauer; Anleitung gilt als fehlend; der nächste Lauf „Ansagen erzeugen“ erzeugt und misst neu. |
| Stimme gewechselt | Wie heute: alle Sätze fehlen für die neue Stimme, auch die mit Anleitung. |
| Import: Anleitung zu lang oder kein Text | Ablehnung mit deutscher Meldung, Import ändert nichts. |
| Import: Anleitung leer; `guidanceSeconds` in der Datei | Weggelassen bzw. ignoriert, wie leerer `hint` und unbekannte Felder heute. |
| Einheit mit Anleitung gestartet, Ansagen später gelöscht („Alle Daten löschen“ leert die Tabelle) | Wie heute bei „Stimme + Ton“: Pille fällt auf „Nur Ton“; die Wechsel bleiben lang. |
| Backup einer Einheit mit `guidanceSeconds` wiederhergestellt | Zeitachse identisch; Audio wie heute nur, wenn Ansagen vorhanden. |

Im Ablauf geht weiterhin nichts ins Netz.

## 11. Tests

**domain**

- `buildNextAnnouncement`: mit `guidanceSeconds` und Anleitung, nur linke bzw.
  einzige Seite; rechte Seite ohne Anleitung; ohne `guidanceSeconds` exakt der
  heutige Satz.
- `requiredGuidanceTexts`: ein Satz je Schritt mit Anleitung, Reihenfolge,
  beidseitig nur einmal.
- `guidanceTransitionSeconds`: Aufrunden, Untergrenze geplanter Wechsel.
- `applyGuidance`: setzt nur bei Schritten mit `guidance`; fehlende Dauer → `null`.
- `resolveGuidedSections`: `guidanceSeconds` als Wechsel, auch beim ersten
  Schritt; ohne das Feld unveränderte Abschnitte (Regression).
- `deriveGuidedRunState` mit einem Snapshot mit `guidanceSeconds`: `startNow`
  beendet den langen Wechsel, Endzeit stimmt.

**Import**

- `guidance` angenommen und getrimmt; Nicht-Text und über 600 Zeichen
  abgelehnt; leer weggelassen; `guidanceSeconds` kommt nicht in die Vorlage;
  geänderte Anleitung zählt als geänderte Schrittliste.
- `import-format.test.ts` über das erweiterte Beispiel.

**db**

- `generateAnnouncements`: erzeugt beide Varianten, speichert `durationMs`
  (`measure` injiziert); gescheiterte Messung → Anleitungssatz fehlt weiter,
  ein zweiter Lauf erzeugt ihn neu.
- `getAnnouncementAvailability`: `guidance.available/complete/totalSeconds`,
  auch mit einer Einschränkung, die die Sekunden eines Schritts ändert.
- `startGuidedSession`: mit Anleitung → `guidanceSeconds` im Snapshot; ohne
  Wunsch, bei `tone` oder bei fehlender Dauer → kein Feld; gemerkte Wahl.
- Backup-Rundlauf mit `guidance`, `guidanceSeconds`, `guidedGuidance`.

**e2e (WebKit)**

- Start-Screen: Schalter nur bei „Stimme + Ton“ und Schritten mit Anleitung;
  gesperrt ohne erzeugte Ansagen. Google wird abgefangen wie in
  `guided-voice.spec.ts`; weil sich die Platzhalter-MP3 nicht dekodieren lässt,
  braucht der Test eine dekodierbare Mini-MP3 als Fixture oder einen
  Test-Hook für `measure` – wird im Plan entschieden.
- Ablauf mit Anleitung: der erste Wechsel ist länger als 5 s
  (`data-guided-remaining`), „Jetzt starten“ beendet ihn.
- „i“ zeigt die Anleitung (`data-guided-guidance-text`), auch bei einem Schritt
  ohne `hint`.

## 12. Doku

- `docs/architecture/guided-templates.md`: neuer Abschnitt „Gesprochene
  Anleitung“ (Feld, Snapshot-Feld, Messung, Zeitachse, Player-Stopp, Schalter).
- `docs/claude-projekt/import-format.md`: Abschnitt 2 oben.
- Architekturvertrag `.claude/skills/gym-book-architect/SKILL.md` **und** der
  Spiegel unter `.trae/`: v1-Umfang „guided session (… optional spoken
  announcements and spoken guidance)“; der Satz zum Netzweg bleibt („only to
  generate the spoken announcements“ – die Anleitung ist Teil davon).
- `CLAUDE.md`: die Anker-Liste der geführten Bühne um
  `data-guided-guidance-text` ergänzen.

## Nicht in diesem Schritt

- Sprachausgabe für Kraftübungen (`Exercise.instructions`).
- Anleitung nur die ersten Male je Schritt oder Wahl je Schritt.
- Wiederholen der Anleitung nach einer Pause.
- Anleitung vor der zweiten Seite eines beidseitigen Schritts.
- Bilder oder Animationen zur Übung in der geführten Einheit.
