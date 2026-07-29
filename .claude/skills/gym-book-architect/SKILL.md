---
name: gym-book-architect
description: Binding architecture and v1 scope contract for the Gym Book offline-first PWA. Invoke when planning, implementing, or reviewing any feature — domain entities, persistence, migrations, session flows, progression logic, media, import/export, PWA behaviour, or history views.
---

# Gym Book PWA Architect

Binding contract for this repository. Mirrored from `.trae/documents` / `.trae/skills/gym-book-pwa-architect/SKILL.md`, which the Trae editor uses. **When one changes, change both** — two diverging copies of a contract are worse than none.

Use this skill when:
- planning project structure or feature boundaries
- defining or changing domain entities, persistence, or migrations
- implementing PWA, offline, storage, import/export, or media handling
- designing session flows, progression logic, or history views
- reviewing whether a change still fits the v1 constraints

Do not use it for generic framework tutorials or unrelated repositories.

## Product constraints

- Hosting is fixed to GitHub Pages. The app is a static, client-side PWA.
- Stack is Vite + React + TypeScript. Routing uses `HashRouter` for Pages compatibility.
- Offline-first. v1 is single-user, no cloud sync, no backend.
- Local media upload is required. Media is images plus animated GIF/WebP — **not video**.

## Core architecture

- Local-first client app, not a web app with deferred server features.
- Domain data lives in IndexedDB via Dexie. `src/db/` is the only place that touches Dexie.
- Zustand holds **ephemeral UI state only** — never domain records. If state must survive a reload, it belongs in IndexedDB.
- Keep business rules out of UI components. `src/domain/` is pure: no Dexie, no React.
- Every persisted entity has stable IDs and timestamps supporting migrations and export/import.

## The plan/execution split — the central invariant

`WorkoutTemplate` + `WorkoutTemplateExercise` describe the *plan*. Starting a workout **materializes** an independent execution copy (`WorkoutSession` + `WorkoutSessionExercise` + `WorkoutSetLog`) via `materializeSession`.

- Editing a running session — adding, skipping, reordering, changing targets — must **never** mutate the template.
- Session rows carry `*Snapshot` fields and `resolvedProgramWeek` so history stays correct when templates, programs, or the active week later change.
- Ad hoc additions may be applied back to the template only through an explicit user action.
- Persist enough session state to survive reload and recovery **during** a workout.

## Set logging rules

- Exactly one warmup set per exercise, modelled explicitly (`setKind: 'warmup'`, `setNumber: 0`, `side: 'both'`) — not implied in UI only.
- Work sets are logged separately from the warmup set.
- Time-based exercises may carry both `seconds` and `weight`.
- Unilateral exercises capture left/right; in v1 both sides share the same set count.
- Keep the set-log model flat so queries and history stay simple.

## Progression rules

- Calendar-week based, never driven by completed session count.
- Resolve the active week at session start (`weekOverride ?? program.activeWeek ?? 1`) and persist it on the session, so historical sessions do not shift when the current week changes.
- Manual week override must stay possible. No deload or reset automation in v1.

## History and "last values"

- "Last values" means the last **completed** execution of the same `Exercise` — not the last row, and not scoped to the same template slot.
- Show source context (template name, date) where it helps.
- Keep test history separate from workout history.

## Persistence and import/export

- Explicit tables per entity, never opaque blobs.
- Schema versioning and migrations from the start. The DB lives on real user devices and **cannot be reset** — every schema change needs a new `version(n).stores({...})` plus an `upgrade()` where data reshaping is required.
- Export format is versioned and validated. Validate imports for: schema version, **referential integrity**, and **supported media types**.
- No multi-device conflict resolution in v1.

## PWA and GitHub Pages

- `base: '/gym-book/'`, `HashRouter`, manifest and service worker scoped to the subpath.
- Cache the app shell for offline startup. No runtime server features, API routes, or SSR assumptions.

## UX guardrails

- One-handed phone use. Large touch targets (≥44px), primary actions reachable at the bottom.
- Minimise text entry during workouts. The training flow is a focused execution mode, not a CRUD form.
- The current exercise must be visually dominant.
- Rest timer must be one-tap and **recoverable after backgrounding or reload**.

## v1 scope

Must include: template management · local media upload · session start from template · per-session execution edits · one warmup set · work set logging · left/right capture · time plus optional load · rest timer · last values · exercise history graph · tests with left/right values and asymmetry · export/import backup · installable PWA on Pages.

Must exclude: backend services · cloud sync · multi-user · sharing · video upload · complex adaptive progression · deload automation · semantic conflict resolution.

## Review checklist

Before finalising any change, answer these:

1. Does it still work on a static GitHub Pages deployment?
2. Does it preserve offline-first behaviour?
3. Is domain state in IndexedDB rather than only in UI state? **Would it survive a reload mid-workout?**
4. Does it avoid mutating templates when changing a running session?
5. Does it preserve historical correctness through snapshots or resolved values?
6. Can a write path **delete** data the user already entered? (Dexie `Table.update` treats `undefined` as *delete this property*.)
7. Is every user-facing failure visible to the user, or does it fail silently?
8. Does it stay within v1 scope and introduce no backend/sync assumptions?

## Conventions

- UI strings are German with ASCII-transliterated umlauts (`Uebung`, `ungueltig`). Error messages thrown from `db/` actions are user-facing.
- `@/` alias for `src/`. IDs via `createId()` from `src/lib/id.ts`. Timestamps are ISO strings.
- Tests concentrate on `domain/`, `db/` actions and import/export — not components.
