# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server — http://localhost:5173/
npm run check     # tsc -b --noEmit (typecheck only)
npm test          # vitest run (jsdom + fake-indexeddb)
npm run test:e2e  # playwright, WebKit on two iPhone sizes (starts the dev server itself)
npm run lint      # eslint .
npm run build     # tsc -b && vite build
```

Single test file / single case:

```bash
npx vitest run src/domain/session.test.ts
npx vitest run src/db/actions.test.ts -t "materializes progression rules"
npx vitest            # watch mode
```

CI ([.github/workflows/pages.yml](.github/workflows/pages.yml)) runs `check` → `test` → `build` on push to `main`, then deploys `dist/` to GitHub Pages. Lint is **not** in CI. `tsconfig.json` has `strict: false`, so the typecheck is permissive — don't rely on it to catch nullability bugs.

## What this app is

Offline-first PWA training log ("Gym Book"), deployed as a static site to GitHub Pages, served from the custom domain `gym.andreasotten.de` at the root path (`public/CNAME` pins it; without that file every Actions deploy resets the Pages custom-domain setting). The domain sits behind Cloudflare Access, so the app is not publicly reachable — that is deliberate: it keeps a private, non-commercial app out of the Impressum (§ 5 DDG) and privacy-notice obligations that attach to a publicly available site. Single-user, no backend, no sync. All domain data lives in IndexedDB via Dexie. [.claude/skills/gym-book-architect/SKILL.md](.claude/skills/gym-book-architect/SKILL.md) is the binding scope/architecture contract and loads automatically (a mirror lives in `.trae/` for the Trae editor — change both together); read it before designing features; it lists what v1 must include and must exclude (no backend, no cloud sync, no multi-user, no video upload, no deload automation).

## Architecture

Layering is strict and worth preserving:

- [src/domain/](src/domain/) — pure types + pure business rules. No Dexie, no React. [session.ts](src/domain/session.ts) holds `materializeSession` and `calculateAsymmetryPercent`.
- [src/db/](src/db/) — the only place that touches Dexie. [appDb.ts](src/db/appDb.ts) declares the schema; `*-actions.ts` files are the write API (session, template, program, exercise, test, media, settings) and `history-queries.ts` holds the read-side aggregations. UI never writes to `db` directly.
- [src/pages/](src/pages/) — routed screens. They read via `useLiveQuery` from `dexie-react-hooks` (reactive, re-renders on IndexedDB writes) and mutate by calling `*-actions` functions.
- [src/store/ui-store.ts](src/store/ui-store.ts) — Zustand, **ephemeral UI state only**: focused exercise, the open focus sheet (`openSessionBlockKey`), online/offline, SW update available, install prompt. Never domain records, and nothing that must survive a reload — the rest timers and the set timer (`restTimers` / `setTimer`) live on `WorkoutSession` in IndexedDB for exactly that reason. Whether a sheet was open is not training information; after a reload you land in the list and the clocks keep running.

### The plan/execution split (the core invariant)

`WorkoutTemplate` + `WorkoutTemplateExercise` describe the *plan*. Starting a workout **materializes** an independent execution copy — `WorkoutSession` + `WorkoutSessionExercise` + `WorkoutSetLog` — via `materializeSession`. Editing a running session (adding, skipping, reordering exercises, changing targets) must never mutate the template. Session rows carry `*Snapshot` fields (`templateNameSnapshot`, `exerciseNameSnapshot`, `programNameSnapshot`, `resolvedProgramWeek`) so history stays historically correct when templates, programs, or the active week later change.

### Supersets

Two or more consecutive exercises can be linked into a superset. The model is one optional field — `supersetGroupId` on `WorkoutTemplateExercise` (the plan) and on `WorkoutSessionExercise` (the snapshot copy) — with one invariant: **members of a group are always contiguous in `orderIndex`**. `areGroupsContiguous` guards both reorder actions; the UI never lets you break it either, because the block header's arrows move the whole group and a member's own arrows only sort *within* it. Members carry **no position letters** — "A"/"B" only restated the order the block already shows and cost the exercise name the width it needs on a phone; the accessible name of a superset block therefore lists the exercise names (`Supersatz: Front Squat und Bulgarian Split Squat`), which is also what keeps two blocks distinguishable for tests and voice control.

All grouping rules are pure and shared between plan and execution — [superset.ts](src/domain/superset.ts) works on any `{ id, orderIndex, supersetGroupId? }`, so `groupTemplateExerciseWithPrevious` and `groupSessionExerciseWithPrevious` are the same logic against different tables. `planUngroup` splits a group when a *middle* member leaves (front run keeps the id, back run gets a new one) and dissolves a run left with one member; `normalizeTemplateExerciseOrder` does the same cleanup after a deletion. Grouping in a running session only ever touches the session copy — the template must not change mid-workout.

Set-by-set alternation is `resolveNextFocus` ([session.ts](src/domain/session.ts)): inside a group the focus moves to the partner as soon as the current *round* (that set number, both sides on a unilateral exercise) is complete, not when the whole exercise is done. Without a group the old behaviour stands — advance only after the last set.

Set materialization rules, enforced in `materializeSession` and mirrored in `addSessionExercise`: **at most one warmup set** per exercise (`setKind: 'warmup'`, `setNumber: 0`, `side: 'both'`) — skipped when the template exercise carries `includeWarmup: false` — then `workSetCount` work sets; unilateral exercises get mirrored `left`/`right` rows at every set number. `deleteSetLog` can remove a single row from a running session afterwards, one side at a time, so the row count is not a derived value.

### Progression

Calendar-week based, never session-count based. `startSessionFromTemplate` resolves the week as `settings.weekOverride ?? program.activeWeek ?? 1`, looks up the matching `ProgramWeek`, and folds its `ProgressionRule` targets over the template targets (`progressionRule.targetX ?? templateExercise.targetX`) into the session snapshot. The resolved week is then frozen on the session.

`startSessionFromTemplate` checks for an existing `active` session **inside** the insert transaction and returns that id instead of starting a second one — the check must stay in the transaction or two fast taps create two active sessions. `abortSession` and `completeSession` both go through `closeSession`, which only acts on active sessions.

Completed sessions are immutable — `toggleSetCompletion` / `updateSetLogValues` bail out via `isSetLogEditable`, and `reorderSessionExercises` no-ops on non-active sessions. Keep new mutations behind the same guard.

`updateSetLogValues` only writes keys that are present in its input. This matters: Dexie's `Table.update` deletes any property whose value is `undefined`, so passing a failed parse straight through would silently destroy stored values. Parse user input with `parseNumberInput` from [number-input.ts](src/lib/number-input.ts), which distinguishes empty from invalid.

### Load: kilos or bands

An exercise carries **either** a weight in kg **or** a resistance band, never both — `Exercise.loadKind` (`'weight' | 'band'`, `undefined` counts as `'weight'`, same additive trick as `includeWarmup`). `supportsLoad` in [tracking.ts](src/domain/tracking.ts) says whether the exercise has a load at all; `supportsWeight(trackingMode, loadKind)` and `supportsBand(trackingMode, loadKind)` decide which field the UI shows. Call sites that have a `loadKind` **must** pass it — the one-argument form silently keeps showing kg.

Band levels live in their own table (`bandLevels`, Dexie `version(3)`), edited in Settings via [BandLevelsSection.tsx](src/components/BandLevelsSection.tsx) and [band-actions.ts](src/db/band-actions.ts). `orderIndex` is the content, not cosmetics: it is the *only* thing that makes "gelb" lighter than "rot", and it drives the progress chart's y-axis. Reorder rewrites it as a dense 1-based sequence, like `reorderTemplateExercises`.

Set logs carry **two** flat fields, `bandId` plus `bandNameSnapshot`: the id resolves the rank for the chart, the name keeps history readable after a rename or deletion — a dangling id costs a chart point, never an entry. `updateSetLogValues` resolves the name itself from `bandLevels` and writes both together (or clears both); an unknown id is ignored rather than stored. `deleteBandLevel` therefore leaves set logs alone and only clears `targetBandId` on template exercises and progression rules. For the same reason `assertReferentialIntegrity` in `export.ts` deliberately does **not** check band references — it would reject a user's own backup.

`progressMetricFor(trackingMode, loadKind)` returns the `'band'` metric, and `buildProgressSeries` takes a `bandRank` resolver; `ProgressChart` gets `formatValue` so the axis reads "grün" instead of "3" and drops the numeric delta.

### The session screen: list outside, sheet inside

[SessionPage.tsx](src/pages/SessionPage.tsx) shows the running workout as a **list of blocks** — one card per exercise, or one per superset group. The sets themselves are not in the list. They live in a **full-height sheet** ([ui/Sheet.tsx](src/components/ui/Sheet.tsx)) that opens over it — in a superset, both members, so alternating from set to set needs no view change.

The split exists because the running exercise used to compete with a sticky strip, the card list and the pause bar at once; mid-set you had to search. Now: one exercise, one set, one large action.

- **It opens** on a tap on an exercise row, on the bottom bar, or on a rest chip. **Never automatically on session start** — you walk to the rack first and want to read the plan — and **never** because a timer expired.
- **It closes** on swipe-down, the close button, Escape, and by itself once its block has no open set left. It deliberately does *not* jump on into the next block: between two exercises you rerack, drink, walk. A switch *within* a superset stays in the sheet.
- Its footer is anchored to `window.visualViewport`, not to the sheet's end. Without that, iOS pushes the big button under the keyboard the moment a number field takes focus.
- Exactly one `role="timer"` stays in the DOM. With the sheet closed that is `renderSessionTimerBar()` in the page's bottom bar; with it open, the stage's set-timer panel while a set runs, otherwise the first rest chip in `renderSheetFooter()`. Both branches read the same `setTimerRemainingSeconds > 0`, so no coordination is needed. Outside the session that one timer is the shell's [ActiveSessionBar.tsx](src/components/ActiveSessionBar.tsx), which only renders where the session's own bar does not.
- **You can leave without ending.** The header slot that carries the Einstellungen link everywhere else carries a `ChevronDown` inside a session ("Session minimieren"), and it does nothing but `navigate('/')` — nothing is written, the session stays `active`. Before that, the only ways out of the list were abort, complete, or a detour through Settings. The counterpart is `ActiveSessionBar`: a lime strip above the bottom nav on **every** other screen, showing the template name, the number that is currently being waited on (set timer, else next rest, else session duration — the same ranking as `renderSessionTimerBar`) and the set count, and tapping it anywhere goes back in. Leaving is only cheap if the session is still visible afterwards, which is why the strip is not optional and why Home no longer carries a resume card of its own.
- The open block is keyed by *block*, but a superset changes its group id when you link or unlink. An effect in `SessionPage` pulls the key back to the focused exercise's block, otherwise the sheet vanishes mid-gesture.
- **Nothing is logged from the list.** Every exercise row — including a finished one on the forest-green card — only opens the sheet. There used to be a check button that ticked the next set straight from the list; it wrote *no* values (set logs are materialized empty), so it silently produced completed sets with nothing in them, and next to the row's own tap target it mostly confused. One path in, one place that writes.
- **A rest starts only by completing a set.** The bottom bar used to carry a clock button that started one by hand; a rest without a set before it does not happen in training.
- **The header strip carries three numbers, and the third one is a forecast.** `DAUER`, `SÄTZE` and `NOCH` live in [SessionStatsHeader.tsx](src/components/SessionStatsHeader.tsx). `estimateRemainingSessionSeconds` ([session-estimate.ts](src/domain/session-estimate.ts)) sums the plan cost of the open set rows — work time from `targetSeconds` (via `resolveSetTimerSeconds`, so the estimate assumes the number the timer will actually set) or from reps, plus a fixed handling overhead per row, plus one rest **per round rather than per row**: in a superset the partner's rest runs while you work, so only the debt the following work does not already repay is charged, and the pause after the last set of the session is not part of the training. It then rescales that with the measured pace of *this* session — the median ratio of the deltas between consecutive `completedAt` timestamps to what those rows should have cost. No history query: the same template is trained differently on a full Saturday than on an empty Tuesday, and that is already in this session's pace. Three rules are load-bearing: the span from `startedAt` to the first completion is deliberately **not** a sample (it is the walk to the rack), a delta above `MAX_SAMPLE_SECONDS` is an interruption and not a pace, and the measurement only reaches full weight after `FULL_CONFIDENCE_SAMPLES` samples. Between two sets the number ticks down by at most the *next* row's own budget, so idling can never drive it to zero. Skipped exercises drop out entirely, which is why `NOCH` can read "fertig" while `SÄTZE` still counts a skipped exercise's rows — `summarizeSessionProgress` sees only logs, and `toggleSkipSessionExercise` leaves those alone.
- **The strip owns its own unconditional 1 s ticker**, like `ActiveSessionBar` and unlike the page. `SessionPage`'s ticker stays conditional on a running rest or set timer, because its `now` is a prop of every block card and the stage — ticking it always would redraw the whole list once a second, including while a number field has focus. Before the split, `DAUER` simply stood still whenever no timer ran.

#### Inside the sheet: one set is big

[SessionExerciseStage.tsx](src/components/SessionExerciseStage.tsx) is the exercise with the focus — image thumbnail, name, the current set as value boxes with `−`/`+` around a real `<input>`, then the remaining sets as narrow rows. There is deliberately **no footer line** with volume or last week's numbers: an open set row already shows what you did last time (`setRowFallback`), and a second, truncated listing of the same figures answers nothing. Every other member of the block collapses to a `SessionPartnerRow`: name, set count, rest chips, "Wechseln". Before this, every set stood as a full editor underneath the next — ten fields for a five-set squat, all equally loud, and the number you were actually working on had to be searched for.

Three things about it are load-bearing:

- **`ActiveSetEditor` keeps the old machinery verbatim** — the field-wise draft reconciliation against the live query, the 600 ms autosave, skipping invalid fields instead of writing `undefined`, `adoptPlaceholders` on completion. Only the frame is new. Do not "simplify" it; each of those lines is a bug that already cost data.
- **The big button lives in the sheet's footer, its label in the editor.** The footer is anchored to the visual viewport and must stay there; the label ("62,5 kg × 5 abhaken") has to reflect the *draft*, not the stored row, or the button promises something it doesn't write. The editor therefore reports `{label, disabled, run}` upward through `onActionChange`, with `run` behind a ref so the effect only depends on primitives — an object rebuilt per keystroke would loop.
- **Which set is big is derived, not stored**: the manual pick (`selectedSetLogId`) beats the running set timer beats the first open row. A pick from another exercise simply doesn't match, so switching focus needs no reset.

The derivations are pure and tested in [session-summary.ts](src/domain/session-summary.ts): block status (`upcoming` / `current` / `done`), **set rows** rather than sets (a unilateral exercise produces two per set number, and both sides are work), `buildSetRounds` (one round = one set number, feeding the header strip, the side cards and the row list), `describeSetPosition` in the block card (`Satz 2 von 4` — rows again, so it agrees with the page header and the block counter), and `describeSetRowValues` against a `setRowFallback` in which last week's values beat the exercise target, because those are what completion actually writes. The block card carries its status as `data-block-status`, each set row its id as `data-set-row`, and the header strip `data-session-stats` plus `data-session-estimate` (holding the forecast's quality); that is what the e2e tests read instead of guessing at class names — including the one that checks the three columns do not overflow at 320px. The forecast itself lives apart in [session-estimate.ts](src/domain/session-estimate.ts): everything here restates what is stored, that module predicts.

### Timers

Two kinds, both on the running `WorkoutSession` so they survive a reload: `restTimers` (pauses between sets) and `setTimer` (a set *on* time, e.g. a 2-minute plank). At most one `setTimer` per session — starting another replaces it. Its duration comes from `resolveSetTimerSeconds` ([set-timer.ts](src/domain/set-timer.ts)): the seconds entered in the set beat the exercise's `targetSeconds`, which beats the default. `finishSetTimer` writes the achieved time into the set log and clears the timer — full duration when it runs out, `elapsedSetTimerSeconds` when stopped early; `clearSetTimer` drops it without writing. Anything that invalidates the target (deleting the set log, closing the session) must clear it too, otherwise the bar keeps counting toward a row that no longer exists.

**The rest timer is multi-track**, and that is the whole point. A `RestTimerTrack` belongs to a pair of (`sessionExerciseId`, `side`), never to the session as a whole — the old scalar `restTimerEndsAt` had no owner, so every completed set overwrote it. Two cases need this and are the *same* case: in a superset the pause of the first exercise keeps running while the second is executed, and on a unilateral exercise the right side rests while the left is trained. Switching back must show the right countdown. `restTrackKey` is the identity; `upsertRestTrack` replaces same-key tracks instead of stacking them. Pure helpers live in [rest-timer.ts](src/domain/rest-timer.ts), built like `set-timer.ts` (`now` as a parameter, no clock inside).

Three display levels, all fed from the same tracks: a badge on the **next open set row** of that side (`buildRestBadges`), chips on non-focused exercise cards, and the bottom bar. The bar shows one track large — `selectPrimaryRestTrack`, which prefers the side of the focused exercise's next open set — and the rest as tappable chips. Exactly **one** `role="timer"` stays in the DOM; several live regions counting down at once make a screen reader unusable.

An expired track is not deleted. It stays as "bereit" — that is the answer people come back for — until `pruneRestTracks` drops it after `REST_TRACK_GRACE_SECONDS`. Vibration fires once per track, tracked in a `useRef` in `SessionPage` (ephemeral on purpose; a reload costs at most one buzz).

Both expiries also play a sound, from [sound.ts](src/lib/sound.ts) — a synthesized two-tone chime, no audio asset the service worker would have to cache. Three things about it are load-bearing. A browser starts an `AudioContext` suspended and only unlocks it inside a user gesture, which a timer expiry is not: `primeTimerSound` runs on `SessionPage` mount and hangs itself on the next touch (on iOS `resume()` alone is unreliable — a silent buffer has to actually start inside the gesture). `isChimeFresh` suppresses the chime when the expiry is more than `CHIME_MAX_DELAY_MS` old, because no clock ticks while the app is backgrounded and a chime for a pause that ended ten minutes ago is a fright, not a hint — which is why the expired-track key carries its `endsAt` into the effect. And the sound never replaces the vibration: WebKit plays nothing while the ringer switch is on silent. `AppSettings.timerSoundEnabled` switches it off (additive, `undefined` counts as on), edited via `ToggleField` in Settings — `CheckboxField` cannot be used there because the accessibility e2e measures the control itself and its 20px box fails the 44px rule.

### Media

Images only (JPG/PNG/GIF/WebP — `isSupportedMediaType`), stored as `Blob` in the `mediaAssets` table. Uploads go through [media-actions.ts](src/db/media-actions.ts), which deletes orphaned assets when the last referencing exercise drops them. Rendering uses `URL.createObjectURL` with revoke on cleanup ([ExerciseMedia.tsx](src/components/ExerciseMedia.tsx)). Export serializes blobs to data URLs and back.

The picture belongs to the exercise form, not to a second step afterwards: `createExercise(input, media?)` writes asset and exercise in **one** transaction, so a rejected image never leaves a half-created exercise behind. Everything that stores an image calls `prepareMediaAsset` **before** opening the transaction — it validates the type and runs `toStorableBlob`, which reads the `File` into memory. WebKit stores a file input's `File` only as a reference and aborts the transaction with "Error preparing Blob/File data to be stored in object store" otherwise; the read has to happen outside, because an `await` on anything but Dexie closes the transaction. Playwright's WebKit refuses blob writes to IndexedDB entirely (verified against plain `indexedDB`, no app involved), so e2e can only cover the form up to the save — the database path is covered by `exercise-actions.test.ts`.

### Export / import

[src/lib/export.ts](src/lib/export.ts) is the backup format: a full versioned snapshot of every table. Import validates three things, all required by the contract: schema version, referential integrity across tables, and supported media types. `SNAPSHOT_SCHEMA_VERSION` is pinned with `z.literal(...)` — a schema change means bumping the version *and* the literal. `restoreDatabaseSnapshot` clears all tables before bulk-inserting (child tables first); the Settings page exports a backup automatically before restoring.

### Data loss on iOS — why the safeguards exist

A home-screen web app on iOS owns a storage container separate from Safari, and **deleting the icon deletes IndexedDB with it**. This already cost a user their training history, because the only way they found to update the app was to remove and re-add it. Three mechanisms follow from that, and none of them is decorative:

- `onRegisteredSW` in [main.tsx](src/main.tsx) calls `registration.update()` on start, on `visibilitychange`, and every 30 minutes. Without it the "Update verfügbar" banner never appears in an installed app — a service worker only looks for a new version when the page loads, and a standalone app sits in the app switcher for days.
- `requestPersistentStorage` ([src/lib/storage.ts](src/lib/storage.ts)) runs on every start; Settings shows the resulting state plus usage. It stops eviction under storage pressure, *not* deletion of the app.
- `AppSettings.lastBackupAt` drives the reminder on Home. `evaluateBackupStatus` ([src/domain/backup.ts](src/domain/backup.ts)) counts completed sessions newer than the last backup — elapsed days alone would nag people who simply didn't train. `exportDatabaseSnapshot` sets the timestamp itself, so every export path counts.

`exportDatabaseSnapshot({ preferShare: true })` routes through the Web Share API **only** in `display-mode: standalone`, where iOS hides the download folder; in a tab it downloads, and `navigator.share` would hang there without a share sheet. A cancelled share returns `'cancelled'` and must not mark a backup as done.

### Schema changes

`appDb.ts` declares `version(1)` and `version(2)`. Adding or changing indexes requires a new `this.version(n).stores({...})` block with an `upgrade()` where data needs reshaping — the DB is on real users' devices and cannot be reset. Also update the matching Zod schema in `export.ts`. Note that IndexedDB rejects booleans as keys, so boolean fields must not be indexed.

## UI layer

`src/components/ui/` holds the primitives — `Button`/`IconButton` (the latter requires a `label`), `TextField`/`TextArea`/`SelectField` (each renders a real `<label for>`), `ConfirmDialog`, and `Sheet`. Use them instead of hand-rolling class chains; the design tokens live in `tailwind.config.js` (`app`, `surface`, `line`, `content`, `accent`, `highlight`, `success`, `danger`, `warning`, plus the `card`/`panel`/`control` radius scale).

### The palette is light, and three colours carry meaning

The app is **Feldgrün**: paper ground (`#f2f2ef`), ink text, deep forest green, one lime. Three tokens are semantic and must never appear as decoration — `highlight` (lime) means *this is up next*, `success` (forest) means *done*, and also *rest is over, you can go*, `danger` means *skipped or deleted*.

