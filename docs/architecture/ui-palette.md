# UI layer and palette

Moved verbatim from `CLAUDE.md`. Paths in links are relative to this folder.

## UI layer

`src/components/ui/` holds the primitives — `Button`/`IconButton` (the latter requires a `label`), `TextField`/`TextArea`/`SelectField` (each renders a real `<label for>`), `ConfirmDialog`, and `Sheet`. Use them instead of hand-rolling class chains; the design tokens live in `tailwind.config.js` (`app`, `surface`, `line`, `content`, `accent`, `highlight`, `success`, `danger`, `warning`, plus the `card`/`panel`/`control` radius scale).

### The palette is light, and three colours carry meaning

The app is **Feldgrün**: paper ground (`#f2f2ef`), ink text, deep forest green, one lime. Three tokens are semantic and must never appear as decoration — `highlight` (lime) means *this is up next*, `success` (forest) means *done*, and also *rest is over, you can go*, `danger` means *skipped or deleted*.

`accent` is the **ink**, not the lime. That trips people up, so: lime on a light ground measures 1.3:1 as a text colour and is simply unreadable — it only works as a surface. `accent` therefore stayed what it always was (the emphasised interactive colour: primary button, focus ring, active tab) and only changed hue. Reach for `highlight` when you mean "now", never `text-highlight`.

#### The three colours apply everywhere, not only in the session

"Never as decoration" was once read as "only in the running session", and it left every other screen a stack of identical white cards — `accent.DEFAULT === content.DEFAULT`, so the `bg-accent-soft text-accent` badges out there rendered as ink on paper and said nothing. **Both states exist on every screen; they were simply not painted.** The next workout in the plan timeline *is* up next. Every history entry *is* done — the "Fertig" badge in [HistorySessionPage.tsx](../../src/pages/HistorySessionPage.tsx) was grey for exactly the state the session paints forest green. Four rules follow:

1. **One lime field per screen.** Exactly one thing is up next; two lime surfaces cancel each other out.
2. **Forest green may repeat** — "done" is the state of many things at once.
3. **Don't invent a "now".** History and Übungen deliberately carry *no* lime: in a log and in a library nothing is up next. They don't look bland anyway, because forest green and the exercise images carry them.
4. **Lime is surface, ink is action** — as in the focus sheet, where the current exercise is lime and the check-off button is ink.

The shared pieces live in [ui/StatusCard.tsx](../../src/components/ui/StatusCard.tsx): `NowCard` (lime; with `onClick` the card *is* the button — then its action slot must be decoration, because a button inside a button is invalid), `DoneCard` and `DoneRow` (forest). Secondary text on a filled surface goes through `opacity-75`, as in `SessionBlockCard` — no separate "muted-on-fill" token. A filled surface must never stand for a state that isn't there: with zero sessions this week, the card is a plain `Empty`, not a green one claiming nothing.

**Restrictions are ink, never a signal.** Paused, adjusted, replacement, held and note labels carry no lime, no forest green and no red: a restriction is information, not "up next", "done" or "skipped". The label inherits the colour of the card it sits on through `opacity-75`, like other secondary text on a filled surface. The one exception is the greyed-out card of a fully paused block (`bg-surface-sunken`, `text-content-secondary`): there the label stays at full opacity, because `content-muted` or a faded secondary would fall below 4.5:1 on the sunken ground.

Two pure helpers feed those screens, both deliberately named at length. [next-workout.ts](../../src/domain/next-workout.ts) picks "up next" by heuristic — never trained first, then the oldest completion, ties by name — because `WorkoutTemplate` has no `programId` and a `ProgramWeek` knows no templates; a programme is a progression overlay, not a running order. That is why it is shown as a labelled hint rather than pretending to know a plan: "am längsten her: …" in the plan's "Heute trainieren" row, which only stands when today has no open entry — where there is an entry, the entry is the plan, and the lime card belongs to it (see "The plan: one timeline"). And [calendar-week.ts](../../src/domain/calendar-week.ts) is the week on the *calendar* (Monday, local time), which has nothing to do with `Program.activeWeek` / `resolvedProgramWeek` — those are a hand-set programme week that is never derived from a date. `loadTemplateRecency`, `loadWeekSummary` and `loadExercisesTrainedSince` in [history-queries.ts](../../src/db/history-queries.ts) all run over the `completedAt` index and all filter on `status === 'completed'`: `closeSession` stamps `completedAt` on an *aborted* session too, and aborted is not trained. Training volume is `sumWorkVolume` in [volume.ts](../../src/domain/volume.ts) — load times reps (or seconds), summed, and it filters nothing itself: which sets count is the caller's decision, and the caller already holds the right index. A band contributes zero there because it has no `weight`, which is why the tiles say "Volumen" in kg rather than "Arbeit".

Two rules that are not negotiable, because both were broken across the whole app before: text must reach 4.5:1 contrast (`content-muted` is the *darkest* muted tone the design allows and sits at 5.1:1 on the lightest card), and every interactive element needs a visible focus ring — `index.css` provides a `:where()` baseline, so don't add `outline-none` without a replacement. Touch targets are 44px (`min-h-touch`).

Headings and numbers use `font-display` (Archivo Variable, SIL OFL, self-hosted). Only the weight axis and the latin subset are bundled — 35 kB instead of 90 — and `woff2` is already in the service worker's precache glob, so it is offline after the first start. Body text deliberately stays on the system font.

Changing the ground colour means changing four things outside `tailwind.config.js`: the body colour and `color-scheme` in `index.css`, the focus ring in the same file, the arrow inside `.select-control`'s data-URI SVG, and `theme-color` plus `apple-mobile-web-app-status-bar-style` in `index.html` (`default`, not `black-translucent` — otherwise iOS keeps drawing white status-bar text over a light page).
