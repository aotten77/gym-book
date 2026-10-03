# Übungsinfo als Modal, Anleitung als Markdown

Stand: 03.10.2026 · Status: Entwurf, abgestimmt im Gespräch

## Ziel

In einer laufenden Session sollen Bild und Anleitung einer Übung **zusammen in
einem Modal** stehen, statt die Anleitung im Sheet aufzuklappen und das Bild in
einer separaten Lightbox zu zeigen. Die Anleitung bekommt eine **kleine,
feste Markdown-Teilmenge**, damit sie sich gliedern lässt. Das Planungsprojekt
auf claude.ai, das die Anleitungstexte über den Bibliotheks-Import liefert,
bekommt eine eigenständige Beschreibung der neuen Regel.

## Ausgangslage (Backup vom 03.10.2026)

- 53 Übungen, 42 mit Anleitung: alle einzeilig, keine mit Markdown-Zeichen,
  9 bis 424 Zeichen (Median 120).
- 12 Anleitungen betonen mit GROSSBUCHSTABEN, 10 beginnen mit „NEU …“ oder
  „FREIGEGEBEN …“ – und genau diese Herkunftsangabe ist heute der Teaser im
  Sheet.
- Bild und Text: 16 beides, 10 nur Bild, 26 nur Text, 1 nichts. Höchstens ein
  Bild pro Übung.
- 29 von 48 Zuordnungen tragen eine Workout-Notiz, alle kurz (≤ 142 Zeichen).

Folgerung: Kompatibilität ist kein Thema – ein einzeiliger Fließtext ist
gültiges Markdown und wird ein Absatz. Es gibt keine Migration.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Umfang Markdown | kleine, feste Teilmenge, eigener Parser, keine Abhängigkeit |
| Abschnittsnamen | werden **nicht** geparst; die Gliederung ist eine Schreibkonvention |
| Wofür Markdown | nur `Exercise.instructions`; Workout-Notizen bleiben Klartext |
| Darstellung | Vollbild-Modal über dem Sheet (Ansatz A), nicht zweites `Sheet`, nicht Ansichtswechsel |
| Lightbox | entfällt; sie wurde nur in `SessionPage` verwendet |
| Projektwissen | eigenständige Datei `~/Documents/gym-book-daten/anleitungstexte.md` |

## 1. Markdown-Teilmenge

### Grammatik

| Syntax | Ergebnis |
|---|---|
| `**fett**` | fett |
| `*kursiv*`, `_kursiv_` | kursiv |
| Zeile beginnt mit `- ` oder `* ` | ungeordnete Liste |
| Zeile beginnt mit `1. ` (beliebige Zahl) | nummerierte Liste |
| `#`, `##`, `###` am Zeilenanfang | Zwischenüberschrift, alle Ebenen gleich dargestellt |
| Leerzeile | neuer Absatz |
| einfacher Zeilenumbruch in einem Absatz | Zeilenumbruch (`<br>`) |

Alles andere bleibt **wörtlicher Text**: Links, Bilder, Tabellen, Code,
Zitate, HTML. Ein nicht geschlossenes `**` bleibt als `**` stehen. Es wird
nie HTML gerendert – der Parser liefert einen Baum, React erzeugt daraus
Elemente, `dangerouslySetInnerHTML` kommt nicht vor. Ein Import-Text kann
dadurch nichts ausführen.

### Module

- `src/lib/markdown-lite.ts` – rein, ohne Abhängigkeit.
  - `parseMarkdownLite(text: string): MarkdownBlock[]`
  - `MarkdownBlock` = `{ kind: 'paragraph', lines: Inline[][] }`
    | `{ kind: 'heading', content: Inline[] }`
    | `{ kind: 'list', ordered: boolean, items: Inline[][] }`
  - `Inline` = `{ text: string, strong?: true, emphasis?: true }`
  - `toPlainText(content: Inline[]): string` – für den Teaser.
  - `lib/` statt `domain/`: eine Formatfrage, keine Trainingsregel, neben
    `format.ts` und `number-input.ts`.
- `src/components/MarkdownText.tsx` – rendert den Baum mit den Design-Tokens:
  Überschrift `font-display` in Tinte, Listen `list-disc` / `list-decimal`,
  `strong` / `em`. Eine Prop für die kompakte Variante (Bibliothekskarte,
  Übungsauswahl) mit kleinerem Abstand.

### Wo gerendert wird

`whitespace-pre-line` fällt an allen drei heutigen Stellen weg, sonst stünden
`**` und `###` sichtbar im Text:

1. Info-Modal in der Session (neu, Abschnitt 2)
2. Bibliothekskarte – `ExercisesPage.tsx`
3. Vorschau in der Übungsauswahl des Workouts – `TemplateDetailPage.tsx`

Unter dem Textfeld „Anleitung“ im Übungsformular steht eine Hilfezeile:
`**fett**`, `- Liste`, `### Überschrift`.

### Was gleich bleibt

Gespeichert wird weiter der rohe Text in `Exercise.instructions`. Keine
Dexie-Version, kein `SNAPSHOT_SCHEMA_VERSION`-Bump, keine Änderung an
`export.ts`, am Bibliotheks-Import oder am Analyse-Export.

## 2. Das Info-Modal

### Einstiege

Beide öffnen dasselbe Modal:

- **Thumbnail** im Kopf der Bühne (`SessionExerciseStage`). `aria-label`
  wird „Übung ansehen: {Name}“.
- **Ausführungszeile** unter dem Kopf (`ExerciseGuideBlock`). Sie klappt nicht
  mehr auf, sondern ist ein Knopf mit `aria-haspopup="dialog"`:
  `AUSFÜHRUNG · {Teaser} ›`, einzeilig, abgeschnitten – die Wertefelder
  verschieben sich nicht.

| Daten | Thumbnail | Zeile | Modal zeigt |
|---|---|---|---|
| Bild + Text | ja | ja | Bild und Text |
| nur Text (oder Tempo/Notiz) | – | ja | Text |
| nur Bild | ja | – | Bild |
| nichts | – | – | kein Modal |

### Aufbau

`src/components/ExerciseInfoDialog.tsx`, Vollbild auf Papier (`bg-app`),
Safe-Area-Abstände wie die Lightbox bisher, `z-50` (über Sheet `z-40` und
Ruhemodus-Lasche `z-[45]`).

```
┌──────────────────────────────┐
│ {Übungsname}             [✕] │  font-display, Schließen 44px
├──────────────────────────────┤
│ Bild, object-contain,        │  nur wenn vorhanden, max-h 40dvh
│ max-h 40dvh                  │
│ MarkdownText (Anleitung)     │
│ Tempo 4-0-2                  │  wenn gesetzt
│ ───────────                  │
│ In diesem Workout: {Notiz}   │  wenn gesetzt, Klartext
└──────────────────────────────┘  der Rumpf scrollt als Ganzes
```

Tinte auf Papier, keine Limette: eine Anleitung ist kein Zustand, die eine
Limettenfläche des Sheets bleibt die aktive Satzzeile.

### Verhalten

- Schließen per ✕ und Escape. Kein Wischen – die Geste kollidiert mit dem
  Scrollen langer Texte.
- **Escape beim Stapeln:** Sheet und Modal hören beide auf `keydown`. Das
  Modal registriert seinen Handler in der **Capture-Phase auf `window`** und
  ruft `stopPropagation`, damit der Handler des Sheets auf `document` nicht
  feuert. Sonst schließt ein Escape beide (der Fehler, den die Lightbox
  heute hat).
- `body.style.overflow`: Das Modal öffnet nur über einem offenen Sheet und
  schließt immer vor ihm (das Sheet ist darunter nicht erreichbar), also
  bleibt die Wiederherstellung LIFO-korrekt.
- Fokus: beim Öffnen auf ✕, beim Schließen zurück zum Auslöser.
  `role="dialog"`, `aria-modal="true"`, `aria-labelledby` auf den Namen.
- Test-Anker: `data-exercise-info`.

### Zustand und Daten

- Ephemeres `useState` in `SessionPage`: die ID der Session-Übung, deren Info
  offen ist. Ersetzt `mediaPreview`. Nach einem Reload ist das Modal zu, wie
  das Sheet.
- Anleitung, Tempo und Bild kommen **live aus der Bibliothek**
  (`availableExerciseById`, `mediaAssetById`) wie heute der Guide; die Notiz
  aus dem Session-Snapshot (`WorkoutSessionExercise.notes`).
- Ein Satz kann hinter dem Modal nicht abgehakt werden, also öffnet sich der
  Ruhemodus nicht darüber.

### Änderungen an vorhandenem Code

- `buildExerciseGuide` (`src/domain/exercise-guide.ts`): statt `lines`
  liefert er `blocks: MarkdownBlock[]`. **Teaser** = Klartext des ersten
  Blocks, der keine Überschrift ist (bei einer Liste der erste Punkt, bei
  einem Absatz die erste Zeile); fehlt er, die Notiz, dann `Tempo …`;
  sonst `null` wie bisher.
- `ExerciseGuideBlock` wird zur Auslösezeile; der aufgeklappte Inhalt zieht
  ins Modal.
