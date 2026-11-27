# Pausen im geführten Ablauf

Stand: 27.11.2026 · Status: Entwurf, im Brainstorming abgestimmt, Darstellung
per Mock-up gewählt (Variante „Pause auf Papier“)

Alle Beispiele in diesem Dokument sind erfunden. Das Repo ist öffentlich;
echte Übungsnamen aus dem eigenen Plan, Gesundheitsangaben und Termine gehören
nie in Spec, Tests oder Fixtures.

## Ziel

Ein langer Wechsel (`transitionSeconds`, z. B. 45 s) dient zwischen
wiederholten Halteschritten als Pause. Auf dem dunklen Run-Screen sieht er
heute fast aus wie eine Übung: kleines „ALS NÄCHSTES“, Name in Weiß statt
Limette, oben klein „Wechsel · noch m:ss“. Bei „Nur Ton“ klingt nur das Ende
einer Übung; das Ende der Pause, also der Start der nächsten Übung, ist
stumm.

**Erfolg heißt:** Ein Blick aus Abstand auf das Handy zeigt, ob Pause oder
Übung läuft, und ohne hinzusehen hört man, wann die Pause endet – auch ohne
erzeugte Ansagen. Ein Yoga-Flow mit kurzen Wechseln läuft wie heute.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Was ist eine Pause? | Ein Wechsel (`kind: 'transition'`) mit **geplant** mindestens `GUIDED_PAUSE_MIN_SECONDS` = 15 s. Geplant heißt `plannedTransitionSeconds` – ohne Verlängerung durch die Anleitung. Der Wechsel vor dem ersten Schritt ist fest 5 s und damit nie eine Pause. |
| Seitenwechsel | Nie eine Pause; bleibt „Seitenwechsel“, dunkel, ohne Countdown. |
| Neues Feld im Import? | Nein. Die Länge trennt Wechsel (Yoga: in die nächste Haltung gehen) von Pause (Erholung zwischen Halteschritten). Import-Format, Datenbank und Backup bleiben unverändert. |
| Darstellung der Pause | Helle Bühne (Papier, Tinte), groß „PAUSE“, darunter „Danach“ + nächste Übung. Variante „Pause auf Papier“ aus dem Mock-up. |
| Countdown-Töne | Wenn der Wechsel **tatsächlich** (also mit Verlängerung durch die Anleitung) mindestens 15 s dauert: drei kurze Töne bei 3, 2, 1 s Rest, dann ein längerer, höherer Start-Ton bei 0. In beiden Audio-Modi. |
| Anleitung und Countdown | Ruhe nach der Anleitung steigt von 2 auf 4 s (`GUIDED_GUIDANCE_PAD_SECONDS`), damit der Countdown nie in die Stimme fällt. |
| Ansagen | Unverändert. Keine Pausenansage, nichts muss neu erzeugt werden. |
| Pausieren-Knopf | Nur das Symbol ⏸, zugänglicher Name „Pausieren“. Das Wort „Pause“ gehört damit allein der Erholung. |
| Pausiert-Screen | Behält die Helligkeit des Abschnitts, in dem pausiert wurde („Einfrieren“). Überschrift ist das ⏸-Symbol statt „Pausiert“. |
| Start-Screen | Vor einem Schritt, dessen Wechsel eine Pause ist, steht eine Zeile „45 s Pause“. Kürzere Wechsel erscheinen nicht. |

Verworfen: jeder Wechsel als Pause (ein Yoga-Flow würde alle paar Atemzüge
hell aufblitzen und „Pause“ behaupten); ein Feld `pause: true` im Import
(Pflegeaufwand für Nutzer und Assistent, solange die Länge zuverlässig
trennt); Pause dunkel mit Limette nur in der Übung oder nur ein großes
„PAUSE“ in heutigen Farben (aus Abstand zu schwach); eine gesprochene
Pausenansage (alle Ansagen neu erzeugen, Kosten, nutzlos bei „Nur Ton“);
Countdown-Töne, die einer laufenden Anleitung ausweichen (uneinheitlich, wo
man sich aufs Gehör verlässt).

## Verhalten

### Zeitachse

`resolveGuidedSections` bleibt die eine Stelle, an der Schritte zur
Zeitachse werden. Jeder Abschnitt mit `kind: 'transition'` bekommt
`pause: boolean` = `isGuidedPause(steps, stepIndex)`, also
`plannedTransitionSeconds(steps, stepIndex) >= GUIDED_PAUSE_MIN_SECONDS`. Exercise- und Seitenwechsel-Abschnitte tragen das
Feld nicht (oder `false`). Alles, was Pause anzeigt oder prüft, liest dieses
Feld und rechnet die Regel nicht nach.

