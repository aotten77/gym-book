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
- [src/store/ui-store.ts](src/store/ui-store.ts) — Zustand, **ephemeral UI state only**: focused exercise, online/offline, SW update available, install prompt. Never domain records, and nothing that must survive a reload — the rest timers and the set timer (`restTimers` / `setTimer`) live on `WorkoutSession` in IndexedDB for exactly that reason.

### The plan/execution split (the core invariant)

`WorkoutTemplate` + `WorkoutTemplateExercise` describe the *plan*. Starting a workout **materializes** an independent execution copy — `WorkoutSession` + `WorkoutSessionExercise` + `WorkoutSetLog` — via `materializeSession`. Editing a running session (adding, skipping, reordering exercises, changing targets) must never mutate the template. Session rows carry `*Snapshot` fields (`templateNameSnapshot`, `exerciseNameSnapshot`, `programNameSnapshot`, `resolvedProgramWeek`) so history stays historically correct when templates, programs, or the active week later change.

### Supersets

Two or more consecutive exercises can be linked into a superset. The model is one optional field — `supersetGroupId` on `WorkoutTemplateExercise` (the plan) and on `WorkoutSessionExercise` (the snapshot copy) — with one invariant: **members of a group are always contiguous in `orderIndex`**. `areGroupsContiguous` guards both reorder actions; the UI never lets you break it either, because the block header's arrows move the whole group and a member's own arrows only sort *within* it.

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

### Timers

Two kinds, both on the running `WorkoutSession` so they survive a reload: `restTimers` (pauses between sets) and `setTimer` (a set *on* time, e.g. a 2-minute plank). At most one `setTimer` per session — starting another replaces it. Its duration comes from `resolveSetTimerSeconds` ([set-timer.ts](src/domain/set-timer.ts)): the seconds entered in the set beat the exercise's `targetSeconds`, which beats the default. `finishSetTimer` writes the achieved time into the set log and clears the timer — full duration when it runs out, `elapsedSetTimerSeconds` when stopped early; `clearSetTimer` drops it without writing. Anything that invalidates the target (deleting the set log, closing the session) must clear it too, otherwise the bar keeps counting toward a row that no longer exists.

**The rest timer is multi-track**, and that is the whole point. A `RestTimerTrack` belongs to a pair of (`sessionExerciseId`, `side`), never to the session as a whole — the old scalar `restTimerEndsAt` had no owner, so every completed set overwrote it. Two cases need this and are the *same* case: in a superset the pause of the first exercise keeps running while the second is executed, and on a unilateral exercise the right side rests while the left is trained. Switching back must show the right countdown. `restTrackKey` is the identity; `upsertRestTrack` replaces same-key tracks instead of stacking them. Pure helpers live in [rest-timer.ts](src/domain/rest-timer.ts), built like `set-timer.ts` (`now` as a parameter, no clock inside).

Three display levels, all fed from the same tracks: a badge on the **next open set row** of that side (`buildRestBadges`), chips on non-focused exercise cards, and the bottom bar. The bar shows one track large — `selectPrimaryRestTrack`, which prefers the side of the focused exercise's next open set — and the rest as tappable chips. Exactly **one** `role="timer"` stays in the DOM; several live regions counting down at once make a screen reader unusable.

An expired track is not deleted. It stays as "bereit" — that is the answer people come back for — until `pruneRestTracks` drops it after `REST_TRACK_GRACE_SECONDS`. Vibration fires once per track, tracked in a `useRef` in `SessionPage` (ephemeral on purpose; a reload costs at most one buzz).

### Media

Images only (JPG/PNG/GIF/WebP — `isSupportedMediaType`), stored as `Blob` in the `mediaAssets` table. Uploads go through [media-actions.ts](src/db/media-actions.ts), which deletes orphaned assets when the last referencing exercise drops them. Rendering uses `URL.createObjectURL` with revoke on cleanup ([ExerciseMedia.tsx](src/components/ExerciseMedia.tsx)). Export serializes blobs to data URLs and back.

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

`src/components/ui/` holds the primitives — `Button`/`IconButton` (the latter requires a `label`), `TextField`/`TextArea`/`SelectField` (each renders a real `<label for>`), and `ConfirmDialog`. Use them instead of hand-rolling class chains; the design tokens live in `tailwind.config.js` (`surface`, `line`, `content`, `accent`, `danger`, plus the `card`/`panel`/`control` radius scale).

Two rules that are not negotiable, because both were broken across the whole app before: text must reach 4.5:1 contrast (`content-muted` is the lightest muted tone that does), and every interactive element needs a visible focus ring — `index.css` provides a `:where()` baseline, so don't add `outline-none` without a replacement. Touch targets are 44px (`min-h-touch`).

## Conventions

- UI strings are **German with real umlauts** (`Übung`, `ungültig`, `Unterkörper`, `schließen`) — in strings *and* in comments. The source used to transliterate them ASCII-style; it no longer does anywhere, so don't reintroduce that style. Error messages thrown from `db/` actions are user-facing German.
- Imports use the `@/` alias for `src/` (configured in `tsconfig.json`, `vite-tsconfig-paths`, and separately in `vitest.config.ts`).
- IDs: `createId()` from [src/lib/id.ts](src/lib/id.ts) (`crypto.randomUUID`). Timestamps are ISO strings.
- Routing is `HashRouter` — required for GitHub Pages deep links. Don't switch to `BrowserRouter`.
- Styling is Tailwind, dark-first, with `cn()` (clsx + tailwind-merge) for conditional classes. UI targets one-handed phone use: large touch targets, bottom-reachable primary actions, minimal typing during a workout.
- Reordering runs on up/down arrow buttons (`moveItem` in [src/lib/reorder.ts](src/lib/reorder.ts)), not drag-and-drop — the old `@dnd-kit` gesture fired after 8px and reordered by accident while scrolling. Both `reorderTemplateExercises` and `reorderSessionExercises` reject incomplete id lists and rewrite `orderIndex` as a dense 1-based sequence.

## Tests

`src/test/setup.ts` wipes and reopens the fake IndexedDB before every test, so `db/*.test.ts` files can call actions against a clean database with no manual teardown. Test coverage is deliberately concentrated on domain rules, db actions, and import/export validation — not components.

For anything jsdom cannot express — safe-area insets, the sticky rest timer, contrast, focus rings, native control sizing — `e2e/` runs Playwright against **WebKit** on two iPhone widths. WebKit is deliberate: the app targets iOS Safari, and Chromium hides real problems. Two examples that only surfaced there: `<select>` ignores `min-height` under native `appearance` and collapsed to 22px, and a debounced autosave bug survived every unit test.

`vitest.config.ts` excludes `e2e/`, so `npm test` and `npm run test:e2e` stay separate. When writing e2e tests, note that `seedSampleData` brings its own asymmetry test at 8.3% — pick different numbers or you will assert against the wrong row.

## First run

`bootstrapAppData` only creates the settings row. The sample program (including a completed session) is opt-in via Settings → Beispieldaten, so a real user never starts with a fabricated training history. Settings also offers a full local reset.

## Notes

`README.md` is still the stock Vite template and describes nothing about this project.
