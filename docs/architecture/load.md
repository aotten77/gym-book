# Load: kilos, bands, height

Moved verbatim from `CLAUDE.md`. Paths in links are relative to this folder.

### Load: kilos or bands

An exercise carries **either** a weight in kg **or** a resistance band, never both — `Exercise.loadKind` (`'weight' | 'band'`, `undefined` counts as `'weight'`, same additive trick as `includeWarmup`). `supportsLoad` in [tracking.ts](../../src/domain/tracking.ts) says whether the exercise has a load at all; `supportsWeight(trackingMode, loadKind)` and `supportsBand(trackingMode, loadKind)` decide which field the UI shows. Call sites that have a `loadKind` **must** pass it — the one-argument form silently keeps showing kg.

Band levels live in their own table (`bandLevels`, Dexie `version(3)`), edited under `/bands` ([BandsPage.tsx](../../src/pages/BandsPage.tsx), reached from the Bestand hub; no longer in Settings) via [BandLevelsSection.tsx](../../src/components/BandLevelsSection.tsx) and [band-actions.ts](../../src/db/band-actions.ts). `orderIndex` is the content, not cosmetics: it is the *only* thing that makes "gelb" lighter than "rot", and it drives the progress chart's y-axis. Reorder rewrites it as a dense 1-based sequence, like `reorderTemplateExercises`.

Set logs carry **two** flat fields, `bandId` plus `bandNameSnapshot`: the id resolves the rank for the chart, the name keeps history readable after a rename or deletion — a dangling id costs a chart point, never an entry. `updateSetLogValues` resolves the name itself from `bandLevels` and writes both together (or clears both); an unknown id is ignored rather than stored. `deleteBandLevel` therefore leaves set logs alone and only clears `targetBandId` on template exercises and progression rules. For the same reason `assertReferentialIntegrity` in `export.ts` deliberately does **not** check band references — it would reject a user's own backup.

`progressMetricFor(trackingMode, loadKind, tracksHeight)` returns the `'band'` metric, and `buildProgressSeries` takes a `bandRank` resolver; `ProgressChart` gets `formatValue` so the axis reads "grün" instead of "3" and drops the numeric delta.

### Height in centimetres: a dimension, not a third load

`Exercise.tracksHeight` switches on a **height in cm** — the step of a step-down, the box you squat to. It sits *beside* kg or band, never in place of them, because height is not the load but the way the exercise travels: a step-down from 25 cm can still hold dumbbells. That is the one field that does **not** hang off `trackingMode` — `supportsHeight(tracksHeight)` in [tracking.ts](../../src/domain/tracking.ts) asks the exercise alone. Additive like `includeWarmup` and `loadKind`: `undefined` counts as off, and `normalizeTracksHeight` never writes a `false`, so "off" has exactly one spelling.

The value lives in its own flat field at every level — `heightCm` on `WorkoutSetLog`, `targetHeightCm` on template exercise, session exercise and `ProgressionRule` — and `tracksHeight` is snapshot onto `WorkoutSessionExercise` like `loadKind`. Reusing `weight` for it would have been cheaper and wrong twice over: `sumWorkVolume` would sum centimetres into a kg figure, and an exercise could no longer carry both.

Three consequences. `progressMetricFor` lets height **beat** weight, seconds and band — you switch it on precisely because that is where progress happens (20 cm → 25 cm), so that is the curve to draw; the volume tile keeps counting the dumbbells, unlike the band case which is zeroed. `describeSetRowValues` puts height in the load slot when there is no kg and no band (`25 cm × 8` reads like `62,5 kg × 5`) and otherwise prefixes it (`25 cm · 12,5 kg × 8`), so the same string works on a 320px row. And the `+`/`−` step is 5 cm, because steps, boxes and plate stacks come in that spacing.