Die Konstante `GUIDED_PAUSE_MIN_SECONDS = 15` steht in `guided-steps.ts` und
gilt für beides: Pause (gegen die geplante Länge) und Countdown (gegen die
tatsächliche Länge `section.seconds`).

### Run-Screen

**Pause läuft** (`current.pause === true`):

- `GuidedStage tone="light"`. Die Bühne setzt `theme-color` dann nicht auf
  Tinte; die Statusleiste wird hell. Der Wechsel zurück auf dunkel beim Start
  der Übung stellt sie wieder um.
- Links: „PAUSE“ groß (Display-Schrift, extrabold, ca. so hoch wie die Zeit
  einer Übung), darunter Caption „Danach“, Name der nächsten Übung mit Seite
  und ⓘ wie heute, darunter ihre Dauer.
- Rechts: der Ring in Tinte auf Papier (Limette ist auf hellem Grund nie
  lesbar und heißt „jetzt dran“ – in der Pause ist nichts dran), Zahl in
  Tinte; darunter „Sofort starten“ (Tinte auf Papier, invertiert zur dunklen
  Bühne), „Zurück“ und ⏸ als runde Knöpfe in Tinte/10.
- Kopfzeile: dieselbe Zeile in Tinte; Meta-Text „Pause · noch m:ss“.
- Keine Limette auf dem Screen.

**Kurzer Wechsel** (`pause === false`), **Seitenwechsel**, **Übung**: wie
heute. Meta-Text bleibt „Wechsel · noch m:ss“ bzw. „Seitenwechsel · …“.

**Pausieren-Knopf:** In der Übung zeigt die Hauptaktion nur ⏸ (kein Text),
`aria-label="Pausieren"`, weiterhin mindestens 44 px hoch. Der runde
⏸-Knopf im Wechsel heißt ebenfalls „Pausieren“.

**Pausiert:** Der Screen nimmt den Ton des Abschnitts, in dem pausiert wurde:
hell, wenn `current.pause`, sonst dunkel. Die Caption „Pausiert“ wird durch
das ⏸-Symbol ersetzt (mit `sr-only`-Text „Pausiert“, damit der Zustand
vorgelesen wird). Name, Zeit und die Knöpfe „Weiter“, „Schritt neu starten“,
„Einheit beenden …“ bleiben; auf heller Bühne in den hellen Varianten.

**Hinweis-Dialog** (ⓘ): unverändert; er muss auf beiden Bühnen lesbar sein.

Alle Farben kommen aus den vorhandenen Tokens (`accent`, `accent-contrast`);
Kontrast ≥ 4,5:1 für Text auf beiden Bühnen.

### Töne

Neue fällige Signale aus `deriveGuidedRunState().dueSignal`, zusätzlich zum
heutigen Signal am Ende jeder Übung:

| Signal | Wann | Schlüssel |
|---|---|---|
| Countdown | bei 3, 2 und 1 s Rest eines Wechsels mit `section.seconds >= 15` | `pause-count:<sectionIndex>:<n>` (n = 3, 2, 1), bei `rewinds > 0` mit `:<rewinds>` |
| Start | wenn derselbe Wechsel regulär abläuft (Rest 0) | `pause-go:<sectionIndex>`, ebenso mit `:<rewinds>` |

- Die Signale kommen aus der Zeitachse, nicht aus einem Timer im UI; sie
  folgen damit Pausieren, `+15 s` (betrifft nur Übungen), `back`, `skip` und
  `startNow` von selbst.
- `startNow`, `skip` oder `back` vor Ablauf: die restlichen Countdown-Töne und
  der Start-Ton entfallen. Wer tippt, weiß, dass es losgeht.
- Pausieren friert ein: ist ein Ton beim Pausieren noch nicht fällig, kommt er
  nach „Weiter“ zur richtigen Restzeit.
- **Frische:** Countdown- und Start-Ton sind nur fällig, solange seit ihrem
  Zeitpunkt höchstens `GUIDED_COUNT_MAX_DELAY_MS` = 600 ms vergangen sind –
  kürzer als der Abstand zweier Töne (1 s), länger als ein Tick (250 ms).
  Ein Ton, der zu spät käme, entfällt; nach einer Rückkehr aus dem Hintergrund
  wird nichts nachgeholt.
- Sind zwei Signale zugleich fällig, gewinnt das spätere (der jüngste
  Zeitpunkt).

**Klang** (`sound.ts`, über `playTonesWhenAwake` wie das heutige Signal):

