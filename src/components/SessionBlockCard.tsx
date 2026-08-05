import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  Repeat,
  SkipForward,
  Undo2,
} from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { sortSetLogs } from '@/domain/history';
import type { RestTimerTrack, WorkoutSessionExercise } from '@/domain/models';
import { findRestTrack, isRestTrackReady, remainingRestSeconds } from '@/domain/rest-timer';
import {
  describeExerciseTarget,
  summarizeCompletedExercise,
  summarizeExerciseAsymmetry,
  type SessionBlockProgress,
  type SessionExerciseProgress,
} from '@/domain/session-summary';
import { formatNumber, formatSideLabel, formatTimer } from '@/lib/format';
import { cn } from '@/lib/utils';

interface SessionBlockCardProps {
  block: SessionBlockProgress;
  /** Alle Spuren der Session; die Karte sucht sich ihre eigenen heraus. */
  restTracks: RestTimerTrack[];
  /** Gemeinsamer Sekundentakt der Seite. */
  now: number;
  /** Übung, auf deren Satz gerade der Satz-Timer läuft. */
  runningSetTimerExerciseId?: string;
  isReadOnly: boolean;
  isBusy: boolean;
  /** Ob der Block ganz oben bzw. ganz unten steht - die Pfeile sind dann aus. */
  isFirstBlock: boolean;
  isLastBlock: boolean;
  onOpen: (sessionExerciseId: string) => void;
  /** Verschiebt den ganzen Block; im Supersatz wandern alle Mitglieder mit. */
  onMoveBlock: (sessionExerciseId: string, direction: -1 | 1) => void;
  /** Lässt eine Übung aus - oder holt sie zurück. Immer eine einzelne, nie den Block. */
  onToggleSkip: (sessionExerciseId: string) => void;
}

/** Die Pausen einer Übung, beide Seiten, in der Reihenfolge des Ablaufs. */
function restTracksForExercise(tracks: RestTimerTrack[], sessionExerciseId: string) {
  return (['both', 'left', 'right'] as const)
    .map((side) => findRestTrack(tracks, sessionExerciseId, side))
    .filter((track): track is RestTimerTrack => Boolean(track));
}

function restChipLabel(track: RestTimerTrack, now: number) {
  const sideLabel = formatSideLabel(track.side);
  const prefix = sideLabel ? `${sideLabel.charAt(0).toUpperCase()}${sideLabel.slice(1)} ` : '';

  return isRestTrackReady(track, now)
    ? `${prefix}bereit`
    : `${prefix}${formatTimer(remainingRestSeconds(track, now))}`;
}

/**
 * Wo die Übung steht: "Satz 2 von 4".
 *
 * Gezählt werden Satz*zeilen* - genau wie im Kopf der Seite und im Zähler des
 * Blocks. Bei einer einbeinigen Übung sind das zwei je Satznummer, deshalb
 * steht die Seite dahinter. Die Position ist die der nächsten offenen Zeile
 * und nicht die Zahl der erledigten: abgehakt werden darf auch außer der
 * Reihe.
 */
function describeSetPosition(item: SessionExerciseProgress) {
  const rows = sortSetLogs(item.logs);
  const index = item.nextOpenLog ? rows.findIndex((row) => row.id === item.nextOpenLog?.id) : -1;
  const sideLabel = item.nextOpenLog ? formatSideLabel(item.nextOpenLog.side) : '';
  const position = `Satz ${index + 1} von ${rows.length}`;

  return sideLabel ? `${position} · ${sideLabel}` : position;
}

/**
 * Ein Block der laufenden Einheit als Karte.
 *
 * Sie ist die Heimat, wenn das Fokus-Sheet zu ist, und trägt deshalb alles,
 * was währenddessen weiterläuft: den Stand, die Pausen beider Seiten und den
 * Weg zurück. Protokolliert wird hier nichts - dafür gibt es das Sheet. Hier
 * stand einmal ein Häkchen, das den nächsten Satz direkt abhakte; es schrieb
 * keine Werte und war neben dem Öffnen der Übung vor allem verwirrend.
 * Anzutippen ist jede Übung, auch eine fertige.
 *
 * Das Auslassen ist die eine Ausnahme, und es ist keine: es schreibt keinen
 * Satz, sondern ändert den *Plan* dieser Einheit - und das ist genau die
 * Entscheidung, die man in der Liste trifft, bevor man eine Übung öffnet. Im
 * Fuß des Sheets stand es früher acht Pixel unter dem Abhaken-Knopf, auf
 * derselben Bahn des Daumens; siehe `renderSheetFooter` in [SessionPage].
 */
