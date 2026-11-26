---
name: "gym-book-pwa-architect"
description: "Guides architecture and implementation for the Gym Book PWA. Invoke when planning, implementing, or reviewing features for the offline-first GitHub Pages app."
---

# Gym Book PWA Architect

Use this skill to preserve the agreed architecture and scope for the Gym Book project.

Invoke this skill when:
- planning the project structure or feature boundaries
- defining or changing domain entities, persistence, or migrations
- implementing PWA, offline, storage, import/export, or media handling
- designing training session flows, progression logic, or history views
- reviewing whether a change still fits the v1 constraints

Do not use this skill for:
- generic framework tutorials
- unrelated repositories
- runtime debugging that requires instrumentation or logs

## Top rule: no personal data in files

This repository is **public**. Above every other rule here: nothing personal about the user ever goes into a file — not into code, tests, fixtures, docs, specs, plans, commit messages or PR texts. Personal means anything that says something about the user: health and physical complaints (body part with side, reasons, appointments with practitioners), their real training plan, real workout and exercise names from it, heart rates, real dates of their life.

- Examples are **recognisably invented**: „Beispiel A“, „Erfundener Beispielgrund“, „Beispiel-Mobility“. Taken together they must not tell a coherent story about the user — a disclaimer like "all examples are invented" does not make a realistic one safe.
- Material the user hands over (e.g. the import format from the claude.ai project) is neutralised **before** it is written, and they are shown what was changed.
- Enforced by [scripts/privacy-guard.mjs](scripts/privacy-guard.mjs) in the `pre-commit` and `pre-push` hooks (`.githooks/`, activated by `npm install` via `prepare`, or `git config core.hooksPath .githooks`). It checks added lines against generic patterns and against the user's private term list outside the repo (`~/.config/privat-begriffe.txt`). A hit blocks the commit or push; reword, never bypass (`--no-verify` is not an option). `npm run privacy` checks the working tree.

## Product Constraints

- Hosting is fixed to `GitHub Pages`.
- The app is a static, client-side PWA.
- The stack is `Vite + React + TypeScript`.
- Routing uses `HashRouter` for robust Pages compatibility.
- The app must work offline-first.
- v1 is single-user only.
- v1 does not include cloud sync or a backend.
- Local media upload is required.
- Media for v1 is limited to image formats plus animated `GIF/WebP`, not video.
- One optional, fail-safe network call exists: Google Cloud Text-to-Speech, called straight from the client with the user's own API key, **only to generate the spoken announcements** of guided sessions. It is not a backend. It never runs inside the training flow, and without a key, offline or on any error the session runs with "Nur Ton" (signal only). The key, the TTS settings, the character counter and the generated announcements stay out of backup, restore and the analysis export.

## Core Architecture

- Treat the application as a local-first client app, not a web app with deferred server features.
- Keep domain data in `IndexedDB` via `Dexie`.
- Do not use Redux or another UI store as the source of truth for domain records.
- Keep UI state separate from persisted workout data.
- Prefer clean domain modules and repository boundaries over framework-centric coupling.
- Every persisted entity should have stable IDs and timestamps that support future migrations and export/import.

## Required Domain Model

The model must preserve a strict separation between plan definition and workout execution.

### Core Entities

- `Exercise`
  - canonical exercise metadata
  - name, instructions, media reference, tracking mode, unilateral flag
- `WorkoutTemplate`
  - a planned session such as `A` or `B`
- `WorkoutTemplateExercise`
  - ordered exercise inclusion in a template
  - holds prescribed sets, reps, seconds, rest, tempo, notes, progression reference
- `Program`
  - training block metadata
- `ProgramWeek`
  - calendar-week-based progression stage
- `ProgressionRule`
  - resolves prescribed values for a template exercise from the active program week
- `WorkoutSession`
  - a concrete started workout
  - stores the resolved program week for historical correctness
- `WorkoutSessionExercise`
  - the execution-plan entry for one exercise in one session
  - supports overrides, reordering, skipping, and ad hoc insertion
- `WorkoutSetLog`
  - actual logged set data
- `ExerciseTest`
  - left/right test values and asymmetry percentage
- `MediaAsset`
  - locally uploaded image or animated image stored in IndexedDB
- `AppSettings`
  - active program metadata, preferences, and import/export settings

## Session Rules

- A running workout is not a direct live view of the template.
- Starting a session must materialize a session execution plan from the template.
- The session execution plan may diverge from the template without mutating the template itself.
- Users must be able to:
  - add exercises during a session
  - skip exercises
  - reorder exercises