- `playGuidedCountTone()`: ein kurzer Ton, ca. 0,12 s, 880 Hz.
- `playGuidedGoTone()`: ein längerer, höherer Ton, ca. 0,45 s, 1174,7 Hz.
- Beide unterscheiden sich hörbar vom Übungsende-Signal (0,4 s, 784 Hz) und
  vom Doppelton der Satz-Timer. Feinabstimmung einmal auf dem echten iPhone.

Töne und Ansagen werden weiter gemischt; keiner bricht den anderen ab.

### Anleitung

`GUIDED_GUIDANCE_PAD_SECONDS` steigt von 2 auf 4. Ein Wechsel mit Anleitung
ist damit `max(geplant, ⌈0,7 + Dauer + 4⌉)` lang; nach dem Ende der Stimme
bleibt mindestens rund 1 s Stille vor dem ersten Countdown-Ton.
`guidanceSeconds` wird beim Start festgelegt – laufende Sessions behalten
ihre Länge. Die Angabe „≈ n min mit Anleitung“ auf dem Start-Screen folgt
von selbst.

Ein kurzer Wechsel, den die Anleitung auf 15 s oder mehr streckt, bleibt
dunkel („Wechsel“), bekommt aber den Countdown.

### Start-Screen

In der Schrittliste des Start-Screens (`GuidedStartPage`, `data-guided-steps`)
und gleich in der Schrittliste der Detailseite (`GuidedStepsCard`) steht vor
einem Schritt, dessen Wechsel eine Pause ist, eine kleine Zeile „{n} s Pause“ (bzw. „m:ss Pause“
ab 60 s, über `formatNumber`/`formatStepClock`), gedämpft
(`text-content-muted`). Grundlage ist dieselbe Regel wie in
`resolveGuidedSections`: eine Funktion `isGuidedPause(steps, stepIndex)` in
`guided-steps.ts`, die beide nutzen. Pausierte Schritte (Einschränkung) zeigen keine
Pausenzeile.

## Was sich nicht ändert

- Import-Format, Datenmodell, Dexie-Version, Backup-Schema, Analyse-Export.
- Protokoll (`deriveGuidedProtocol`): Wechsel und Pausen erscheinen dort
  weiterhin nicht.
- Ansagen-Texte und ihre Erzeugung.
- Das Signal am Ende jeder Übung.

## Doku

- `docs/architecture/guided-templates.md`: Pause-Markierung, Bühne hell in
  der Pause, neue Signale und Frische, Pad 4 s, Start-Screen-Zeile.
- `docs/claude-projekt/import-format.md`: ein Satz bei `transitionSeconds` –
  „Ab 15 s gilt der Wechsel als Pause: heller Screen und Countdown-Töne.“
- `CLAUDE.md`: neue Test-Anker.

## Test-Anker

- Run-Screen: `data-guided-pause="true"` am `data-guided-run`-Element während
  einer Pause (auch pausiert). `data-guided-tone` der Bühne zeigt `light`.
- Start-Screen: `data-guided-step-pause` an der Pausenzeile.

## Tests

Unit (Vitest):

- `resolveGuidedSections`: `pause` bei 14 / 15 / 45 s geplant; erster
  Wechsel nie Pause; Seitenwechsel nie; Wechsel mit `guidanceSeconds` ≥ 15
  bei geplant 5 s → `pause: false`.
- `deriveGuidedRunState().dueSignal`: Countdown bei 3/2/1 s und Start bei 0
  für einen 45-s-Wechsel; keiner für einen 10-s-Wechsel; Countdown für einen
  durch die Anleitung auf ≥ 15 s gestreckten Wechsel; keine Töne nach
  `startNow`/`skip`; Frische (Ton 700 ms zu spät → nicht fällig); Pausieren
  und Weiter treffen die richtige Restzeit; Schlüssel mit `rewinds` nach
  `back`.
- `guidanceSeconds` mit Pad 4 s.
- Start-Screen-Text der Pausenzeile.

e2e (Playwright, beide iPhones):

- Vorlage mit einem 45-s- und einem 5-s-Wechsel: im 45-s-Wechsel helle Bühne,
  „PAUSE“, `data-guided-pause`; im 5-s-Wechsel dunkel ohne „PAUSE“.
- Pausieren in der Pause: Bühne bleibt hell, „Weiter“ läuft weiter.
- Knopf heißt „Pausieren“ (bestehende Tests in `guided-pause.spec.ts`
  anpassen; Caption „Pausiert“ bleibt als zugänglicher Text erhalten).
- Start-Screen zeigt „45 s Pause“ vor dem Schritt, nicht vor dem mit 5 s.

Am Ende die volle e2e-Suite.