`accent` is the **ink**, not the lime. That trips people up, so: lime on a light ground measures 1.3:1 as a text colour and is simply unreadable — it only works as a surface. `accent` therefore stayed what it always was (the emphasised interactive colour: primary button, focus ring, active tab) and only changed hue. Reach for `highlight` when you mean "now", never `text-highlight`.

#### The three colours apply everywhere, not only in the session

"Never as decoration" was once read as "only in the running session", and it left every other screen a stack of identical white cards — `accent.DEFAULT === content.DEFAULT`, so the `bg-accent-soft text-accent` badges out there rendered as ink on paper and said nothing. **Both states exist on every screen; they were simply not painted.** The next workout on Home *is* up next. Every history entry *is* done — the "Fertig" badge in [HistorySessionPage.tsx](src/pages/HistorySessionPage.tsx) was grey for exactly the state the session paints forest green. Four rules follow:

1. **One lime field per screen.** Exactly one thing is up next; two lime surfaces cancel each other out.
2. **Forest green may repeat** — "done" is the state of many things at once.
3. **Don't invent a "now".** History and Übungen deliberately carry *no* lime: in a log and in a library nothing is up next. They don't look bland anyway, because forest green and the exercise images carry them.
4. **Lime is surface, ink is action** — as in the focus sheet, where the current exercise is lime and the check-off button is ink.

