# Umbauplan

Konservativer Umbau nach der Architekturanalyse vom 2026-08-24. Stand des Codes:
Commit `3084f2b`. **Alle Zeilennummern in diesem Dokument beziehen sich auf diesen
Commit** und driften mit jeder Änderung — im Zweifel per Symbolnamen suchen.

Dieses Dokument ist so geschrieben, dass eine frische Sitzung es ohne erneute Analyse
abarbeiten kann. Die Begründungen sind Teil der Anweisung, nicht Beiwerk: der Abschnitt
„Bewusst nicht jetzt" verhindert genau die Refactorings, die beim Lesen des Codes als
Erstes ins Auge springen und trotzdem falsch wären.

**Vorher lesen:** [CLAUDE.md](CLAUDE.md) und
[.claude/skills/gym-book-architect/SKILL.md](.claude/skills/gym-book-architect/SKILL.md).
Jede Regel dort ist teuer erkauft.

## Arbeitsweise

- **Ein Schritt, ein Commit.** Die Schritte sind absichtlich klein genug dafür.
- Direkt auf `main`, keine Feature-Branches. **Nicht ungefragt pushen** — ein Push löst
  den Actions-Deploy nach `gym.andreasotten.de` aus.
- Nach jedem Schritt: `npm run check && npm test && npm run lint`.
- E2E nur an den markierten Phasen-Gates. Die Suite läuft seriell auf zwei
  WebKit-Projekten und ist der Wanduhr-Engpass — **vorher den Dev-Server neu starten**,
  sonst liefert `reuseExistingServer` still den alten Tailwind-Build.
