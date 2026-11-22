import { useEffect, useRef, useState } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { GuidedEndDialog } from "@/components/GuidedEndDialog";
import { GuidedHintDialog } from "@/components/GuidedHintDialog";
import { GuidedSideTag } from "@/components/GuidedSideTag";
import { GuidedStage } from "@/components/GuidedStage";
import { Button, IconButton } from "@/components/ui/Button";
import { DONE_SURFACE } from "@/components/ui/StatusCard";
import { db } from "@/db/appDb";
import {
  abortGuidedSession,
  completeGuidedSession,
  recordGuidedControl,
  type GuidedControl,
} from "@/db/guided-session-actions";
import {
  GUIDED_EXTEND_SECONDS,
  deriveGuidedRunState,
  type GuidedRunState,
} from "@/domain/guided-run";
import type { GuidedSection } from "@/domain/guided-steps";
import type { GuidedRun, GuidedStep, WorkoutSession } from "@/domain/models";
import { useNowTicker } from "@/hooks/useNowTicker";
import { formatStepClock } from "@/lib/format";
import { playGuidedSignal, primeTimerSound } from "@/lib/sound";
import { keepScreenAwake } from "@/lib/wake-lock";
import { cn } from "@/lib/utils";

/** Kleinschrift über einem Block - auf Tinte in gedämpftem Papier. */
const CAPTION_CLASSES =
  "text-[10px] font-bold uppercase tracking-[0.16em] text-accent-contrast/60";

/** Der Umfang des Rings im Wechsel (Radius 56). */
const RING_CIRCUMFERENCE = 2 * Math.PI * 56;

/**
 * Der Screen der laufenden geführten Einheit und ihr Abschluss.
 *
 * Er liest die Session (Schritt-Snapshot und Ereignisse stehen in IndexedDB)
 * und leitet daraus bei jedem Takt den Stand ab - `deriveGuidedRunState` hat
 * keine Uhr, deshalb stimmt die Zeit nach Reload und Hintergrund von selbst.
 * Verpasste Signale fallen nach der Frische-Regel weg.
 *
 * Der Takt ist ein Viertelsekunden-Takt: die Restzeit rundet auf, und ein
 * Sekundentakt ließe den Wechsel bis zu eine Sekunde nach dem Ende der Übung
 * kommen. Das Signal selbst merkt sich seinen Schlüssel, damit es nur einmal
 * klingt, auch wenn der Stand mehrere Takte lang „fällig“ ist.
 *
 * Pause hält die Zeit an (Ereignisse, nicht Zustand im Screen) und zeigt den
 * Pause-Screen mit Weiter, Schritt neu starten und - nach Rückfrage - Einheit
 * beenden, das abbricht und den Plan-Termin offen lässt.
 *
 * Das X verkleinert nur: die Einheit läuft weiter, und der Streifen der App
 * führt zurück. Solange der Screen zu ist, klingt nichts - der Ton gehört zu
 * diesem Screen. Dunkel ist alles, was läuft; auf jedem Screen steht höchstens
 * eine Lime-Fläche (die Übung, im Wechsel der Ring).
 */
export function GuidedRunPage() {
  const { sessionId } = useParams();
  const session = useLiveQuery(
    async () =>
      sessionId ? ((await db.workoutSessions.get(sessionId)) ?? null) : null,
    [sessionId],
  );

  if (session === undefined) {
    return (
      <GuidedStage label="Geführte Einheit" screen="loading" tone="dark">
        {null}
      </GuidedStage>
    );
  }

  if (!session?.guided || session.status === "aborted") {
    // Abgebrochen oder keine geführte Session: hier gibt es nichts zu zeigen.
    return <Navigate to="/" replace />;
  }

  return <GuidedRunScreen session={session} guided={session.guided} />;
}