export function SessionBlockCard({
  block,
  restTracks,
  now,
  runningSetTimerExerciseId,
  isReadOnly,
  isBusy,
  isFirstBlock,
  isLastBlock,
  onOpen,
  onMoveBlock,
  onToggleSkip,
}: SessionBlockCardProps) {
  const isDone = block.status === 'done';
  const isCurrent = block.status === 'current';
  const firstExerciseId = block.exercises[0]?.exercise.id ?? '';
  /*
   * Beschriftung des ganzen Blocks. Bei einer einzelnen Übung ist das ihr
   * Name - zwei Blöcke mit derselben Beschriftung wären für die Bedienung per
   * Sprache oder Test nicht mehr auseinanderzuhalten. Im Supersatz sind es
   * deshalb die Namen der Mitglieder und nicht mehr ihre Kennbuchstaben.
   */
  const exerciseNames = block.exercises.map((item) => item.exercise.exerciseNameSnapshot);
  const blockLabel = block.isSuperset
    ? `Supersatz: ${exerciseNames.join(' und ')}`
    : (exerciseNames[0] ?? 'Übung');

  return (
    <section
      aria-label={blockLabel}
      /*
       * Der Zustand auch als Attribut, nicht nur als Farbe: welcher Block dran
       * ist, ist eine Aussage über die Einheit und keine Frage des Aussehens.
       * Die e2e-Tests lesen ihn hier ab, statt Klassennamen zu raten.
       */
      data-block-status={block.status}
      className={cn(
        'rounded-card p-3.5 transition',
        isDone && 'bg-success text-success-contrast',
        isCurrent && 'bg-highlight text-highlight-contrast shadow-soft',
        !isDone && !isCurrent && 'border border-line bg-surface',
      )}
    >
      <div className="flex min-h-[28px] items-center justify-between gap-3">
        {/*
          Der Zählstand steht am Block, nicht an jeder Übung: im Supersatz ist
          "4 von 9" die Zahl, nach der man sucht, nicht zweimal eine halbe. Er
          steht in jeder Karte an derselben Stelle - eine Zahl, die je nach
          Zustand die Seite wechselt, muss beim Durchscrollen gesucht werden.
        */}
        <p
          className={cn(
            /*
              Das pl gleicht das Polster der Zeilen darunter aus: die Übungen
              sitzen in Tastflächen mit eigenem px, der Zähler ist nur Text.
              Ohne den Ausgleich stünde er als einziges Element der Karte
              weiter links als alles andere.
            */
            'shrink-0 pl-2.5 font-display text-xs font-bold tabular-nums',
            isDone && 'opacity-75',
            !isDone && !isCurrent && 'text-content-muted',
          )}
        >
          {isDone ? (
            <span className="inline-flex items-center gap-1">
              <Check size={13} strokeWidth={3} aria-hidden="true" />
              {block.totalCount} Sätze
            </span>
          ) : (
            `${block.completedCount} / ${block.totalCount}`
          )}
        </p>
        {/*
          Nur der Supersatz wird angeschrieben. "Übung" über einer Übung sagt
          nichts, was der Name zwei Zeilen tiefer nicht schon sagt. Dass ein
          Block gerade dran ist, sagt die limettengrüne Fläche - ein Wort
          "Jetzt" daneben wiederholte das nur. Die Reihenfolge der Mitglieder
          steht ebenfalls nicht mehr hier: sie ist die Reihenfolge der Zeilen
          darunter.
        */}
        <div className="flex min-w-0 items-center gap-1">
          {block.isSuperset ? (
            <p
              className={cn(
                'flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em]',
                isDone || isCurrent ? 'opacity-75' : 'text-content-muted',
              )}
            >
              <Repeat size={13} className="shrink-0" aria-hidden="true" />
              <span className="truncate">Supersatz</span>
            </p>
          ) : null}
          {/*
            Der ganze Block wandert, nicht eine einzelne Übung: die Mitglieder
            eines Supersatzes müssen in der Reihenfolge benachbart bleiben.
            Innerhalb der Gruppe sortiert man im Sheet.
          */}
          {!isReadOnly ? (
            <div className="ml-1 flex shrink-0 items-center gap-0.5">
              <IconButton
                label={`${blockLabel} nach oben`}
                disabled={isBusy || isFirstBlock}
                onClick={() => onMoveBlock(firstExerciseId, -1)}
                className="h-9 w-9 border-transparent bg-transparent"
              >
                <ChevronUp size={16} />
              </IconButton>
              <IconButton
                label={`${blockLabel} nach unten`}
                disabled={isBusy || isLastBlock}
                onClick={() => onMoveBlock(firstExerciseId, 1)}
                className="h-9 w-9 border-transparent bg-transparent"
              >
                <ChevronDown size={16} />
              </IconButton>
            </div>
          ) : null}
        </div>
      </div>

      <div className={cn('mt-2', isDone ? 'space-y-1.5' : 'space-y-2')}>
        {block.exercises.map((item) => (
          <SessionBlockExerciseRow
            key={item.exercise.id}
            item={item}
            status={block.status}
            restTracks={restTracksForExercise(restTracks, item.exercise.id)}
            now={now}
            hasRunningSetTimer={runningSetTimerExerciseId === item.exercise.id}
            isReadOnly={isReadOnly}
            onOpen={onOpen}
            onToggleSkip={onToggleSkip}
          />
        ))}
      </div>
    </section>
  );
}