- `SessionExerciseStage`: `onOpenMedia` wird zu `onOpenInfo(exerciseId)`.
- `MediaLightbox.tsx` wird gelöscht.

## 3. Datei fürs Projektwissen

`~/Documents/gym-book-daten/anleitungstexte.md`, **außerhalb des Repos**, weil
sie echte Beispiele enthalten darf. Inhalt:

1. Wo der Text erscheint: erste Nicht-Überschrift-Zeile als Teaser im
   Training (auf dem iPhone nach etwa 40 Zeichen abgeschnitten), ganzer Text im
   Info-Modal und in der Bibliothek.
2. Erlaubte Syntax (Tabelle aus Abschnitt 1) und was nicht geht; Zeilenumbrüche
   im JSON als `\n`.
3. Schreibreihenfolge, alle Teile optional:
   1. Ausführung als Liste, wichtigste Bewegungsregel zuerst
   2. `### Steigerung`
   3. `### Achtung` – Abbruchkriterien, Schmerzgrenzen
   4. `### Warum`
   5. Verlauf/Herkunft kursiv am Ende, nie am Anfang
4. Fett statt Großbuchstaben, höchstens eine Betonung pro Punkt.
5. Workout-Notiz: Klartext, kurz, nur was in diesem Workout gilt.
6. Vorher/Nachher an einer echten Übung und ein Auftrag, mit dem das Projekt
   die bestehenden Anleitungen als Plan-Update neu liefert (der Import
   aktualisiert `instructions` per Name, sichtbar als `AKTUALISIERT` im
   Dry-Run).

### Synthetisches Beispiel (für dieses Repo)

Vorher:

```
NEU 01.09. Langsam absenken. KEIN Schwung. Start 10 kg. Bei Schmerz abbrechen.
```

Nachher:

```markdown
- Langsam absenken, **kein Schwung**
- Oben kurz halten

### Steigerung
Start 10 kg, +2,5 kg nach zwei sauberen Einheiten.

### Achtung
Bei Schmerz abbrechen.

*Neu seit 01.09.*
```

Teaser: „Langsam absenken, kein Schwung“.

## 4. Tests und Doku

### Unit (vitest)

- `src/lib/markdown-lite.test.ts`: jede Syntax; Fett im Listenpunkt; nicht
  geschlossenes `**` bleibt wörtlich; `<b>` bleibt Text; CRLF; mehrere
  Leerzeilen; Überschrift ohne Leerzeichen (`###x`) bleibt Text; einzeiliger
  Fließtext wird genau ein Absatz; `toPlainText` entfernt die Auszeichnung.
- `src/domain/exercise-guide.test.ts`: Teaser überspringt Überschriften,
  nimmt den ersten Listenpunkt, entfernt Syntax, fällt auf Notiz und Tempo
  zurück, `null` ohne alles.

### e2e (WebKit, beide iPhone-Größen)

`e2e/exercise-guide.spec.ts` wird zu `e2e/exercise-info.spec.ts`:

- die Ausführungszeile zeigt den Teaser ohne Markdown-Zeichen;
- ein Tipp öffnet `[data-exercise-info]`, Liste und Fett sind gerendert;
- Escape schließt nur das Modal, `[data-sheet]` bleibt offen;
- der Fokus kehrt zur Zeile zurück;
- kein horizontaler Überlauf bei 320px;
- die Bibliothekskarte rendert Markdown statt `**`.

**Lücke:** Der Bildfall (Thumbnail als Einstieg, Bild im Modal) ist per e2e
nicht prüfbar – Playwrights WebKit schreibt keine Blobs in IndexedDB. Er wird
im Code und von Hand geprüft.

### Doku

- `CLAUDE.md`: Der Absatz zu `ExerciseGuideBlock` im Abschnitt „Inside the
  sheet“ wird ersetzt (Modal statt Aufklapper, Markdown-Teilmenge,
  Teaser-Regel, Escape beim Stapeln); der Satz zur Darstellung in Bibliothek
  und Übungsauswahl (`whitespace-pre-line`) ebenso. Ein Satz zum neuen
  Modul `markdown-lite.ts` und dass es nie HTML rendert.
- Der Architect-Skill erwähnt Anleitungen nicht und bleibt unverändert.

## Außerhalb des Umfangs

- Markdown in Workout-Notizen, Übungsnamen oder anderen Feldern.
- Vergrößern des Bildes im Modal (Pinch/Zoom), mehrere Bilder.
- Bildvergrößerung in der Bibliothek.
- Automatisches Umschreiben bestehender Anleitungen in der App – das macht
  das Planungsprojekt über ein Plan-Update.