function GuidedRunScreen({
  session,
  guided,
}: {
  session: WorkoutSession;
  guided: GuidedRun;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = session.status === "active";
  const now = useNowTicker(isActive, 250);
  const state = deriveGuidedRunState(guided.steps, guided.events, now);
  const playedSignals = useRef<Set<string>>(new Set());
  // Der Abschnitt, in dem der Hinweis aufging: ein Wechsel schließt ihn von selbst.
  const [hintSection, setHintSection] = useState<number | null>(null);
  const [isEndAsked, setIsEndAsked] = useState(false);

  // Der nächste Abschnittswechsel schließt den Hinweis - auch ein Sprung vor oder zurück:
  // ohne das ginge er beim Zurück in denselben Abschnitt wieder von selbst auf.
  useEffect(() => {
    if (hintSection !== null && hintSection !== state.sectionIndex) {
      setHintSection(null);
    }
  }, [hintSection, state.sectionIndex]);

  // Der Bildschirm bleibt an, solange die Einheit läuft - unabhängig von der
  // Einstellung: schläft iOS ein, friert es die App ein, und das Signal bleibt aus.
  useEffect(() => (isActive ? keepScreenAwake() : undefined), [isActive]);

  // Nach einem Reload ist der Ton noch gesperrt; die nächste Berührung gibt ihn frei.
  useEffect(() => {
    if (isActive) {
      primeTimerSound();
    }
  }, [isActive]);

  const signalKey = isActive ? (state.dueSignal?.key ?? null) : null;

  useEffect(() => {
    if (signalKey && !playedSignals.current.has(signalKey)) {
      playedSignals.current.add(signalKey);
      playGuidedSignal();
    }
  }, [signalKey]);

  // Das automatische Ende. Die Aktion prüft selbst, ob es erreicht ist.
  const isFinishedRun = isActive && state.phase === "finished";

  useEffect(() => {
    if (isFinishedRun) {
      void completeGuidedSession(session.id).catch(() => {});
    }
  }, [isFinishedRun, session.id]);

  function control(type: GuidedControl) {
    // Ungültig (zweiter Tipp, schon zu Ende): der Stand aus der DB bleibt maßgeblich.
    void recordGuidedControl(session.id, type).catch(() => {});
  }

  function endRun() {
    setIsEndAsked(false);
    void abortGuidedSession(session.id)
      .catch(() => {})
      .then(() => navigate("/", { replace: true }));
  }

  function handleClose() {
    if (location.key === "default") {
      navigate("/");
      return;
    }

    navigate(-1);
  }

  if (state.phase === "finished") {
    return (
      <GuidedFinishedScreen
        name={session.templateNameSnapshot}
        steps={guided.steps}
        state={state}
        onDone={() => navigate("/", { replace: true })}
      />
    );
  }

  const current = state.current;
  const step = guided.steps[state.stepIndex];
  const hint = hintSection === state.sectionIndex ? step?.hint : undefined;

  if (!current || !step) {
    return null;
  }

  if (state.phase === "paused") {
    return (
      <GuidedStage
        label={session.templateNameSnapshot}
        screen="pause"
        tone="dark"
      >
        <div
          data-guided-run
          data-guided-phase="paused"
          data-guided-section={current.kind}
          data-guided-now={state.stepIndex}
          data-guided-remaining={state.remainingSeconds}
          className="flex min-h-0 flex-1 flex-col"
        >
          <RunTop
            state={state}
            stepCount={guided.steps.length}
            onClose={handleClose}
          />

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_13.1rem] gap-[18px] pt-2.5">
            <div className="flex min-w-0 flex-col justify-center opacity-70">
              <p className={CAPTION_CLASSES}>Pausiert</p>
              <h1
                data-guided-name
                className="mt-1 break-words font-display text-[34px] font-extrabold leading-[1.02] tracking-[-0.03em]"
              >
                {step.name}
                {current.side ? <GuidedSideTag side={current.side} /> : null}
              </h1>
              <p
                data-guided-clock
                className="mt-2 font-display text-[72px] font-extrabold leading-[0.9] tracking-[-0.05em] tabular-nums"
              >
                {formatStepClock(state.remainingSeconds)}
              </p>
            </div>

            <div className="flex flex-col items-stretch justify-center gap-2">
              <Button
                variant="primary"
                className={cn(PAPER_BUTTON_CLASSES, "gap-1.5")}
                onClick={() => control("resume")}
              >
                <Play size={14} fill="currentColor" aria-hidden="true" />
                Weiter
              </Button>
              <Button
                variant="secondary"
                className={cn(SOFT_BUTTON_CLASSES, "bg-accent-contrast/10")}
                onClick={() => control("restart")}
              >
                Schritt neu starten
              </Button>
              <Button
                variant="secondary"
                className={cn(
                  SOFT_BUTTON_CLASSES,
                  "bg-transparent text-accent-contrast/60",
                )}
                onClick={() => setIsEndAsked(true)}
              >
                Einheit beenden …
              </Button>
            </div>
          </div>
        </div>

        {isEndAsked ? (
          <GuidedEndDialog
            onConfirm={endRun}
            onCancel={() => setIsEndAsked(false)}
          />
        ) : null}
      </GuidedStage>
    );
  }

  return (
    <GuidedStage label={session.templateNameSnapshot} screen="run" tone="dark">
      <div
        data-guided-run
        data-guided-phase={state.phase}
        data-guided-section={current.kind}
        data-guided-now={state.stepIndex}
        data-guided-remaining={state.remainingSeconds}
        className="flex min-h-0 flex-1 flex-col"
      >
        <RunTop
          state={state}
          stepCount={guided.steps.length}
          onClose={handleClose}
        />

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_13.1rem] gap-[18px] pt-2.5">
          {current.kind === "exercise" ? (
            <ExerciseLeft
              state={state}
              steps={guided.steps}
              onOpenHint={() => setHintSection(state.sectionIndex)}
            />
          ) : (
            <TransitionLeft
              section={current}
              step={step}
              onOpenHint={() => setHintSection(state.sectionIndex)}
            />
          )}

          <div className="flex flex-col items-stretch justify-center gap-2">
            {current.kind === "exercise" ? (
              <>
                <p
                  data-guided-clock
                  className="text-center font-display text-[84px] font-extrabold leading-[0.9] tracking-[-0.05em] tabular-nums"
                >
                  {formatStepClock(state.remainingSeconds)}
                </p>
                <button
                  type="button"
                  className={cn(PLUS_CLASSES)}
                  onClick={() => control("extend")}
                >
                  +{GUIDED_EXTEND_SECONDS} s
                </button>
              </>
            ) : (
              <CountdownRing
                remainingSeconds={state.remainingSeconds}
                fraction={
                  (current.startSeconds +
                    current.seconds -
                    state.elapsedSeconds) /
                  current.seconds
                }
              />
            )}
            <div className="flex items-center gap-2">
              <IconButton
                label="Zurück"
                className={cn(ROUND_ICON_CLASSES)}
                onClick={() => control("back")}
              >
                <SkipBack size={18} fill="currentColor" aria-hidden="true" />
              </IconButton>
              {current.kind === "exercise" ? (
                <Button
                  variant="primary"
                  className={cn(
                    PAPER_BUTTON_CLASSES,
                    "min-w-0 flex-1 gap-1.5 px-2",
                  )}
                  onClick={() => control("pause")}
                >
                  <Pause size={14} fill="currentColor" aria-hidden="true" />
                  Pause
                </Button>
              ) : (
                <Button
                  variant="primary"
                  className={cn(PAPER_BUTTON_CLASSES, "min-w-0 flex-1 px-2")}
                  onClick={() => control("startNow")}
                >
                  Sofort starten
                </Button>
              )}
              {current.kind === "exercise" ? (
                <IconButton
                  label="Überspringen"
                  className={cn(ROUND_ICON_CLASSES)}
                  onClick={() => control("skip")}
                >
                  <SkipForward
                    size={18}
                    fill="currentColor"
                    aria-hidden="true"
                  />
                </IconButton>
              ) : (
                <IconButton
                  label="Pause"
                  className={cn(ROUND_ICON_CLASSES)}
                  onClick={() => control("pause")}
                >
                  <Pause size={16} fill="currentColor" aria-hidden="true" />
                </IconButton>
              )}
            </div>
          </div>
        </div>
      </div>

      {hint ? (
        <GuidedHintDialog
          title={step.name}
          hint={hint}
          footer={
            <span className="flex items-center justify-between gap-3">
              <span>Die Zeit läuft weiter</span>
              <span className="font-display text-xl font-extrabold tabular-nums text-accent-contrast">
                {formatStepClock(state.remainingSeconds)}
              </span>
            </span>
          }
          onClose={() => setHintSection(null)}
        />
      ) : null}
    </GuidedStage>
  );
}

