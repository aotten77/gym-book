# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server — app is served under the base path: http://localhost:5173/gym-book/
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

Offline-first PWA training log ("Gym Book"), deployed as a static site to GitHub Pages under `/gym-book/`. Single-user, no backend, no sync. All domain data lives in IndexedDB via Dexie. [.claude/skills/gym-book-architect/SKILL.md](.claude/skills/gym-book-architect/SKILL.md) is the binding scope/architecture contract and loads automatically (a mirror lives in `.trae/` for the Trae editor — change both together); read it before designing features; it lists what v1 must include and must exclude (no backend, no cloud sync, no multi-user, no video upload, no deload automation).

## Architecture

Layering is strict and worth preserving:

- [src/domain/](src/domain/) — pure types + pure business rules. No Dexie, no React. [session.ts](src/domain/session.ts) holds `materializeSession` and `calculateAsymmetryPercent`.
- [src/db/](src/db/) — the only place that touches Dexie. [appDb.ts](src/db/appDb.ts) declares the schema; `*-actions.ts` files are the write API (session, template, program, exercise, test, media, settings) and `history-queries.ts` holds the read-side aggregations. UI never writes to `db` directly.
- [src/pages/](src/pages/) — routed screens. They read via `useLiveQuery` from `dexie-react-hooks` (reactive, re-renders on IndexedDB writes) and mutate by calling `*-actions` functions.
- [src/store/ui-store.ts](src/store/ui-store.ts) — Zustand, **ephemeral UI state only**: focused exercise, online/offline, SW update available, install prompt. Never domain records, and nothing that must survive a reload — the rest-timer deadline lives on `WorkoutSession` in IndexedDB for exactly that reason.

### The plan/execution split (the core invariant)

`WorkoutTemplate` + `WorkoutTemplateExercise` describe the *plan*. Starting a workout **materializes** an independent execution copy — `WorkoutSession` + `WorkoutSessionExercise` + `WorkoutSetLog` — via `materializeSession`. Editing a running session (adding, skipping, reordering exercises, changing targets) must never mutate the template. Session rows carry `*Snapshot` fields (`templateNameSnapshot`, `exerciseNameSnapshot`, `programNameSnapshot`, `resolvedProgramWeek`) so history stays historically correct when templates, programs, or the active week later change.

Set materialization rules, enforced in `materializeSession` and mirrored in `addSessionExercise`: exactly **one warmup set** per exercise (`setKind: 'warmup'`, `setNumber: 0`, `side: 'both'`), then `workSetCount` work sets; unilateral exercises get mirrored `left`/`right` rows at every set number.

### Progression

Calendar-week based, never session-count based. `startSessionFromTemplate` resolves the week as `settings.weekOverride ?? program.activeWeek ?? 1`, looks up the matching `ProgramWeek`, and folds its `ProgressionRule` targets over the template targets (`progressionRule.targetX ?? templateExercise.targetX`) into the session snapshot. The resolved week is then frozen on the session.

`startSessionFromTemplate` checks for an existing `active` session **inside** the insert transaction and returns that id instead of starting a second one — the check must stay in the transaction or two fast taps create two active sessions. `abortSession` and `completeSession` both go through `closeSession`, which only acts on active sessions.

Completed sessions are immutable — `toggleSetCompletion` / `updateSetLogValues` bail out via `isSetLogEditable`, and `reorderSessionExercises` no-ops on non-active sessions. Keep new mutations behind the same guard.

`updateSetLogValues` only writes keys that are present in its input. This matters: Dexie's `Table.update` deletes any property whose value is `undefined`, so passing a failed parse straight through would silently destroy stored values. Parse user input with `parseNumberInput` from [number-input.ts](src/lib/number-input.ts), which distinguishes empty from invalid.

### Media

Images only (JPG/PNG/GIF/WebP — `isSupportedMediaType`), stored as `Blob` in the `mediaAssets` table. Uploads go through [media-actions.ts](src/db/media-actions.ts), which deletes orphaned assets when the last referencing exercise drops them. Rendering uses `URL.createObjectURL` with revoke on cleanup ([ExerciseMedia.tsx](src/components/ExerciseMedia.tsx)). Export serializes blobs to data URLs and back.