interface SessionBlockExerciseRowProps {
  item: SessionExerciseProgress;
  status: SessionBlockProgress['status'];
  restTracks: RestTimerTrack[];
  now: number;
  hasRunningSetTimer: boolean;
  isReadOnly: boolean;
  onOpen: (sessionExerciseId: string) => void;
  onToggleSkip: (sessionExerciseId: string) => void;
}

/**
 * Auslassen und Zurückholen - derselbe Knopf, beide Richtungen.
 *
 * Er steht *neben* der Zeile, nicht in ihr: ein Knopf im Knopf ist ungültig,
 * und die Zeile selbst öffnet weiterhin nur. Als Icon, weil man ihn in einer
 * Einheit höchstens einmal braucht; der zugängliche Name trägt den Klartext
 * samt Übungsnamen, weil in einer Liste sonst nicht zu hören ist, welche
 * Übung gemeint ist.
 */
function SkipToggleButton({
  exercise,
  onToggleSkip,
  className,
}: {
  exercise: WorkoutSessionExercise;
  onToggleSkip: (sessionExerciseId: string) => void;
  className?: string;
}) {
  return (
    <IconButton
      label={
        exercise.wasSkipped
          ? `${exercise.exerciseNameSnapshot} zurückholen`
          : `${exercise.exerciseNameSnapshot} auslassen`
      }
      onClick={() => onToggleSkip(exercise.id)}
      className={cn('border-transparent bg-transparent', className)}
    >
      {exercise.wasSkipped ? <Undo2 size={17} /> : <SkipForward size={17} />}
    </IconButton>
  );
}