- Ad hoc additions may optionally be applied back to the template through an explicit action.
- Persist enough session state to support app reload and recovery during a workout.

## Set Logging Rules

- Every exercise has at most one warmup round in v1; the template may switch it off via `includeWarmup: false`. A unilateral exercise mirrors that round into a left and a right row, exactly like a work set.
- Warmup sets must be modeled explicitly, not implied only in UI.
- Work sets are logged separately from the warmup set.
- Time-based exercises may include both `seconds` and `weight`.
- Unilateral exercises require left/right capture.
- In v1, left/right always share the same set count.
- Prefer a flat set-log model that keeps queries and history simple.

Recommended set log shape:
- `setKind`: `warmup | work`
- `side`: `both | left | right`
- `weight`
- `reps`
- `seconds`
- `completed`
- timestamps as needed

## Progression Rules

- Progression is calendar-week-based, not driven by completed session count.
- Resolve the active program week when the session starts: `weekOverride ?? derived from `Program.startedOn` ?? `activeWeek` ?? 1`.
- With a start date the program week runs with the calendar on its own; it stops at the last planned week instead of cycling.
- Persist that resolved week on the session so historical sessions do not change when the current week changes.
- Do not build deload or reset automation in v1.
- A manual override of the active week stays possible, but it is an option, not the default.
- The app may observe that a set is ready to progress — per set row and per side, against the exact set number of the last completed execution (`hasProgressionHint`). It must not prescribe the step: no number, no step size, no automatic write. Which jump is possible at the bar is the user's knowledge, and inventing it would be the adaptive progression v1 excludes. An exercise may switch the observation off entirely (`Exercise.suggestProgression`).

## History and "Last Values"

- "Last values" means the last completed execution of the same `Exercise`.
- Do not scope this to the same template slot in v1.
- If helpful in UI, show the source context such as the template name where the last values came from.
- Keep test history separate from workout history.
- An execution under a restriction (adjusted, done anyway despite a pause, or excluded in history) does not count as last values nor for the progression hint; a replacement counts normally.
- The one exception to "a completed session is history": the history switch "Zählt nicht als Leistungsstand" sets or removes `excludedFromProgressAt` on one exercise of a completed session. No value, set or target changes — only the marker.

## Persistence and Import/Export

- Persist domain data in `IndexedDB` with `Dexie`.
- Build schema versioning and migrations in from the start.
- Prefer explicit tables for the main entities instead of opaque blobs.
- Use import/export for backup in v1.
- Export format should be versioned and validated.
- Validate imported data for:
  - schema version
  - referential integrity
  - supported media types
- Do not design conflict resolution for multi-device sync in v1.

## PWA and GitHub Pages Rules

- Configure Vite with `base: '/'` — the app is served from the custom domain `gym.andreasotten.de` (pinned by `public/CNAME`), not from the `/gym-book/` project path.
- Use `HashRouter` to avoid deep-link issues on GitHub Pages.
- Configure manifest and service worker paths for the root path.
- Cache the app shell for offline startup after first load.
- Do not rely on runtime server features, API routes, or SSR assumptions.

## UX Guardrails

- Optimize for one-handed use on a phone.
- Prefer large touch targets and bottom-reachable primary actions.
- Minimize text entry during workouts.
- The training flow should feel like a focused execution mode, not a CRUD form.
- The current exercise must be visually dominant.
- Rest timer interactions should be one-tap and recoverable after backgrounding or reload.

## Runs

- A run is its own table (`runLogs`), one row per run: local calendar day, distance, duration, optional elevation gain, optional average heart rate, optional notes. It has no sets and no session machinery — no materialization, no timers, no set snapshots. Its one snapshot is `runPlanSnapshot`, what the plan entry it fulfils prescribed.
- Pace is derived from distance and duration and never stored.
- Unlike a completed session, a run stays editable and deletable: it is one row of numbers copied off a watch, and a typo should be correctable.
- The date is a local calendar day (`YYYY-MM-DD`), not a timestamp.
- The app invents no heart-rate formulas: no zones, no maximum-pulse estimate, no training load. It stores the number the user entered.

## The dated plan