### Export / import

[src/lib/export.ts](src/lib/export.ts) is the backup format: a full versioned snapshot of every table. Import validates three things, all required by the contract: schema version, referential integrity across tables, and supported media types. `SNAPSHOT_SCHEMA_VERSION` is pinned with `z.literal(...)` — a schema change means bumping the version *and* the literal. `restoreDatabaseSnapshot` clears all tables before bulk-inserting (child tables first); the Settings page exports a backup automatically before restoring.

### Schema changes

`appDb.ts` declares `version(1)` and `version(2)`. Adding or changing indexes requires a new `this.version(n).stores({...})` block with an `upgrade()` where data needs reshaping — the DB is on real users' devices and cannot be reset. Also update the matching Zod schema in `export.ts`. Note that IndexedDB rejects booleans as keys, so boolean fields must not be indexed.

## UI layer

`src/components/ui/` holds the primitives — `Button`/`IconButton` (the latter requires a `label`), `TextField`/`TextArea`/`SelectField` (each renders a real `<label for>`), and `ConfirmDialog`. Use them instead of hand-rolling class chains; the design tokens live in `tailwind.config.js` (`surface`, `line`, `content`, `accent`, `danger`, plus the `card`/`panel`/`control` radius scale).

Two rules that are not negotiable, because both were broken across the whole app before: text must reach 4.5:1 contrast (`content-muted` is the lightest muted tone that does), and every interactive element needs a visible focus ring — `index.css` provides a `:where()` baseline, so don't add `outline-none` without a replacement. Touch targets are 44px (`min-h-touch`).

## Conventions

- UI strings are **German**, and umlauts are consistently transliterated in source (`Uebung`, `ungueltig`, `Unterkoerper`) — keep new strings ASCII-only in the same style. Error messages thrown from `db/` actions are user-facing German.
- Imports use the `@/` alias for `src/` (configured in `tsconfig.json`, `vite-tsconfig-paths`, and separately in `vitest.config.ts`).
- IDs: `createId()` from [src/lib/id.ts](src/lib/id.ts) (`crypto.randomUUID`). Timestamps are ISO strings.
- Routing is `HashRouter` — required for GitHub Pages deep links. Don't switch to `BrowserRouter`.
- Styling is Tailwind, dark-first, with `cn()` (clsx + tailwind-merge) for conditional classes. UI targets one-handed phone use: large touch targets, bottom-reachable primary actions, minimal typing during a workout.
- Drag-and-drop reordering uses `@dnd-kit`; both `reorderTemplateExercises` and `reorderSessionExercises` reject incomplete id lists and rewrite `orderIndex` as a dense 1-based sequence.

## Tests

`src/test/setup.ts` wipes and reopens the fake IndexedDB before every test, so `db/*.test.ts` files can call actions against a clean database with no manual teardown. Test coverage is deliberately concentrated on domain rules, db actions, and import/export validation — not components.

For anything jsdom cannot express — safe-area insets, the sticky rest timer, contrast, focus rings, native control sizing — `e2e/` runs Playwright against **WebKit** on two iPhone widths. WebKit is deliberate: the app targets iOS Safari, and Chromium hides real problems. Two examples that only surfaced there: `<select>` ignores `min-height` under native `appearance` and collapsed to 22px, and a debounced autosave bug survived every unit test.

`vitest.config.ts` excludes `e2e/`, so `npm test` and `npm run test:e2e` stay separate. When writing e2e tests, note that `seedSampleData` brings its own asymmetry test at 8.3% — pick different numbers or you will assert against the wrong row.

## First run

`bootstrapAppData` only creates the settings row. The sample program (including a completed session) is opt-in via Settings → Beispieldaten, so a real user never starts with a fabricated training history. Settings also offers a full local reset.

## Notes

`README.md` is still the stock Vite template and describes nothing about this project.