/** Papier auf Tinte: die Hauptaktion des Screens, ohne Lime. */
const PAPER_BUTTON_CLASSES =
  "rounded-full bg-accent-contrast text-accent hover:opacity-90 focus-visible:ring-accent-contrast focus-visible:ring-offset-accent";

/** „+15 s“: ein leiser Knopf, mindestens 44 px hoch. */
const PLUS_CLASSES =
  "mx-auto inline-flex min-h-touch items-center rounded-full bg-accent-contrast/10 px-4 text-xs font-bold text-accent-contrast hover:bg-accent-contrast/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-contrast focus-visible:ring-offset-2 focus-visible:ring-offset-accent";

/** Zurück und Überspringen: runde Symbolknöpfe neben der Hauptaktion. */
const ROUND_ICON_CLASSES =
  "rounded-full border-transparent bg-accent-contrast/10 text-accent-contrast hover:bg-accent-contrast/20 focus-visible:ring-accent-contrast focus-visible:ring-offset-accent";

/** Die leisen Aktionen daneben. */
const SOFT_BUTTON_CLASSES =
  "rounded-full text-accent-contrast hover:bg-accent-contrast/20 focus-visible:ring-accent-contrast focus-visible:ring-offset-accent";

/** Die Kopfzeile von Ablauf und Pause: Verkleinern, Fortschritt, Restzeit. */
function RunTop({
  state,
  stepCount,
  onClose,
}: {
  state: GuidedRunState;
  stepCount: number;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <IconButton
        label="Verkleinern"
        className="rounded-full border-transparent bg-accent-contrast/10 text-accent-contrast hover:bg-accent-contrast/20 focus-visible:ring-accent-contrast focus-visible:ring-offset-accent"
        onClick={onClose}
      >
        <X size={14} aria-hidden="true" />
      </IconButton>
      <ProgressSegments state={state} />
      <span
        data-guided-meta
        className="whitespace-nowrap text-[11px] tabular-nums text-accent-contrast/60"
      >
        {describeMeta(state, stepCount)}
      </span>
    </div>
  );
}

