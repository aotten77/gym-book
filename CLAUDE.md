# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Top rule: no personal data in files

This repository is **public**. Above every other rule here: nothing personal about the user ever goes into a file — not into code, tests, fixtures, docs, specs, plans, commit messages or PR texts. Personal means anything that says something about the user: health and physical complaints (body part with side, reasons, appointments with practitioners), their real training plan, real workout and exercise names from it, heart rates, real dates of their life.

- Examples are **recognisably invented**: „Beispiel A“, „Erfundener Beispielgrund“, „Beispiel-Mobility“. Taken together they must not tell a coherent story about the user — a disclaimer like "all examples are invented" does not make a realistic one safe.
- Material the user hands over (e.g. the import format from the claude.ai project) is neutralised **before** it is written, and they are shown what was changed.
- Enforced by [scripts/privacy-guard.mjs](scripts/privacy-guard.mjs) in the `pre-commit` and `pre-push` hooks (`.githooks/`, activated by `npm install` via `prepare`, or `git config core.hooksPath .githooks`). It checks added lines against generic patterns and against the user's private term list outside the repo (`~/.config/privat-begriffe.txt`). A hit blocks the commit or push; reword, never bypass (`--no-verify` is not an option). `npm run privacy` checks the working tree.

## Commands

```bash
npm run dev       # Vite dev server — http://localhost:5173/
npm run check     # tsc -b --noEmit (typecheck only)
npm test          # vitest run (jsdom + fake-indexeddb)
npm run test:e2e  # playwright, WebKit on two iPhone sizes (starts the dev server itself)
npm run lint      # eslint .
npm run check:strict  # strictNullChecks, nur für die schon umgestellten Schichten
npm run build     # tsc -b && vite build
```

Single test file / single case:

```bash
npx vitest run src/domain/session.test.ts
npx vitest run src/db/actions.test.ts -t "materializes progression rules"
npx vitest            # watch mode
```

CI ([.github/workflows/pages.yml](.github/workflows/pages.yml)) runs `lint` → `check` → `check:strict` → `test` → `build` on push to `main`, then deploys `dist/` to GitHub Pages. `tsconfig.json` has `strict: false` — the cheap halves of `strict` are on individually, but **`strictNullChecks` is not**, so `npm run check` will not catch nullability bugs. `npm run check:strict` runs it against [tsconfig.strict.json](tsconfig.strict.json), whose `include` currently covers `src/domain`, `src/lib`, `src/db` and `src/test`; that list grows a layer at a time until the flag can move into `tsconfig.json` and the extra file disappears.

## What this app is

Offline-first PWA training log ("Gym Book"), deployed as a static site to GitHub Pages, served from the custom domain `gym.andreasotten.de` at the root path (`public/CNAME` pins it; without that file every Actions deploy resets the Pages custom-domain setting). The domain sits behind Cloudflare Access, so the app is not publicly reachable — that is deliberate: it keeps a private, non-commercial app out of the Impressum (§ 5 DDG) and privacy-notice obligations that attach to a publicly available site. Single-user, no backend, no sync. All domain data lives in IndexedDB via Dexie. [.claude/skills/gym-book-architect/SKILL.md](.claude/skills/gym-book-architect/SKILL.md) is the binding scope/architecture contract and loads automatically (a mirror lives in `.trae/` for the Trae editor — change both together); read it before designing features; it lists what v1 must include and must exclude (no backend, no cloud sync, no multi-user, no video upload, no deload automation).

## Architecture

Layering is strict and worth preserving:

- [src/domain/](src/domain/) — pure types + pure business rules. No Dexie, no React. [session.ts](src/domain/session.ts) holds `materializeSession` and `calculateAsymmetryPercent`.
- [src/db/](src/db/) — the only place that touches Dexie. [appDb.ts](src/db/appDb.ts) declares the schema; `*-actions.ts` files are the write API (session, template, program, exercise, test, media, settings) and `history-queries.ts` holds the read-side aggregations. UI never writes to `db` directly.
- [src/pages/](src/pages/) — routed screens. They read via `useLiveQuery` from `dexie-react-hooks` (reactive, re-renders on IndexedDB writes) and mutate by calling `*-actions` functions.
- [src/store/ui-store.ts](src/store/ui-store.ts) — Zustand, **ephemeral UI state only**: focused exercise, the open focus sheet (`openSessionBlockKey`), the open Now sheet (`isNowSheetOpen`, reset by `NowSheet` on every path change because each page mounts its own `AppShell`), online/offline, SW update available, install prompt. Never domain records, and nothing that must survive a reload — the rest timers and the set timer (`restTimers` / `setTimer`) live on `WorkoutSession` in IndexedDB for exactly that reason. Whether a sheet was open is not training information; after a reload you land in the list and the clocks keep running.

### The plan/execution split (the core invariant)

`WorkoutTemplate` + `WorkoutTemplateExercise` describe the *plan*. Starting a workout **materializes** an independent execution copy — `WorkoutSession` + `WorkoutSessionExercise` + `WorkoutSetLog` — via `materializeSession`. Editing a running session (adding, skipping, reordering exercises, changing targets) must never mutate the template. Session rows carry `*Snapshot` fields (`templateNameSnapshot`, `exerciseNameSnapshot`, `programNameSnapshot`, `resolvedProgramWeek`) so history stays historically correct when templates, programs, or the active week later change.

Further core rules (details in `docs/architecture/core-invariants.md`):

- `weekOverride` has exactly **one** writer; nothing else sets it (see `docs/architecture/plan-timeline.md`).
- **The one network path.** Google Cloud Text-to-Speech, called straight from the client ([tts-client.ts](src/lib/tts-client.ts), `POST …/v1/text:synthesize`, key in the `X-Goog-Api-Key` header, never `?key=`), **only to generate announcement MP3s** for guided sessions — never inside the training flow; without key, offline or on error the session runs with "Nur Ton". The user's own key, the TTS settings, the monthly character counter (`ttsConfig`) and the generated announcements (`announcements`) live in their own tables (DB v7) outside `appSettings` and are **not** in backup, restore or the analysis export (only "Alle Daten löschen" empties them). The key never appears in a message, in the UI (masked, last four characters) or in `console`; no key in the repo or in tests (placeholders only). Quota maths: [tts-quota.ts](src/domain/tts-quota.ts), actions: [tts-actions.ts](src/db/tts-actions.ts).
- Guided templates (`WorkoutTemplate.steps`) do not go through `startSessionFromTemplate` — it throws for them; they have their own start path (`startGuidedSession` / `completeGuidedSession` in [guided-session-actions.ts](src/db/guided-session-actions.ts)). A guided run is a normal `WorkoutSession` without exercise rows, carrying `guided` (step snapshot + event list); [guided-run.ts](src/domain/guided-run.ts) derives the whole run state from steps, events and `now`.
- **Guided screen exceptions** (`docs/architecture/guided-templates.md`): the running guided screen (`/guided/run/:sessionId`) is the **second dark surface** next to the rest mode (`GuidedStage tone="dark"`, `applyThemeColor`; the start screen stays light); the stage is **fixed landscape** whatever the phone's orientation (inverse of the portrait lock); it **keeps the screen awake regardless of `keepScreenAwakeEnabled`**. Test anchors: `data-guided-stage` (`start`, `run`, `finished`, …) with `data-guided-tone`, and on the run `data-guided-run` + `data-guided-phase` / `-section` / `-now` / `-remaining`, `data-guided-name`, `data-guided-next`, `data-guided-ring`, `data-guided-clock`, `data-guided-segment`, `data-guided-side`, `data-guided-done` ([guided-run.spec.ts](e2e/guided-run.spec.ts), [guided-controls.spec.ts](e2e/guided-controls.spec.ts)).

### Pitfalls