- Commit-Nachrichten auf Deutsch im Stil des Repos: ein aussagender Satz als Betreff
  („Die aktive Woche sagt ohne Programm, woher die W1 kommt"), im Rumpf das *Warum*.

---

## Warum überhaupt

Die App ist in 43 Commits gewachsen, jeder davon durchdacht. Das Ergebnis ist
ungewöhnlich diszipliniert — null `any`, null `TODO`, kein auskommentierter Code, eine
wirklich reine Domänenschicht. Aber die Masse hat sich einseitig verteilt:

| Schicht | Prod-LOC | Test-LOC |
|---|---|---|
| `src/domain` | 2.509 | 2.611 |
| `src/db` | 2.850 | 2.456 |
| `src/lib` | 1.780 | 1.181 |
| **`src/pages` + `src/components`** | **10.288** | **0** |

Jede weitere Session-Funktion landet damit in der am schlechtesten geschützten Schicht.
Daraus folgt die eine Regel, die fast jede Entscheidung in diesem Plan trägt:

> **Immer *in* die getestete Schicht refaktorieren, nie *innerhalb* der ungetesteten.**

Reine Logik aus einer `.tsx` nach `domain/` zu ziehen erhöht die Sicherheit sofort, weil
der Code dort ankommt, wo er testbar ist. `SessionPage.tsx` intern in Komponenten zu
zerlegen kauft nur Zeilenzahl und bezahlt mit ungefangenem Risiko.

**Kein `@testing-library/react`.** Es ist installiert und ungenutzt — das ist der
richtige Zustand. jsdom kann nicht ausdrücken, was diese Komponenten tun
(`visualViewport`, Safe-Area, native Control-Größen, `vibrate`, `AudioContext`,
`speechSynthesis`, `wakeLock`); ein jsdom-Test davon prüft den eigenen Mock. Stattdessen
gilt das Muster von `edge-widget.ts`: **die Komponente misst, ein reines Modul
entscheidet** — und *das* wird getestet.

---

## Phase 0 — Netz spannen, kein Produktivcode

- [x] **1. `src/db/bootstrap.test.ts` anlegen.**
  [bootstrap.ts](src/db/bootstrap.ts) hat 273 LOC und wird von **keinem** Unit-Test
  importiert — dabei steht mit `seedSampleData` das Fundament von 9 der 10 e2e-Specs
  darin. Eine Regression dort lässt die ganze Playwright-Suite auf maximal verwirrende
  Weise fallen.
  Abdecken: `bootstrapAppData` legt **nur** die Settings-Zeile an (kein erfundener
  Trainingsverlauf); das Beispielprogramm materialisiert vollständig (Programm, 8 Wochen,
  Progressionsregeln, eine abgeschlossene Session); **und der 8,3-%-Asymmetriewert wird
  festgenagelt** — CLAUDE.md warnt e2e-Autoren ausdrücklich vor ihm, aber nichts hält ihn
  fest.

- [x] **2. `src/domain/tracking.test.ts` anlegen.**
  [tracking.ts](src/domain/tracking.ts) ist ungetestet, obwohl CLAUDE.md die Falle
  benennt: „Call sites that have a `loadKind` **must** pass it — the one-argument form
  silently keeps showing kg."
  Abdecken: zweiargumentiges `supportsWeight`/`supportsBand`, `supportsHeight`
  fragt die Übung allein (nicht den `trackingMode`), `loadKind === undefined` zählt als
  `'weight'`. **Voraussetzung für Phase 2**, weil `SET_LOG_FIELDS` eine Tabelle genau
  dieser Prädikate ist.

- [x] **3. `npm run lint` in CI aufnehmen** —
  [.github/workflows/pages.yml](.github/workflows/pages.yml), vor `check`.
  `eslint-plugin-react-hooks` ist konfiguriert, aber nicht scharfgeschaltet, und
  `exhaustive-deps` ist genau in Phase 2 wertvoll.

**Gate:** `npm test` grün. Kein e2e nötig.

---

## Phase 1 — Freie Gewinne, nur in getesteten Schichten

- [x] **4. `src/db/normalize.ts` anlegen** mit einem `normalizeOptionalText`,
  `normalizeOptionalNumber`, `assertName`, `ensureSettings`, `SETTINGS_ID`.
  Heute existieren `normalizeOptionalText` **4×**, `normalizeOptionalNumber` 2×,
  `assertName` 2×, `ensureSettings`+`SETTINGS_ID` 2×.
  **Die optionale Signatur nehmen** (`value?: string`) — das repariert nebenbei
  [program-actions.ts:10](src/db/program-actions.ts#L10), dessen Kopie `value: string`
  deklariert, während Aufrufer `undefined` übergeben. Nur `strict: false` verdeckt das.
  Außerdem die drei lokal nachgebauten `createId`
  ([program-actions.ts:6](src/db/program-actions.ts#L6),
  [bootstrap.ts:13](src/db/bootstrap.ts#L13),
  [session.ts:27](src/domain/session.ts#L27)) durch `@/lib/id` ersetzen —
  `domain/superset.ts` importiert es bereits, das ist also keine neue Schichtkante.

- [x] **5. Toten Code löschen** (verifiziert ohne jede Referenz):
  [StatCard.tsx](src/components/StatCard.tsx) als ganze Datei — abgelöst von
  `ui/StatusCard.tsx`, das alle vier Seiten benutzen —, dazu `formatSetLogWithSide`,
  `isInvalidNumberInput`, `ExerciseTargetFieldsValues`.
  **`listBandLevels` und `listExercises` bleiben stehen** — siehe „Bewusst nicht jetzt".

- [x] **6. Die zwei unerreichbaren Inline-Anlage-Zweige entfernen.**
  `addSessionExercise` und `saveTemplateExercise` können jeweils *nebenbei* eine neue
  `Exercise` anlegen — mit schwächerer Validierung als `exercise-actions.ts` (kein
  `assertName`, rohes `loadKind`, rohes `tracksHeight`). Beide Zweige sind vom UI nicht
  erreichbar: `SessionPage.tsx:820` und `TemplateDetailPage.tsx:464` steigen vorher aus,
  wenn keine bestehende `exerciseId` gewählt ist. Danach `exerciseName`, `instructions`,
  `tempo`, `mediaAssetId`, `tracksHeight` aus `SaveTemplateExerciseInput` streichen — der
  einzige Aufrufer übergibt sie nie.
  Ergebnis: **ein** validierender Schreibweg auf `db.exercises` statt drei.

- [x] **7. Den rohen Enum reparieren.**
  [TemplateDetailPage.tsx:875](src/pages/TemplateDetailPage.tsx#L875) rendert
  `reps_weight` unübersetzt an den Nutzer. `SessionPage.tsx:1509` macht dasselbe korrekt
  über `formatTrackingMode` ([format.ts:15](src/lib/format.ts#L15)), dessen Doc-Kommentar
  genau diese Reparatur beschreibt — sie ist nur in einer der beiden Seiten gelandet.
  Eine Zeile, eigener Commit.

- [x] **8. Effekte 1+2 in `SessionPage` zusammenlegen** —
  [:265](src/pages/SessionPage.tsx#L265) und [:271](src/pages/SessionPage.tsx#L271)
  haben identische Dep-Arrays und dieselbe Wirkung (Fokus auf die erste Übung setzen bzw.
  zurücksetzen). Das ist eine Regel, nicht zwei.

- [x] **9. Die billigen `strict`-Flags einschalten** in [tsconfig.json](tsconfig.json):
  `noImplicitAny` (es gibt null `any`), `strictFunctionTypes`, `strictBindCallApply`,
  `strictPropertyInitialization` (die Dexie-Tabellen nutzen bereits `!:`),
  `noImplicitThis`, `alwaysStrict`, `useUnknownInCatchVariables` (die 29
  `error instanceof Error`-Stellen *sind* bereits die geforderte Verengung).
  **`strictNullChecks` bleibt aus.** Erwarteter Diff: nahe null. Falls doch Fehler
  auftauchen, sind das echte Funde — einzeln bewerten, nicht wegcasten.

**Gate:** `npm test`, `npm run check`, `npm run lint`, plus **ein voller e2e-Durchlauf**
am Phasenende. Danach bis Phase 3 keiner mehr.

---

## Phase 2 — Herausziehen nach `domain` (die wertvollste Phase)

- [ ] **10. `SetLogValuesInput` nach `src/domain/` verschieben**, aus
  [session-actions.ts:29](src/db/session-actions.ts#L29) — neben `SetValues` in
  `domain/history.ts` oder als eigenes Modul.
  **Das ist der Blocker für Schritt 11:** `collectSetLogChanges` gibt diesen Typ zurück,
  und `domain` darf `db` nicht importieren. Aus `session-actions.ts` re-exportieren, dann
  ändert sich keine Aufrufstelle.

- [ ] **11. `src/domain/set-log-draft.ts` anlegen.**
  Aus [SessionExerciseStage.tsx](src/components/SessionExerciseStage.tsx) (Zeilen 75–240)
  wandern `createSetLogDraft`, `collectSetLogChanges`, `findInvalidSetLogFields`,
  `adoptPlaceholders` plus `SET_LOG_FIELDS`, `STEP_BY_FIELD`, `SET_LOG_FIELD_UNITS`,
  `SET_LOG_FIELD_LABELS`. Alle stehen bereits auf Modulebene und sind rein — sie
  importieren nichts aus React. Das ist Domänenlogik in einer `.tsx`.
  **`ActiveSetEditor` ab Zeile 298 wird nicht angefasst. Harte Grenze.** Der
  Kommentar dort nennt es „die heikelste Stelle der App", und CLAUDE.md verbietet
  ausdrücklich, die Maschinerie zu vereinfachen: die feldweise Draft-Abgleichung, der
  600-ms-Autosave, `adoptPlaceholders` bei Abschluss — jede dieser Zeilen ist ein Bug,
  der schon einmal Daten gekostet hat.
  `set-log-draft.test.ts` im selben Commit, mit den Fällen: ein **ungültiges** Feld wird
  übersprungen, nicht als `undefined` geschickt (Dexies `update` löscht bei `undefined` —
  das ist genau der Datenverlust); ein **bewusst geleertes** Feld *wird* als `undefined`
  geschickt; deutsches Komma geht hin und zurück; `adoptPlaceholders` füllt nur leere
  *unterstützte* Felder.
  Ergebnis: `SessionExerciseStage.tsx` verliert ~180 LOC, und die Hälfte der heikelsten
  Stelle ist erstmals unit-getestet.

- [ ] **12. `src/domain/timer-notifications.ts` anlegen.**
  Eine reine Entscheidungsfunktion über
  `(restTracks, setTimer, now, realNow, soundEnabled, bereitsGemeldeteKeys)` →
  `{ vibrate?, chime, speak?, neueKeys }`. Die Effekte 6, 8 und 9 in `SessionPage`
  ([:345](src/pages/SessionPage.tsx#L345), [:416](src/pages/SessionPage.tsx#L416),
  [:449](src/pages/SessionPage.tsx#L449)) schrumpfen zu Dispatchern. Dabei verschwinden
  zwei Altlasten: die wortgleiche Dopplung des Vibrations-und-Ton-Blocks
  (369-385 ≡ 423-429) und das Zurückparsen des `endsAt` aus einem String in Zeile 378
  (`key.slice(key.lastIndexOf('@') + 1)`).
  Der `expiredRestTrackKeys`-String **bleibt** als `useMemo`-Dep-Key — der Kommentar dort
  erklärt, warum er muss (Identitätswechsel bei `useLiveQuery`).
  **Zwei Uhren als Parameter, nicht eine:** die Effekte lesen heute bewusst ein frisches
  `Date.now()` für die Frischeprüfung, getrennt vom getickten `now`. Das ist kein
  Versehen.
  Testfälle: zwei Spuren im selben Tick → **eine** Vibration, **ein** Ton · Ablauf älter
  als `CHIME_MAX_DELAY_MS` → Vibration ja, Ton nein · Satz-Timer-Cue älter als 2 s →
  **weder** Sprache **noch** Vibration · Halbzeit und Zehn-Sekunden-Marke nie im selben
  Fenster · eine verlängerte Spur erzeugt einen **neuen** meldbaren Key · der Ablauf
  bleibt ton-only, nie gesprochen.

- [ ] **13. `src/hooks/useNowTicker.ts` anlegen** (neues Verzeichnis).
  Der Ticker (`useState` + `setInterval(1000)` + `visibilitychange` + Cleanup) steht
  dreimal fast wortgleich: [SessionPage.tsx:303](src/pages/SessionPage.tsx#L303),
  [ActiveSessionBar.tsx:50](src/components/ActiveSessionBar.tsx#L50),
  [SessionStatsHeader.tsx:39](src/components/SessionStatsHeader.tsx#L39) — inklusive
  desselben deutschen Kommentars.
  **`enabled` ist Pflichtparameter ohne Default**, und jede Aufrufstelle behält eine
  Kommentarzeile, warum ihr Flag so ist. Der Unterschied ist tragend: `SessionPage`s
  Ticker ist absichtlich *bedingt*, weil sein `now` Prop jeder Blockkarte ist — immer zu
  ticken würde die ganze Liste sekündlich neu zeichnen, auch während ein Zahlenfeld den
  Fokus hat. Ohne die Kommentare vereinfacht das der Nächste zu „immer an".

- [ ] **14. `strictNullChecks` für `src/domain` + `src/lib`.**
  Über ein `tsconfig.strict.json`, das von der Basis erbt und ein eigenes `include` hat,
  plus ein `check:strict`-Script. Das `include` wächst in den späteren Phasen; am Ende
  wandert das Flag in `tsconfig.json` und die Extradatei fällt weg.

**Gate:** `npm test`, beide Checks. E2E nur
[session-logging.spec.ts](e2e/session-logging.spec.ts) und
[session-announcements.spec.ts](e2e/session-announcements.spec.ts) auf
`--project="iPhone 13"` — Schritt 12 rechtfertigt das.

---

## Phase 3 — Integrität in `src/db`

Vorbemerkung, damit niemand nach fehlschlagenden Tests sucht: `fake-indexeddb` erzeugt
die Verschränkung nicht, die die fehlenden Transaktionen zulassen. **Kein Test kann hier
vorher rot sein.** Die Sicherheit kommt daher, dass die Änderungen rein additiv sind.
Die neuen Tests prüfen deshalb den *Scope* — also Dexies Regel, dass ein `await` auf
etwas anderes als Dexie die Transaktion schließt.

- [ ] **15. `updateSetLogValues` klammern**
  ([session-actions.ts:251](src/db/session-actions.ts#L251)). Liest heute
  `workoutSetLogs` **und** `bandLevels` und schreibt dann — ohne Transaktion, während die
  direkten Nachbarn `toggleSetCompletion` und `deleteSetLog` dieselben Tabellen sauber
  klammern. Der Scope muss `bandLevels` enthalten (Lesezugriff in Zeile 285) und alles,
  was `isSetLogEditable` anfasst. Alle `await` darin sind Dexies eigene.
  **Die `'x' in values`-Prüfungen bleiben strukturell unverändert** — sie sind der
  Unterschied zwischen „Feld nicht angefasst" und „Feld bewusst geleert".

- [ ] **16. `finishSetTimer` klammern und `clearSetTimer` absichern.**
  [`finishSetTimer`](src/db/session-actions.ts#L834) fasst drei Tabellen an, ruft
  `updateSetLogValues` und schreibt danach die Session — ohne Klammer. Bricht der zweite
  Schritt ab, steht die Zeit im Satz, aber der Timer zeigt weiter darauf. Eine
  Transaktion über beides.
  [`clearSetTimer`](src/db/session-actions.ts#L849) hat als einzige Timer-Aktion **gar
  keinen Guard** — Active-Prüfung ergänzen, aber vorher prüfen, dass sie sich nicht mit
  `closeSession` beißt, das den `setTimer` ohnehin räumt.
  Neue Tests in `actions.test.ts`: `finishSetTimer` schreibt `seconds` **und** räumt den
  Timer, mit einem bandtragenden Satz im Spiel, damit der Scope beweisbar `bandLevels`
  einschließt; `updateSetLogValues` mit unbekannter `bandId` lässt `bandId` und
  `bandNameSnapshot` unangetastet; `clearSetTimer` auf einer abgeschlossenen Session.

- [ ] **17. Die fünf Setter in [settings-actions.ts](src/db/settings-actions.ts)
  klammern** — alle sind ungeklammertes Read-Modify-Write (`ensureSettings()` dann
  `put({...current, …})`), zwei nebenläufige Setter verlieren einen Schreibvorgang. Nach
  Schritt 4 ist `ensureSettings` geteilt, das sind fünf Einzeiler. Zum Vergleich:
  `program-actions.ts` schreibt dieselbe Tabelle *innerhalb* von Transaktionen — dieselbe
  Tabelle mit zwei Konsistenzniveaus.

- [ ] **18. `session-actions.ts` am Timer-Schnitt teilen.**
  886 LOC, fünf Belange. Die Zeilen 539–851 (Pausen- und Satz-Timer) sind ein
  eigenständiger Schnitt ohne Kopplung an die Set-Log- und Übungs-CRUD → nach
  `src/db/session-timer-actions.ts`.
  Prüfen, dass keine Transaktion über die Naht läuft und dass
  `startSessionFromTemplate`s Active-Prüfung *innerhalb* seiner Insert-Transaktion
  unberührt bleibt (ohne sie erzeugen zwei schnelle Taps zwei aktive Sessions).
  **[actions.test.ts](src/db/actions.test.ts) (1.767 LOC) im selben Commit an derselben
  Naht teilen** — die Sammeldatei ist der Grund, warum niemand die Actions-Schicht
  anfassen will, während `band-`/`exercise-`/`history-` längst eigene Testdateien haben.

- [ ] **19. `strictNullChecks` für `src/db`** (`include` in `tsconfig.strict.json`
  erweitern). Bewusst *nach* Schritt 4, sonst repariert man
  `program-actions.ts:10` zweimal.

**Gate:** `npm test`, beide Checks, **voller e2e-Durchlauf**. Danach ist der Umbau
abgeschlossen.

---

## Bewusst nicht jetzt

Diese Liste ist Teil der Anweisung. Jeder Punkt darauf sieht beim Lesen des Codes wie
eine offensichtliche Verbesserung aus und ist trotzdem keine.

| Vorschlag | Warum nicht |
|---|---|
| **`SessionPage.tsx` in Komponenten zerlegen** (die 6 `renderX`) | Größter Diff in der am wenigsten getesteten Datei, ohne Korrektheitsgewinn — und gefährdet direkt die Invariante „genau ein `role="timer"` im DOM", die heute durch ein über drei Render-Funktionen verteiltes Ausschlussargument gilt. Falls je: **nur** `renderSessionTimerBar` und `renderSheetFooter` zusammen als *eine* Komponente, die alle Zweige besitzt — dann ist die Invariante lokal prüfbar. |
| **`lib/export.ts` → `db/`** | Die Schichtverletzung ist real (es importiert `db` und schreibt 13 Tabellen), aber CLAUDE.md nennt die Datei zweimal namentlich per Pfad, sie besitzt `SNAPSHOT_SCHEMA_VERSION`, hat 594 LOC mit 554 LOC Test — und ein Fehler dort kostet still das einzige Backup des Nutzers. Gewinn: Namensreinheit. Falls die Schicht stört: ein Satz in CLAUDE.md, kein `git mv` durch den Backup-Pfad. |
| **`domain/session-summary.ts` von `@/lib/format` lösen** | `formatNumber` ist ein reiner `Intl`-Wrapper ohne I/O, der Zyklus ist typ-only und zur Laufzeit gelöscht. Ein injizierter Formatter kostet ein Argument an jeder Aufrufstelle und in jedem bestehenden Test. Die Regel, die zählt („jede gerenderte Zahl geht durch `formatNumber`"), wird von der jetzigen Anordnung besser bedient. |
| **`lib/edge-widget.ts` → `domain/`** | Es ist reine Geometrie und wäre dort richtiger. Aber CLAUDE.md nennt es namentlich per Pfad und erklärt die Aufteilung daran. Verschieben bricht den Doc-Link und ändert sonst nichts. |
| **Generische `reorder*`/`applySupersetPlan`-Wrapper** | `reorderSessionExercises` und `reorderTemplateExercises` sind zeilengleich bis auf Tabelle und Typ — Gewinn also ~35 Zeilen. Kosten: die Session-Variante trägt einen Guard, den die Template-Variante nicht hat (`status !== 'active'`), und der ist eine Invariante. Eine generische Funktion unter `strict: false` ist genau der Ort, an dem dieser Guard zum optionalen Flag wird, das jemand vergisst. Falls doch: Guard **an der Aufrufstelle**, außerhalb des Generischen. |
| **Die 29 `error instanceof Error`-Ternäre entdoppeln** | Jeder Fallback ist ein eigener deutscher Satz — es gibt keinen dominanten String. Ein Helfer müsste ihn als Parameter nehmen und spart 38 Zeichen, während er die Verengung versteckt, die `useUnknownInCatchVariables` gerade verlangt. Nettowert ≈ 0, und es macht den Code *weniger* strict-tauglich. |
| **`ui/Field.tsx` überall durchsetzen** (14 Kopien des Klassenstrings in 6 Dateien) | Vom gewählten Umfang ausgenommen. Native Control-Größen sind genau das, worüber jsdom lügt — `<select>` kollabierte unter WebKit schon einmal auf 22px. Nur der Zugänglichkeits-e2e kann das absichern, und der ist teuer. Der *sichtbare* Teil des Problems (roher Enum) wird in Schritt 7 einzeln repariert. **Falls es später doch kommt: `RestMode.tsx` ausnehmen** — es setzt `focus-visible:ring-accent-contrast`, weil der Tinte-Fokusring auf der einen dunklen Fläche der App unsichtbar wäre. |
| **Eine einzige Zielzeilen-Formatierung statt 5** | Die fünf Kopien sind **nicht** identisch: `describeExerciseTarget` schreibt `3 × 8 Wdh` mit echtem Malzeichen und liest `targetBandNameSnapshot`; die Template-Seiten schreiben `3 x 8 Wdh` mit ASCII-`x` und lösen das Band über eine `bandNameById`-Map auf, weil Template-Übungen nur eine `targetBandId` tragen; `TemplateProgressionSection` hängt zusätzlich `Pause 90s` an und fällt auf `'Keine Zielwerte gesetzt'` zurück. Das zu vereinheitlichen ist eine **Textentscheidung auf vier Screens**, keine Entdopplung — und gehört als solche entschieden. |
| **`listBandLevels`/`listExercises` löschen** | Sie sehen tot aus, sind es aber nicht: ihre Rümpfe sind byteweise identisch mit acht inline in Seiten wiederholten `useLiveQuery`-Abfragen (`db.bandLevels.orderBy('orderIndex')` 5×, `db.exercises.orderBy('name')` 3×). Sie sind die *nicht übernommene* Lösung. Löschen wäre die falsche Richtung; Übernehmen gehört in einen größeren Umfang als diesen. |

---

## Invarianten aus CLAUDE.md, die dieser Plan berührt

| Invariante | Betroffen von | Schutz |
|---|---|---|
| „`ActiveSetEditor` keeps the old machinery verbatim … Do not 'simplify' it" | Schritt 11 | Harte Grenze bei Zeile 298. Nur die Modul-Helfer und Feldtabellen bewegen sich. Der Commit *stärkt* die Regel: die Hälfte der Maschinerie wird erstmals unit-getestet. |
| Genau ein `role="timer"` im DOM | Schritt 12 | Die Notification-Extraktion fasst kein JSX an. Die Komponenten-Zerlegung ist deshalb draußen. |
| `updateSetLogValues` schreibt nur vorhandene Keys; Dexies `update` löscht bei `undefined` | Schritte 11, 15 | Die `'x' in values`-Prüfungen bleiben strukturell unverändert; „ungültig überspringen vs. bewusst leeren" ist ein expliziter Testfall. |
| Cue-Regeln: Zeitstempel statt Restsekunden · 2 s Frische **gilt auch für die Vibration** · Ablauf bleibt ton-only · Schwellen 45 s/25 s plus Code-Guard | Schritt 12 | Zwei Uhren als Parameter; alle sechs Regeln als benannte Testfälle. |
| `primeTimerSound` muss sich über `statechange` und `visible` neu scharfstellen | Schritt 13 | Effekt 4 ([:289](src/pages/SessionPage.tsx#L289)) bleibt unangetastet — er gehört nicht zur Notification-Extraktion und nicht zum Ticker. |
| Additive `undefined`-bedeutet-X-Felder: `includeWarmup`, `loadKind`, `tracksHeight`, `timerSoundEnabled`, `keepScreenAwakeEnabled`; `normalizeTracksHeight` schreibt **nie** ein `false` | **`strictNullChecks`** — das größte Einzelrisiko im Plan | Defaults **nur an Lesestellen** (`?? DEFAULT`). Niemals ändern, was geschrieben wird. Kein Feld wird zur Pflicht. Ein reflexhaftes `?? false`, das plötzlich `false` persistiert, bricht den Export-Roundtrip und alle „undefined zählt als an"-Defaults auf einmal. |
| `startSessionFromTemplate`s Active-Prüfung bleibt *innerhalb* der Insert-Transaktion | Schritt 18 | Die Naht liegt bei 539, weit davon entfernt — beim Teilen trotzdem prüfen. |
| Abgeschlossene Sessions sind unveränderlich | Schritte 15–17 | Nur Klammern hinzufügen, keine Guards umbauen. |
| `keepScreenAwake()` hängt an `activeSession?.id`, nicht am Session-Objekt | `strictNullChecks` in `AppShell.tsx` (späteres `include`) | Die Optional Chain nicht „reparieren" — `useLiveQuery` ersetzt die Objektidentität nach jedem abgehakten Satz. |
| Der DOM-Vertrag der e2e-Tests: `data-block-status`, `data-set-row`, `data-session-stats`, `data-session-estimate`, `data-rest-widget`, `data-sheet` | jede Komponentenänderung | Wie eine öffentliche API behandeln. Vor und nach jedem solchen Commit: `grep -rho 'data-[a-z-]*' e2e/ \| sort -u` vergleichen. |

---

## Verifikation

```bash
npm run check         # tsc -b --noEmit
npm run check:strict  # ab Schritt 14
npm test              # vitest run, 350 Tests
npm run lint          # ab Schritt 3 auch in CI

# E2E nur an den Gates. Dev-Server vorher neu starten!
npm run test:e2e -- --project="iPhone 13"   # schnelles Gate
npm run test:e2e                            # voll, beide Projekte
```

Einmal manuell zu prüfen, weil kein Test es fängt: sollte je eine
`useLiveQuery(() => db.x…)`-Abfrage auf eine Aktionsfunktion umgestellt werden, dass die
Reaktivität erhalten bleibt. Sie bleibt es — Dexie verfolgt Lesezugriffe in der
Observable-Zone unabhängig davon, welche Funktion sie ausführt — aber ein stiller Verlust
erzeugt einen Screen, der nur beim Reload aktualisiert.

---

## Danach, als eigene Arbeit

Nicht Teil dieses Umbaus, aber real. Die e2e-Produktlücken sind **keine
Umbau-Absicherung**; sie während des Umbaus zu schreiben verdoppelt die Wanduhr jedes
Phasen-Gates ohne Sicherheitsgewinn in der Phase, die es bezahlt:

- `ProgramsPage` hat keinen funktionalen e2e-Test — nur den Smoke-Durchlauf der
  Zugänglichkeitsschleife. Kein Programm-CRUD, keine Wochen, keine Progressionsregeln.
  (Niedrige Priorität, solange das Feature ungenutzt bleibt.)
- Der Backup/Restore-Dateiflow über die Einstellungen (Share vs. Download, abgebrochener
  Share) ist nur auf Unit-Ebene geprüft.
- `HistorySessionPage` wird nur auf zwei Strings geprüft (`'grün'`, `'25 cm'`).
- Ohne Test: `lib/media.ts`, `lib/storage.ts`, `src/store`, Wildcard-Route,
  `ErrorBoundary`, Service-Worker (e2e läuft gegen den **Dev-Server**, nicht gegen einen
  Build).

**Der größte Einzelhebel auf Laufzeit *und* Stabilität der e2e-Suite:** die 137
`waitForTimeout`-Aufrufe (zusammen 113,6 s feste Wartezeit allein in den Literalen, über
die vielfach aufgerufenen Helfer deutlich mehr) durch Web-First-Assertions ersetzen.