/** „3 / 12 · noch 15:20“ in der Übung, „Wechsel · noch 14:55“ davor. */
function describeMeta(state: GuidedRunState, stepCount: number): string {
  const rest = `noch ${formatStepClock(state.remainingTotalSeconds)}`;

  switch (state.current?.kind) {
    case "transition":
      return `Wechsel · ${rest}`;
    case "sideSwitch":
      return `Seitenwechsel · ${rest}`;
    default:
      return `${state.stepIndex + 1} / ${stepCount} · ${rest}`;
  }
}

/**
 * Ein Segment je Schritt: erledigte gedämpft, der laufende in Weiß teilgefüllt.
 *
 * Weiß und nicht Lime, damit Lime auf dem Screen nur einmal vorkommt.
 */
function ProgressSegments({ state }: { state: GuidedRunState }) {
  return (
    <div
      role="progressbar"
      aria-label="Fortschritt der Einheit"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(state.progress * 100)}
      data-guided-progress={state.progress.toFixed(3)}
      className="flex flex-1 gap-[3px]"
    >
      {state.stepProgress.map((fraction, index) => {
        const isDone = fraction >= 1;
        const isNow = index === state.stepIndex;

        return (
          <i
            key={index}
            data-guided-segment={isDone ? "done" : isNow ? "now" : "todo"}
            className="relative h-1 flex-1 overflow-hidden rounded-sm bg-accent-contrast/15"
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 rounded-sm",
                isNow ? "bg-accent-contrast" : "bg-accent-contrast/55",
              )}
              style={{
                width: `${Math.round((isDone ? 1 : isNow ? fraction : 0) * 100)}%`,
              }}
            />
          </i>
        );
      })}
    </div>
  );
}

