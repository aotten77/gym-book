# Restrictions: pauses and adjustments over a period

Condensed from the design spec (`docs/superpowers/specs/2026-11-24-einschraenkungen-design.md`). A restriction („Einschränkung“, e.g. „Beispiel A“) **pauses** exercises or guided steps for a period — optionally with a replacement exercise — or **adjusts** their targets, without touching any template. Templates stay the plan; a restriction is a period-bound overlay that takes effect when a unit starts.

### Model

`Restriction` (table `restrictions`, DB version 8, `'id'` only): `name` (identity, `normalizeImportKey`), optional `reason`, `from` and optional `until` (both inclusive, `YYYY-MM-DD`), optional `liftedAt`, `pauses` and `adjustments`. A target has exactly one of four forms, for pauses and adjustments alike: exercise everywhere, exercise in one template, step in one guided template, step in every guided template (also future ones). An exercise target never hits a guided step, even with the same name. A pause of an exercise may carry a `replacement` (exercise + `workSetCount`, optional targets and rest). An exercise adjustment sets any of `workSetCount`, `targetReps`, `targetRepsMax`, `targetSeconds`, `targetWeight`, `targetHeightCm`, `note`, `holdProgression`; a step adjustment `seconds` (same meaning as `GuidedStep.seconds`, i.e. the total of both sides for a two-sided step) and/or `note`. Dead targets (deleted workout, removed assignment, step gone) stay in the record, hit nothing and are shown greyed — nothing cascades.

States (`describeRestrictionState`): `aktiv` (from ≤ day ≤ until, not lifted), `angekündigt`, `abgelaufen` (past `until`, not the same as lifted), `aufgehoben`. Only `lifted: true` in an import or the „Aufheben“ button lifts; only an explicit `lifted: false` reactivates.

### Pure rules ([restriction.ts](../../src/domain/restriction.ts))

- `resolveRestrictionEffect` / `applyRestrictionEffect` — what the restrictions active on a day do to one exercise; targets are applied in the order **assignment → week rule → adjustment**. `targetsBeforeAdjustment` holds only fields that actually changed (`null` where only the adjustment set a value); an adjustment equal to the week value is no deviation.
- `resolveGuidedSteps` — splits a guided template's steps into played (with adjusted seconds), `pausedSteps` and `adjustedSteps`; pause beats adjustment.
- `sessionRestrictionKind` — exactly one kind per session row, ranked `pausiert` > `trotzdem` > `angepasst` > `ausgenommen` > `ersatz` > `gehalten` > `hinweis`. `isRestrictedExecution` (`trotzdem`, `angepasst`, `ausgenommen`) is the one place deciding what is **not** a performance level.
- `findAdjustmentConflicts` — two adjustments setting the same value on the same target in overlapping periods, or two replacements for one exercise, abort the import. Notes stack.

### Start and the running unit

- **Strength** (`startSessionFromTemplate`, `addSessionExercise`): the restrictions of the start day freeze as a snapshot on `WorkoutSessionExercise` (`pausedBy`, `pausedUntil`, `adjustedBy`, `adjustmentNotes`, `targetsBeforeAdjustment`, `progressionHeld`, `replacementFor`). A replacement is inserted right after the paused exercise (`orderIndex` stays dense); it is evaluated against restrictions but never gets its own replacement. A replacement whose exercise is gone is skipped.
- A paused exercise keeps its open sets but is skipped when walking the unit (`isInactiveSessionExercise`), like a skipped one; in a superset the partner runs alone. „Trotzdem machen“ sets `pauseOverriddenAt` and is reversible until the first set is ticked. See `session-screen.md` for the labels, the pause sheet and the greyed block.
- **Guided** (`startGuidedSession`): `GuidedRun.steps` holds only played steps; all paused → no start. The log maps `stepIndex` back to the template and adds `paused` rows (`withRestrictionProtocol`). Announcements include the effective sentences. See `guided-templates.md`.
- A stored session never changes when a restriction is edited or lifted later — the same principle as `resolvedProgramWeek`. The import never writes into sessions.

### After the unit

- **Last values, progression hint, chart:** rows that are `angepasst`, `trotzdem` or `ausgenommen` do not count as last values and get no progression hint; the chart draws them hollow and dashed („unter Einschränkung“) and leaves them out of the trend. `ersatz`, `gehalten`, `hinweis` count normally. In the running unit `trotzdem`, `angepasst` and a held progression (`progressionHeld`, also on a replacement) suppress the hint (`suppressesProgressionHint`).
- **History switch** „Zählt nicht als Leistungsstand“ sets or removes `excludedFromProgressAt` on one exercise of a completed session — the one exception to "a completed session is history"; no value changes.

### Outside the unit

Plan card, restriction sheet with „Aufheben“, Workout-detail labels and the Now-sheet line are described in `plan-timeline.md` („Restrictions outside the session“); the read side is [restriction-queries.ts](../../src/db/restriction-queries.ts), computed exactly like a start. `liftRestriction` in [restriction-actions.ts](../../src/db/restriction-actions.ts) is the app's only write path — creating or editing one in the app would be a second place where the plan is made.

### Import, backup, export

- **Library import** block `restrictions`: identity by name, `pauses` / `adjustments` replace the whole list when named, every object `.strict()`, unknown top-level blocks abort the whole import (except `_hinweis`), a `steps` import that loses a step targeted via `template` + `step` aborts unless the same file changes that restriction. A `{ step }` without template must match a guided template — unless the same list of that restriction already holds it (an idle target stays, `bestand.json` names it, and re-importing the inventory must not abort). The full format, with examples tested against the real parser, is `docs/claude-projekt/import-format.md` — **change it in the same step as the import code**.
- **Backup**: the table and every snapshot field are in the Zod schemas of `export.ts` (a plain `z.object` drops unknown keys).
- **Analysis export**: three columns at the end of `sessions.csv`, status `pausiert` and a column in `protokoll.csv`, `meta.einschraenkungen`, and `bestand.json.restrictions` in import form. See `import-export.md`.

### Colour

Ink only — no lime, no forest green, no red: a restriction is information, not a signal (`ui-palette.md`).