The shared pieces live in [ui/StatusCard.tsx](src/components/ui/StatusCard.tsx): `NowCard` (lime; with `onClick` the card *is* the button — then its action slot must be decoration, because a button inside a button is invalid), `DoneCard` and `DoneRow` (forest). Secondary text on a filled surface goes through `opacity-75`, as in `SessionBlockCard` — no separate "muted-on-fill" token. A filled surface must never stand for a state that isn't there: with zero sessions this week, the card is a plain `Empty`, not a green one claiming nothing.

Two pure helpers feed those screens, both deliberately named at length. [next-workout.ts](src/domain/next-workout.ts) picks "up next" by heuristic — never trained first, then the oldest completion, ties by name — because `WorkoutTemplate` has no `programId` and a `ProgramWeek` knows no templates; a programme is a progression overlay, not a running order. That is why the card is labelled "Am längsten her" rather than pretending to know a plan. And [calendar-week.ts](src/domain/calendar-week.ts) is the week on the *calendar* (Monday, local time), which has nothing to do with `Program.activeWeek` / `resolvedProgramWeek` — those are a hand-set programme week that is never derived from a date. `loadTemplateRecency`, `loadWeekSummary` and `loadExercisesTrainedSince` in [history-queries.ts](src/db/history-queries.ts) all run over the `completedAt` index and all filter on `status === 'completed'`: `closeSession` stamps `completedAt` on an *aborted* session too, and aborted is not trained. Training volume is `sumWorkVolume` in [volume.ts](src/domain/volume.ts) — load times reps (or seconds), summed, and it filters nothing itself: which sets count is the caller's decision, and the caller already holds the right index. A band contributes zero there because it has no `weight`, which is why the tiles say "Volumen" in kg rather than "Arbeit".

