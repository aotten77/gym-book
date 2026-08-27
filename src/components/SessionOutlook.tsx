import { useMemo } from 'react';
import type { WorkoutSession, WorkoutSessionExercise } from '@/domain/models';
import { estimateRemainingSessionSeconds, estimatedEndAt } from '@/domain/session-estimate';
import type { SetLogsByExercise } from '@/domain/session-summary';
import type { SupersetBlock } from '@/domain/superset';
import { useNowTicker } from '@/hooks/useNowTicker';
import { cn } from '@/lib/utils';
import { describeRemainingEstimate, formatClockTime, formatRemainingEstimate } from '@/lib/format';

interface SessionOutlookProps {
  session: WorkoutSession;
  blocks: SupersetBlock<WorkoutSessionExercise>[];
  logsByExercise: SetLogsByExercise;
  /** Zwei Zeilen im Kopf des Sheets, eine im Ruhemodus über den Knöpfen. */
  layout?: 'stacked' | 'inline';
  /** Papiergrund wie überall - oder der Tintengrund des Ruhemodus. */
  tone?: 'paper' | 'ink';
  className?: string;
}

/**
 * Restzeit und voraussichtliche End-Uhrzeit, überall dort, wo der Kopfstreifen
 * der Liste nicht hinreicht: im Sheet und im Ruhemodus.
 *
 * Beide Zahlen gehören zusammen und stehen deshalb in einer Komponente. Die
 * Uhrzeit ist dabei die ruhigere - warum, steht bei `estimatedEndAt`.
 *
 * Der Takt sitzt hier im Blatt und nicht auf der `SessionPage`: deren `now` ist
 * Prop jeder Blockkarte und der Stage, unbedingt zu ticken hieße, die ganze
 * Liste sekündlich neu zu zeichnen - auch während im Sheet ein Zahlenfeld den
 * Fokus hat. `SessionStatsHeader` löst es aus demselben Grund genauso.
 *
 * Sind Sheet und Ruhemodus gleichzeitig montiert, rechnen zwei Instanzen je
 * Sekunde. Das ist bewusst in Kauf genommen: die Schätzung ist rein und läuft
 * über die Satzzeilen der Einheit, und sichtbar ist ohnehin immer nur eine von
 * beiden, weil die Übernahme den Bildschirm füllt.
 */
export function SessionOutlook({
  session,
  blocks,
  logsByExercise,
  layout = 'stacked',
  tone = 'paper',
  className,
}: SessionOutlookProps) {
  const now = useNowTicker(session.status === 'active');

  const estimate = useMemo(
    () => estimateRemainingSessionSeconds({ blocks, logsByExercise, now }),
    [blocks, logsByExercise, now],
  );

  if (session.status !== 'active') {
    return null;
  }

  const endsAt = estimatedEndAt(estimate, now);
  const muted = tone === 'ink' ? 'text-accent-contrast/70' : 'text-content-muted';

  // Ohne offene Zeile gibt es keine Restzeit mehr, nur noch den Zustand.
  if (endsAt === null) {
    return (
      <p className={cn('font-semibold tabular-nums', muted, className)} data-session-outlook="done">
        {layout === 'inline' ? 'alle Sätze erledigt' : 'fertig'}
      </p>
    );
  }

  const remaining = formatRemainingEstimate(estimate.remainingSeconds);
  const clock = formatClockTime(endsAt);

  /*
   * Die Fließtextfassung trägt die Vorlesung, die sichtbaren Zeilen sind
   * ausgeblendet: die Tilde läse VoiceOver sonst mit. Kein `aria-live` und kein
   * `role="timer"` - die eine Uhr im Dokument bleibt die bestehende, mehrere
   * mitzählende Bereiche machen einen Screenreader unbrauchbar.
   */
  const spoken = `Voraussichtlich noch ${describeRemainingEstimate(
    estimate.remainingSeconds,
  )}, Ende gegen ${clock} Uhr`;

  if (layout === 'inline') {
    return (
      <p
        data-session-outlook={estimate.quality}
        className={cn('text-[13px] font-semibold tabular-nums', muted, className)}
      >
        <span className="sr-only">{spoken}</span>
        <span aria-hidden="true">
          noch {remaining.value} {remaining.unit} · Ende {clock}
        </span>
      </p>
    );
  }

  return (
    <p
      data-session-outlook={estimate.quality}
      className={cn('text-[11px] font-semibold leading-tight tabular-nums', muted, className)}
    >
      <span className="sr-only">{spoken}</span>
      <span aria-hidden="true" className="block">
        noch {remaining.value} {remaining.unit}
      </span>
      <span aria-hidden="true" className="block">
        bis {clock}
      </span>
    </p>
  );
}