- Training is planned as single dated entries (`planEntries`): a local calendar day, an order within the day, and either a workout or a run prescription (title plus optional distance, duration, elevation, heart rate, pace and instructions). Several entries per day are fine; the same workout or run title only once per day.
- Entries arrive only through the library import; the user cannot create, edit, move or delete them. The app itself writes them in a few fixed places only: the weekday data fix, the sample data, the `deleteTemplate` cascade of open entries, backup restore and local reset. A series exists only as a copy in the sample data. No recurring weekday schedule, no rule that generates future entries, no automatic rescheduling of a missed day — that would be a second plan source and the automation v1 excludes.
- Whether an entry is open, taken or done is **derived** from the sessions and runs that point at it (`planEntryId`), never stored on the entry. An aborted session takes nothing.
- A taken entry is history: it cannot be changed, deleted or moved.
- The link is made when a session starts or a run is saved. A session takes today's open matching entry, or another day's entry only when the user chose it explicitly (pull forward or catch up, at most 7 days around today) — otherwise it is an extra session and no other day changes. A run takes today's open matching entry, else the earliest open one of the current calendar week, shown and changeable in the run sheet. The program week still comes from `resolveWeekControl`; an entry never chooses it, and `materializeSession` knows nothing of the plan.
- Sessions keep `planDateSnapshot`, runs `runPlanSnapshot`, so history stays readable after an entry changes or goes.

## Restrictions

- A restriction (`restrictions` table) pauses exercises or guided steps for a period — optionally with a replacement exercise — or adjusts their targets, without touching any template. Templates stay the plan; a restriction is a period-bound overlay on it.
- Restrictions arrive only through the library import (block `restrictions`, described for the training assistant in `docs/claude-projekt/import-format.md`). The app's one write path is lifting one (`liftRestriction`); it never creates or edits one — that would be a second place where the plan is made.
- They take effect at session start and **freeze as a snapshot** on the session rows (`pausedBy`, `adjustedBy`, `targetsBeforeAdjustment`, `replacementFor`, …) and on the guided run (`pausedSteps`, `adjustedSteps`). A stored session never changes when a restriction is edited or lifted later. Order of targets: assignment → week rule → adjustment.
- A paused exercise is skipped like a skipped one, but stays visible and can be done anyway (`pauseOverriddenAt`); a guided step is simply not played. No automatic rescheduling, no derived restrictions, no medical logic — the app executes what the plan says.
- Restrictions are information, never a signal colour (see `docs/architecture/ui-palette.md`); details in `docs/architecture/restrictions.md`.

## v1 Scope

Must include:
- template management
- local media upload for exercises
- session start from a template
- session execution plan with per-session edits
- optional warmup set per exercise
- work set logging
- left/right capture
- time plus optional load capture
- rest timer
- last values display
- exercise history graph
- tests with left/right values and asymmetry
- export/import backup
- run logging (distance, duration, elevation, average heart rate)
- guided session (step list from the library import, hands-free run with signal, optional spoken announcements and optional spoken guidance)
- dated training plan (single entries for workouts and runs, written by the library import, read-only in the app)
- restrictions (pause with optional replacement or adjust exercises and guided steps for a period, written by the library import, frozen at session start, liftable in the app)
- installable PWA behavior on GitHub Pages

Must exclude:
- backend services
- cloud sync
- multi-user
- sharing
- video upload
- complex adaptive progression systems
- deload automation
- recurring plan rules or automatic rescheduling
- semantic conflict resolution

## Implementation Guidance

- Prefer feature slices such as:
  - `domain/`
  - `db/`
  - `features/templates/`
  - `features/session/`
  - `features/history/`
  - `features/tests/`
  - `features/media/`
  - `features/settings/`
  - `lib/import-export/`
- Keep business rules out of UI components where possible.
- Add targeted tests for domain rules, migrations, import/export validation, and session materialization.
- Favor incremental delivery: usable workout logging first, then progression, then history/tests, then hardening.

## Review Checklist

Before finalizing a change, verify:
- Does it still work on a static GitHub Pages deployment?
- Does it preserve offline-first behavior?
- Is domain state stored in IndexedDB rather than only UI state?
- Does it avoid mutating templates when changing a running session?
- Does it preserve historical correctness through snapshots or resolved values?
- Does it stay within v1 scope?
- Does it introduce unnecessary backend or sync assumptions?
- Does it keep mobile workout interactions fast and simple?

## Example Triggers

- "Design the persistence layer for session logging."
- "Implement exercise media uploads for the PWA."
- "Review whether this change breaks the agreed v1 scope."
- "Refactor the workout session model."
- "Plan GitHub Pages deployment and offline caching."
