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

- Every exercise has at most one warmup set in v1; the template may switch it off via `includeWarmup: false`.
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
- Resolve the active program week when the session starts.
- Persist that resolved week on the session so historical sessions do not change when the current week changes.
- Do not build deload or reset automation in v1.
- Allow a manual override of the active week for future flexibility.

## History and "Last Values"

- "Last values" means the last completed execution of the same `Exercise`.
- Do not scope this to the same template slot in v1.
- If helpful in UI, show the source context such as the template name where the last values came from.
- Keep test history separate from workout history.

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

- Configure Vite with `base: '/gym-book/'`.
- Use `HashRouter` to avoid deep-link issues on GitHub Pages.
- Configure manifest and service worker paths for the repository subpath.
- Cache the app shell for offline startup after first load.
- Do not rely on runtime server features, API routes, or SSR assumptions.

## UX Guardrails

- Optimize for one-handed use on a phone.
- Prefer large touch targets and bottom-reachable primary actions.
- Minimize text entry during workouts.
- The training flow should feel like a focused execution mode, not a CRUD form.
- The current exercise must be visually dominant.
- Rest timer interactions should be one-tap and recoverable after backgrounding or reload.

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
- installable PWA behavior on GitHub Pages

Must exclude:
- backend services
- cloud sync
- multi-user
- sharing
- video upload
- complex adaptive progression systems
- deload automation
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