- **Dexie `update` with `undefined` deletes the field.** Only pass keys you mean to change.
- **Prepare blobs before the Dexie transaction** — an `await` on non-Dexie work inside a transaction commits it early.
- Playwright's WebKit refuses `Blob` writes to IndexedDB; announcements are stored as `ArrayBuffer` (`Announcement.audio`) for that reason and because Web Audio needs one anyway.
- **No `await` before a clipboard call** — iOS Safari drops the user gesture and rejects the write (`docs/architecture/import-export.md`).
- **One lime surface per screen** — the three signal colours carry meaning (`docs/architecture/ui-palette.md`).
- **Do not rebuild the strength session screen** — list outside, focus sheet inside, one big set (`docs/architecture/session-screen.md`).
- Rest timers and the set timer live on `WorkoutSession` in IndexedDB, not in Zustand (`docs/architecture/timers.md`).
- IndexedDB rejects booleans as keys — never index a boolean field.
- `HashRouter` stays; `BrowserRouter` breaks GitHub Pages deep links.
- A stale dev server on 5173 gets reused by Playwright — kill it before trusting an e2e run.

### Where the details live

Read the matching file before touching that area. Everything in `docs/architecture/` was moved verbatim out of this file.

| Topic | File |
|---|---|
| Plan/execution split, supersets, progression | `docs/architecture/core-invariants.md` |
| Plan timeline, week sheet, navigation, Now sheet, program weeks, week rules, dated plan entries | `docs/architecture/plan-timeline.md` |
| Load: kilos, bands, height in cm | `docs/architecture/load.md` |
| Session screen and focus sheet | `docs/architecture/session-screen.md` |
| Timers and rest mode | `docs/architecture/timers.md` |
| Media | `docs/architecture/media.md` |
| Backup export/import, analysis export, library import, one-off data fixes | `docs/architecture/import-export.md` |
| Data loss on iOS, why the safeguards exist | `docs/architecture/data-safety.md` |
| Runs, workout kind, weekly volume | `docs/architecture/weekly-volume.md` |
| Guided templates | `docs/architecture/guided-templates.md` |
| Restrictions (pause/adjust over a period, snapshot at start, lift) | `docs/architecture/restrictions.md` |
| Library-import format for the training assistant (claude.ai project); every `json` block is tested against the parser — **change it in the same step as the import code** | `docs/claude-projekt/import-format.md` |
| UI layer, palette, the three signal colours | `docs/architecture/ui-palette.md` |

### Schema changes

`appDb.ts` declares `version(1)` through `version(8)` (5 adds `runLogs`, 6 adds `planEntries` and the `planEntryId` index on sessions and runs — without an `upgrade()`, since existing rows simply have no link; 7 adds `announcements` and `ttsConfig`, again without one, and both stay out of `export.ts`; 8 adds `restrictions` (`'id'` only, no index on `liftedAt`), without an `upgrade()`, and it *is* in backup and restore — so are the restriction snapshot fields on session rows, guided runs, protocol entries and import logs, each added to its Zod schema in `export.ts` because a plain `z.object` silently drops unknown keys). Adding or changing indexes requires a new `this.version(n).stores({...})` block with an `upgrade()` where data needs reshaping — the DB is on real users' devices and cannot be reset. Also update the matching Zod schema in `export.ts`. `WorkoutTemplate.steps` (guided templates) needed **no** new version: it is neither indexed nor a reshaping, so Dexie just stores it with the object; it went into `export.ts` as an `.optional()` without a `SNAPSHOT_SCHEMA_VERSION` bump. Note that IndexedDB rejects booleans as keys, so boolean fields must not be indexed.

## Conventions

