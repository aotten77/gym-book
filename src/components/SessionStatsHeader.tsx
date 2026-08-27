import { useMemo } from 'react';
import type { WorkoutSession, WorkoutSessionExercise } from '@/domain/models';
import { estimateRemainingSessionSeconds, estimatedEndAt } from '@/domain/session-estimate';
import type { SessionProgress, SetLogsByExercise } from '@/domain/session-summary';
import type { SupersetBlock } from '@/domain/superset';
import { useNowTicker } from '@/hooks/useNowTicker';
import {
  describeRemainingEstimate,
  formatClockTime,
  formatRemainingEstimate,
  formatTimer,
} from '@/lib/format';

interface SessionStatsHeaderProps {
  session: WorkoutSession;
  /** Trägt den Balken unter den Zahlen - der Zählstand selbst steht im Sheet. */
  progress: SessionProgress;
  blocks: SupersetBlock<WorkoutSessionExercise>[];
  logsByExercise: SetLogsByExercise;
}

/**
 * Der Überblick über die laufende Einheit: Dauer, geschätzter Rest, Feierabend.
 *
 * Die Zahlen standen früher in der Karte der aktiven Übung. Die trug damit
 * zwei Dinge zugleich, wurde tiefer und nahm dem Überblick den Platz. Die
 * aktive Übung erkennt man jetzt an ihrer limettenen Blockkarte; hier steht,
 * wie weit das Training insgesamt ist.
 *
 * Der Satzzähler stand hier einmal als zweite Spalte und ist der Uhrzeit
 * gewichen: er steht im Kopf des Sheets ("Satz 5 von 18"), also genau dort, wo
 * man ihn abliest, jede Blockkarte trägt ihren eigenen Stand, und den Anteil
 * zeigt der Balken darunter ohnehin. Die End-Uhrzeit stand dagegen nirgends -
 * und das ist die Zahl, nach der man im Training handelt: nicht "noch 42
 * Minuten", sondern ob man um 19:42 aus der Halle ist.
 *
 * Eigene Komponente wegen des Takts: Dauer und Schätzung laufen sekündlich
 * weiter, die Liste darunter braucht das nicht (siehe unten).
 */
export function SessionStatsHeader({
  session,
  progress,
  blocks,
  logsByExercise,
}: SessionStatsHeaderProps) {
  const isRunning = !session.completedAt;
  /*
   * An, solange die Einheit läuft, und dann an keiner Uhr hängend: Dauer und
   * Restschätzung laufen auch weiter, wenn gerade weder eine Pause noch ein
   * Satz-Timer steht - vorher stand die Dauer in genau diesem Fall still. Er
   * kostet nur diesen Streifen; `now` der Seite ist Prop jeder Blockkarte,
   * dort unbedingt zu ticken hieße, die ganze Liste sekündlich neu zu
   * zeichnen, auch während im Sheet getippt wird.
   */
  const now = useNowTicker(isRunning);

  /*
   * Bei einer abgeschlossenen Session zählt die Zeit bis zum Abschluss, nicht
   * bis jetzt - sonst wüchse die Dauer in der Historie immer weiter.
   */
  const elapsedSeconds = Math.max(
    0,
    Math.round(
      ((session.completedAt ? Date.parse(session.completedAt) : now) -
        Date.parse(session.startedAt)) /
        1000,
    ),
  );

  const estimate = useMemo(
    () => estimateRemainingSessionSeconds({ blocks, logsByExercise, now }),
    [blocks, logsByExercise, now],
  );
  const remaining = formatRemainingEstimate(estimate.remainingSeconds);

  /*
   * Zwei Fälle, eine Spalte. Solange die Einheit läuft, steht dort die
   * Vorhersage; ist sie abgeschlossen, das tatsächliche Ende - keine Schätzung,
   * keine Tilde. Nach dem Abschluss liest der Streifen damit "Dauer | Ende" und
   * nennt zwei Tatsachen, statt mit einer einzigen Zahl dazustehen.
   */
  const endsAt = session.completedAt
    ? Date.parse(session.completedAt)
    : estimatedEndAt(estimate, now);

  return (
    <div className="space-y-2.5 px-1">
      {/*
        Die Kennzahlen tragen ihren Zustand als data-Attribut, wie die
        Blockkarten auch: die e2e-Tests lesen das, statt auf Klassennamen zu
        raten - und die Breite des Streifens prüft einer von ihnen direkt.
      */}
      <div data-session-stats className="flex items-end gap-5">
        <p>
          <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">
            Dauer
          </span>
          <span className="font-display text-[26px] font-extrabold leading-none tabular-nums tracking-tight">
            {formatTimer(elapsedSeconds)}
          </span>
        </p>
        {/*
          Die zweite Zahl ist eine Schätzung, keine Uhr: Planzeit der offenen
          Zeilen, umskaliert auf das Tempo dieser Einheit. Daher die Tilde - "42"
          allein läse sich wie eine Zusage. In der Historie steht sie nicht: dort
          beantwortet eine Restzeit nichts mehr.

          Das `aria-label` ersetzt die Kurzform, weil VoiceOver die Tilde
          vorliest.
        */}
        {session.status === 'active' ? (
          <p
            data-session-estimate={estimate.quality}
            aria-label={
              estimate.openRowCount > 0
                ? `Voraussichtlich noch ${describeRemainingEstimate(estimate.remainingSeconds)}`
                : 'Alle Sätze erledigt'
            }
          >
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">
              Noch
            </span>
            {estimate.openRowCount > 0 ? (
              <span className="font-display text-[26px] font-extrabold leading-none tabular-nums tracking-tight">
                {remaining.value}
                <span className="ml-1.5 text-sm font-semibold text-content-muted">
                  {remaining.unit}
                </span>
              </span>
            ) : (
              <span className="block pb-0.5 text-sm font-semibold text-content-muted">fertig</span>
            )}
          </p>
        ) : null}
        {/*
          Und die Uhrzeit, auf die es hinausläuft. Sie ist die ruhigere der
          beiden Zahlen - warum, steht bei `estimatedEndAt` -, und sie steht
          ohne Einheit da: "19:42" braucht keine.
        */}
        {endsAt !== null ? (
          <p
            data-session-end={session.completedAt ? 'actual' : estimate.quality}
            aria-label={
              session.completedAt
                ? `Beendet um ${formatClockTime(endsAt)} Uhr`
                : `Voraussichtliches Ende gegen ${formatClockTime(endsAt)} Uhr`
            }
          >
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">
              Ende
            </span>
            <span className="font-display text-[26px] font-extrabold leading-none tabular-nums tracking-tight">
              {formatClockTime(endsAt)}
            </span>
          </p>
        ) : null}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
        <div
          className="h-full rounded-full bg-success transition-[width]"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}