function InfoButton({
  stepName,
  onOpen,
}: {
  stepName: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Hinweis: ${stepName}`}
      onClick={onOpen}
      className="-my-2 ml-1 inline-grid h-11 w-11 place-items-center rounded-full align-middle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-contrast"
    >
      <span
        aria-hidden="true"
        className="grid h-7 w-7 place-items-center rounded-full bg-accent-contrast/15 font-serif text-base font-bold italic leading-none tracking-normal text-accent-contrast"
      >
        i
      </span>
    </button>
  );
}

/** Dauer der Übung für den Vorschau-Block: „0:45“, bei einem beidseitigen Schritt „je Seite“. */
function describeUpcomingDuration(step: GuidedStep): string {
  const clock = formatStepClock(step.seconds);

  return step.bothSides ? `${clock} je Seite` : clock;
}

/** Links in der Übung: sie in Lime, darunter die nächste groß in Weiß. */
function ExerciseLeft({
  state,
  steps,
  onOpenHint,
}: {
  state: GuidedRunState;
  steps: readonly GuidedStep[];
  onOpenHint: () => void;
}) {
  const current = state.current;
  const step = steps[state.stepIndex];
  const next = state.nextExercise;
  const nextStep = next ? steps[next.stepIndex] : undefined;

  return (
    <div className="flex min-w-0 flex-col justify-center">
      <p className={CAPTION_CLASSES}>Jetzt</p>
      <h1
        data-guided-name
        className="mt-1 break-words font-display text-[34px] font-extrabold leading-[1.02] tracking-[-0.03em] text-highlight"
      >
        {step.name}
        {current?.side ? <GuidedSideTag side={current.side} /> : null}
        {step.hint ? (
          <InfoButton stepName={step.name} onOpen={onOpenHint} />
        ) : null}
      </h1>

      <p className={cn(CAPTION_CLASSES, "mt-4")}>Als Nächstes</p>
      {next && nextStep ? (
        <>
          <p
            data-guided-next
            className="mt-1 break-words font-display text-[25px] font-extrabold leading-[1.05] tracking-[-0.03em]"
          >
            {nextStep.name}
            {next.side ? <GuidedSideTag side={next.side} /> : null}
          </p>
          <p className="mt-[5px] text-[13px] tabular-nums text-accent-contrast/60">
            {formatStepClock(next.seconds)}
          </p>
        </>
      ) : (
        <p
          data-guided-next
          className="mt-1 font-display text-[25px] font-extrabold leading-[1.05] tracking-[-0.03em]"
        >
          Ende der Einheit
        </p>
      )}
    </div>
  );
}

/** Links im Wechsel und im Seitenwechsel: was gleich kommt, groß in Weiß. */
function TransitionLeft({
  section,
  step,
  onOpenHint,
}: {
  section: GuidedSection;
  step: GuidedStep;
  onOpenHint: () => void;
}) {
  const isSideSwitch = section.kind === "sideSwitch";

  return (
    <div className="flex min-w-0 flex-col justify-center">
      <p className={CAPTION_CLASSES}>
        {isSideSwitch ? "Seite wechseln" : "Als Nächstes"}
      </p>
      <h1
        data-guided-name
        className="mt-1 break-words font-display text-[34px] font-extrabold leading-[1.02] tracking-[-0.03em]"
      >
        {step.name}
        {isSideSwitch ? <GuidedSideTag side="left" done /> : null}
        {section.side ? <GuidedSideTag side={section.side} /> : null}
        {step.hint ? (
          <InfoButton stepName={step.name} onOpen={onOpenHint} />
        ) : null}
      </h1>
      <p className="mt-[5px] text-[13px] tabular-nums text-accent-contrast/60">
        {describeUpcomingDuration(step)}
      </p>
    </div>
  );
}

/** Der Ring im Wechsel: zählt still herunter, ohne Ticks. Er ist die eine Lime-Fläche. */
function CountdownRing({
  remainingSeconds,
  fraction,
}: {
  remainingSeconds: number;
  /** Wie viel vom Wechsel noch übrig ist, 1 bis 0. */
  fraction: number;
}) {
  const clamped = Math.min(1, Math.max(0, fraction));

  return (
    <div data-guided-ring className="relative mx-auto h-32 w-32">
      <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden="true">
        <circle
          cx="64"
          cy="64"
          r="56"
          fill="none"
          className="stroke-accent-contrast/15"
          strokeWidth="8"
        />
        <circle
          cx="64"
          cy="64"
          r="56"
          fill="none"
          className="stroke-highlight"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - clamped)}
          transform="rotate(-90 64 64)"
        />
      </svg>
      <b
        data-guided-clock
        className="absolute inset-0 grid place-items-center font-display text-[62px] font-extrabold tabular-nums"
      >
        {remainingSeconds}
      </b>
    </div>
  );
}

/**
 * Der Abschluss (Screen 6): die Forest-Karte mit den Kennzahlen.
 *
 * Gespeichert ist längst: das automatische Ende hat die Session abgeschlossen,
 * bevor jemand „Fertig“ tippt. Es steht auch nach einem Reload wieder da.
 * Lime gibt es hier nicht - nichts ist mehr „jetzt dran“.
 */
function GuidedFinishedScreen({
  name,
  steps,
  state,
  onDone,
}: {
  name: string;
  steps: readonly GuidedStep[];
  state: GuidedRunState;
  onDone: () => void;
}) {
  return (
    <GuidedStage label={name} screen="finished" tone="dark">
      <div
        data-guided-done
        className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_13.1rem] items-center gap-[18px]"
      >
        <section className={cn(DONE_SURFACE, "p-4")}>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-75">
            Erledigt
          </p>
          <h1 className="mt-1 break-words font-display text-[26px] font-extrabold leading-[1.02] tracking-[-0.03em]">
            {name}
          </h1>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <Stat
              label="Dauer"
              value={formatStepClock(Math.round(state.totalSeconds))}
            />
            <Stat
              label="Schritte"
              value={`${steps.length - state.skippedStepIndexes.length}/${steps.length}`}
            />
          </dl>
        </section>

        <div className="flex flex-col justify-center">
          {/* Papier auf Tinte: „Fertig“ ist eine Handlung, kein Zustand. */}
          <Button
            variant="primary"
            className="rounded-full bg-accent-contrast text-accent hover:opacity-90 focus-visible:ring-accent-contrast focus-visible:ring-offset-accent"
            onClick={onDone}
          >
            Fertig
          </Button>
        </div>
      </div>
    </GuidedStage>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] bg-success-contrast/10 px-2.5 py-[9px]">
      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] opacity-70">
        {label}
      </dt>
      <dd className="font-display text-2xl font-extrabold tabular-nums">
        {value}
      </dd>
    </div>
  );
}