- UI strings are **German with real umlauts** (`Übung`, `ungültig`, `Unterkörper`, `schließen`) — in strings *and* in comments. The source used to transliterate them ASCII-style; it no longer does anywhere, so don't reintroduce that style. Error messages thrown from `db/` actions are user-facing German.
- Numbers are German too: **every rendered number goes through `formatNumber`** ([format.ts](src/lib/format.ts), `Intl.NumberFormat('de-DE')`) — a bar weighs 82,5 kg, not 82.5. A raw `${weight} kg` in JSX is the bug this replaced; it was in eight places at once. The counterpart on the input side is `toInputValue`, which writes the comma into the field, and `parseNumberInput` / `optionalNumberInput`, which read both spellings back. Form-local `Number(value)` parsers silently rejected every comma a German keyboard produces — don't write another one.
- Imports use the `@/` alias for `src/` (configured in `tsconfig.json`, `vite-tsconfig-paths`, and separately in `vitest.config.ts`).
- IDs: `createId()` from [src/lib/id.ts](src/lib/id.ts) (`crypto.randomUUID`). Timestamps are ISO strings.
- Routing is `HashRouter` — required for GitHub Pages deep links. Don't switch to `BrowserRouter`.
- Styling is Tailwind, light-first (single theme, no `dark:` variants anywhere — the two exceptions are the rest mode and the guided stage, see `docs/architecture/timers.md` and `docs/architecture/guided-templates.md`), with `cn()` (clsx + tailwind-merge) for conditional classes. UI targets one-handed phone use: large touch targets, bottom-reachable primary actions, minimal typing during a workout.
- Reordering runs on up/down arrow buttons (`moveItem` in [src/lib/reorder.ts](src/lib/reorder.ts)), not drag-and-drop — the old `@dnd-kit` gesture fired after 8px and reordered by accident while scrolling. Both `reorderTemplateExercises` and `reorderSessionExercises` reject incomplete id lists and rewrite `orderIndex` as a dense 1-based sequence.

## Tests

`src/test/setup.ts` wipes and reopens the fake IndexedDB before every test, so `db/*.test.ts` files can call actions against a clean database with no manual teardown. Test coverage is deliberately concentrated on domain rules, db actions, and import/export validation — not components.

For anything jsdom cannot express — safe-area insets, the sticky rest timer, contrast, focus rings, native control sizing — `e2e/` runs Playwright against **WebKit** on two iPhone widths. Since the sets moved into the focus sheet, any test that touches a set field has to open it first, and since only one set is big at a time, it has to work through the four helpers in [e2e/helpers.ts](e2e/helpers.ts): `openExerciseSheet(page, name?)`, `closeExerciseSheet(page)`, `completeActiveSet(page)` (the footer button, matched by `/abhaken$/` inside the dialog), `selectSetRow(page, 'Satz 1 · links')` for anything that is not the next open row, and `startRestByCompletingSet(page, name?)` — since the manual rest button is gone, that is the only way to get a running rest timer. A reload closes the sheet — that is the contract, and several tests assert exactly that. WebKit is deliberate: the app targets iOS Safari, and Chromium hides real problems. Two examples that only surfaced there: `<select>` ignores `min-height` under native `appearance` and collapsed to 22px, and a debounced autosave bug survived every unit test.

`vitest.config.ts` excludes `e2e/`, so `npm test` and `npm run test:e2e` stay separate. `playwright.config.ts` sets `reuseExistingServer` outside CI: if a dev server from an earlier session is still on 5173, Playwright silently tests *that* one — and a stale server keeps serving the old Tailwind build, because a change to `tailwind.config.js` needs a restart. Restart the dev server before trusting an e2e run. When writing e2e tests, note that `seedSampleData` brings its own asymmetry test at 8.3% — pick different numbers or you will assert against the wrong row.

## First run

`bootstrapAppData` only creates the settings row. The sample program (including a completed session) is opt-in via Settings → Beispieldaten, so a real user never starts with a fabricated training history. Settings also offers a full local reset.

## Notes

`README.md` is still the stock Vite template and describes nothing about this project.

## Agent skills

### Issue tracker

Local markdown under `.scratch/<feature>/` (spec.md + issues/NN-<slug>.md), gitignored. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix) as a `Status:` line. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the root, created lazily. See `docs/agents/domain.md`.