Two rules that are not negotiable, because both were broken across the whole app before: text must reach 4.5:1 contrast (`content-muted` is the *darkest* muted tone the design allows and sits at 5.1:1 on the lightest card), and every interactive element needs a visible focus ring — `index.css` provides a `:where()` baseline, so don't add `outline-none` without a replacement. Touch targets are 44px (`min-h-touch`).

Headings and numbers use `font-display` (Archivo Variable, SIL OFL, self-hosted). Only the weight axis and the latin subset are bundled — 35 kB instead of 90 — and `woff2` is already in the service worker's precache glob, so it is offline after the first start. Body text deliberately stays on the system font.

Changing the ground colour means changing four things outside `tailwind.config.js`: the body colour and `color-scheme` in `index.css`, the focus ring in the same file, the arrow inside `.select-control`'s data-URI SVG, and `theme-color` plus `apple-mobile-web-app-status-bar-style` in `index.html` (`default`, not `black-translucent` — otherwise iOS keeps drawing white status-bar text over a light page).

## Conventions

- UI strings are **German with real umlauts** (`Übung`, `ungültig`, `Unterkörper`, `schließen`) — in strings *and* in comments. The source used to transliterate them ASCII-style; it no longer does anywhere, so don't reintroduce that style. Error messages thrown from `db/` actions are user-facing German.
- Numbers are German too: **every rendered number goes through `formatNumber`** ([format.ts](src/lib/format.ts), `Intl.NumberFormat('de-DE')`) — a bar weighs 82,5 kg, not 82.5. A raw `${weight} kg` in JSX is the bug this replaced; it was in eight places at once. The counterpart on the input side is `toInputValue`, which writes the comma into the field, and `parseNumberInput` / `optionalNumberInput`, which read both spellings back. Form-local `Number(value)` parsers silently rejected every comma a German keyboard produces — don't write another one.
- Imports use the `@/` alias for `src/` (configured in `tsconfig.json`, `vite-tsconfig-paths`, and separately in `vitest.config.ts`).
- IDs: `createId()` from [src/lib/id.ts](src/lib/id.ts) (`crypto.randomUUID`). Timestamps are ISO strings.
- Routing is `HashRouter` — required for GitHub Pages deep links. Don't switch to `BrowserRouter`.
- Styling is Tailwind, light-first (single theme, no `dark:` variants anywhere), with `cn()` (clsx + tailwind-merge) for conditional classes. UI targets one-handed phone use: large touch targets, bottom-reachable primary actions, minimal typing during a workout.
- Reordering runs on up/down arrow buttons (`moveItem` in [src/lib/reorder.ts](src/lib/reorder.ts)), not drag-and-drop — the old `@dnd-kit` gesture fired after 8px and reordered by accident while scrolling. Both `reorderTemplateExercises` and `reorderSessionExercises` reject incomplete id lists and rewrite `orderIndex` as a dense 1-based sequence.