function SessionBlockExerciseRow({
  item,
  status,
  restTracks,
  now,
  hasRunningSetTimer,
  isReadOnly,
  onOpen,
  onToggleSkip,
}: SessionBlockExerciseRowProps) {
  const { exercise, nextOpenLog } = item;
  const isDone = status === 'done';

  if (isDone) {
    return (
      <ExerciseSummaryLine
        exercise={exercise}
        logsSummary={summarizeCompletedExercise(item.logs)}
        asymmetryPercent={summarizeExerciseAsymmetry(item.logs)}
        wasSkipped={exercise.wasSkipped}
        /*
          Auf der fertigen Karte nur noch der Rückweg: was abgehakt ist, lässt
          man nicht mehr aus - aber eine ausgelassene Übung muss man
          zurückholen können, sonst wäre die Entscheidung endgültig.
        */
        onToggleSkip={!isReadOnly && exercise.wasSkipped ? onToggleSkip : undefined}
        onOpen={() => onOpen(exercise.id)}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpen(exercise.id)}
          aria-label={`${exercise.exerciseNameSnapshot} öffnen`}
          className={cn(
            'flex min-h-touch min-w-0 flex-1 items-center gap-2.5 rounded-panel px-2.5 py-2 text-left transition',
            status === 'current' ? 'bg-surface hover:bg-surface-sunken' : 'hover:bg-surface-raised',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-[15px] font-bold tracking-tight text-content">
              {exercise.exerciseNameSnapshot}
            </span>
            <span className="block truncate text-[12px] font-semibold text-content-muted">
              {exercise.wasSkipped
                ? 'Ausgelassen'
                : hasRunningSetTimer
                  ? 'Satz läuft'
                  : nextOpenLog
                    ? `${describeSetPosition(item)} · ${describeExerciseTarget(exercise)}`
                    : describeExerciseTarget(exercise)}
            </span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-content-muted" aria-hidden="true" />
        </button>
        {/*
          Nur solange an dieser Übung noch etwas offen ist: eine Übung, deren
          Sätze alle stehen, kann man nicht mehr auslassen - der Knopf hätte
          nichts zu tun und stünde trotzdem im Weg.
        */}
        {!isReadOnly && (nextOpenLog || exercise.wasSkipped) ? (
          <SkipToggleButton exercise={exercise} onToggleSkip={onToggleSkip} />
        ) : null}
      </div>

      {/*
        Die Pausen hängen an der Übung, zu der sie gehören - und im
        unilateralen Fall an beiden Seiten getrennt. Genau deshalb sind die
        Spuren im Datenmodell nach (Übung, Seite) geschlüsselt.
      */}
      {restTracks.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-1">
          {restTracks.map((track) => {
            const isReady = isRestTrackReady(track, now);

            return (
              <span
                key={`${track.sessionExerciseId}-${track.side}`}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold tabular-nums',
                  isReady
                    ? 'bg-success text-success-contrast'
                    : 'bg-surface text-content-secondary',
                )}
              >
                <Clock3 size={11} aria-hidden="true" />
                {restChipLabel(track, now)}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Die Zeile einer erledigten Übung.
 *
 * Sie behält ihre Summe, statt zu verschwinden: das ist der Teil, den man nach
 * der Einheit noch einmal anschaut, und er hält die Liste in der Reihenfolge,
 * in der trainiert wurde. Anklickbar bleibt sie auch - ein Wert, den man
 * daneben eingetragen hat, ist sonst nicht mehr zu erreichen.
 */
function ExerciseSummaryLine({
  exercise,
  logsSummary,
  asymmetryPercent,
  wasSkipped,
  onToggleSkip,
  onOpen,
}: {
  exercise: WorkoutSessionExercise;
  logsSummary?: string;
  asymmetryPercent?: number;
  wasSkipped: boolean;
  onToggleSkip?: (sessionExerciseId: string) => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${exercise.exerciseNameSnapshot} öffnen`}
        className={cn(
          'flex min-h-touch min-w-0 flex-1 items-baseline justify-between gap-3 rounded-panel px-2 py-1.5 text-left transition',
          'hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight',
        )}
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {exercise.exerciseNameSnapshot}
        </span>
        <span className="shrink-0 font-display text-[13px] font-bold tabular-nums">
          {wasSkipped ? (
            <span className="inline-flex items-center gap-1 opacity-75">
              <SkipForward size={12} aria-hidden="true" />
              ausgelassen
            </span>
          ) : (
            <>
              {logsSummary}
              {typeof asymmetryPercent === 'number' ? (
                <span className="ml-2 opacity-75">Δ {formatNumber(asymmetryPercent)} %</span>
              ) : null}
            </>
          )}
        </span>
      </button>
      {/*
        Auf der waldgrünen Karte trägt der Knopf die Farbe der Karte: der
        Fokusring der App ist Tinte und wäre hier kaum zu sehen, deshalb der
        limettene Ring wie bei der Zeile daneben.
      */}
      {onToggleSkip ? (
        <SkipToggleButton
          exercise={exercise}
          onToggleSkip={onToggleSkip}
          className="text-success-contrast hover:bg-white/10 focus-visible:ring-highlight focus-visible:ring-offset-0"
        />
      ) : null}
    </div>
  );
}
