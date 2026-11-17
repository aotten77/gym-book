import { Check, SkipForward } from 'lucide-react';
import { sortSetLogs } from '@/domain/history';
import {
  describeExerciseTarget,
  describeSetRow,
  describeSetRowValues,
  summarizeCompletedExercise,
  summarizeExerciseAsymmetry,
  type SessionBlockProgress,
  type SessionExerciseProgress,
} from '@/domain/session-summary';
import { DONE_SURFACE } from '@/components/ui/StatusCard';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

interface SessionBlockFinishedProps {
  block: SessionBlockProgress;
  /** Der nächste offene Block, wenn es noch einen gibt - siehe `findNextOpenBlock`. */
  next?: SessionBlockProgress;
}

/**
 * Was im Sheet steht, nachdem der letzte Satz eines Blocks abgehakt ist.
 *
 * Das Sheet schloss sich an dieser Stelle früher von selbst, und die nächste
 * Übung musste man in der Liste suchen. Jetzt bleibt es offen, zeigt die
 * fertige Übung waldgrün mit dem, was geschafft wurde, und darunter ruhig, was
 * als Nächstes kommt. Gesprungen wird nicht: den Wechsel trägt der große Knopf
 * im Fuß ("Weiter: …"), und erst sein Tap öffnet den nächsten Block - zwischen
 * zwei Übungen wird umgebaut, getrunken, gelaufen.
 *
 * Keine Limette: hier ist nichts "jetzt dran". Waldgrün heißt fertig, und die
 * Danach-Zeile ist eine Vorschau in Tinte auf Weiß.
 */
export function SessionBlockFinished({ block, next }: SessionBlockFinishedProps) {
  return (
    <div data-sheet-finished="" className="space-y-2">
      {block.exercises.map((item) => (
        <FinishedExerciseCard key={item.exercise.id} item={item} />
      ))}
      {next ? <NextBlockLine block={next} /> : null}
    </div>
  );
}

function FinishedExerciseCard({ item }: { item: SessionExerciseProgress }) {
  const { exercise } = item;
  const completedLogs = sortSetLogs(item.logs).filter((log) => log.completed);
  const summary = summarizeCompletedExercise(item.logs);
  const asymmetryPercent = summarizeExerciseAsymmetry(item.logs);

  return (
    <section aria-label={exercise.exerciseNameSnapshot} className={cn(DONE_SURFACE, 'space-y-2 p-3')}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-1.5 font-display text-lg font-extrabold leading-tight tracking-tight">
          <span className="truncate">{exercise.exerciseNameSnapshot}</span>
          <Check size={18} aria-hidden="true" className="shrink-0" />
        </h3>
        <p className="shrink-0 text-[13px] font-semibold tabular-nums opacity-75">
          {exercise.wasSkipped ? (
            <span className="inline-flex items-center gap-1">
              <SkipForward size={12} aria-hidden="true" />
              ausgelassen
            </span>
          ) : (
            <>
              {summary}
              {typeof asymmetryPercent === 'number' ? (
                <span className="ml-2">Δ {formatNumber(asymmetryPercent)} %</span>
              ) : null}
            </>
          )}
        </p>
      </div>
      {completedLogs.length > 0 ? (
        <ul className="space-y-1">
          {completedLogs.map((log) => (
            <li
              key={log.id}
              className="flex items-baseline justify-between gap-3 rounded-control bg-white/10 px-2.5 py-1.5 text-[13px]"
            >
              <span className="min-w-0 truncate">{describeSetRow(log)}</span>
              <span className="shrink-0 font-display font-bold tabular-nums">
                {describeSetRowValues(log, {})}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Die eine ruhige Zeile mit dem, was als Nächstes dran ist.
 *
 * Bewusst keine Schaltfläche: die Handlung ist der große Knopf im Fuß, und
 * zwei Wege an dieselbe Stelle wären zwei Ziele für denselben Daumen.
 */
function NextBlockLine({ block }: { block: SessionBlockProgress }) {
  const names = block.exercises
    .filter((item) => !item.isDone)
    .map((item) => item.exercise.exerciseNameSnapshot);
  const target = block.isSuperset ? undefined : describeExerciseTarget(block.exercises[0].exercise);

  return (
    <div data-sheet-next="" className="rounded-panel bg-surface px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">
        Danach{block.isSuperset ? ' · Supersatz' : ''}
      </p>
      <p className="mt-0.5 text-[15px] font-bold text-content">{names.join(' + ')}</p>
      {target ? <p className="text-[13px] text-content-muted">{target}</p> : null}
    </div>
  );
}