## Tests

`src/test/setup.ts` wipes and reopens the fake IndexedDB before every test, so `db/*.test.ts` files can call actions against a clean database with no manual teardown. Test coverage is deliberately concentrated on domain rules, db actions, and import/export validation — not components.

For anything jsdom cannot express — safe-area insets, the sticky rest timer, contrast, focus rings, native control sizing — `e2e/` runs Playwright against **WebKit** on two iPhone widths. Since the sets moved into the focus sheet, any test that touches a set field has to open it first, and since only one set is big at a time, it has to work through the four helpers in [e2e/helpers.ts](e2e/helpers.ts): `openExerciseSheet(page, name?)`, `closeExerciseSheet(page)`, `completeActiveSet(page)` (the footer button, matched by `/abhaken$/` inside the dialog), `selectSetRow(page, 'Satz 1 · links')` for anything that is not the next open row, and `startRestByCompletingSet(page, name?)` — since the manual rest button is gone, that is the only way to get a running rest timer. A reload closes the sheet — that is the contract, and several tests assert exactly that. WebKit is deliberate: the app targets iOS Safari, and Chromium hides real problems. Two examples that only surfaced there: `<select>` ignores `min-height` under native `appearance` and collapsed to 22px, and a debounced autosave bug survived every unit test.

`vitest.config.ts` excludes `e2e/`, so `npm test` and `npm run test:e2e` stay separate. `playwright.config.ts` sets `reuseExistingServer` outside CI: if a dev server from an earlier session is still on 5173, Playwright silently tests *that* one — and a stale server keeps serving the old Tailwind build, because a change to `tailwind.config.js` needs a restart. Restart the dev server before trusting an e2e run. When writing e2e tests, note that `seedSampleData` brings its own asymmetry test at 8.3% — pick different numbers or you will assert against the wrong row.

## First run

`bootstrapAppData` only creates the settings row. The sample program (including a completed session) is opt-in via Settings → Beispieldaten, so a real user never starts with a fabricated training history. Settings also offers a full local reset.

## Notes

`README.md` is still the stock Vite template and describes nothing about this project.
