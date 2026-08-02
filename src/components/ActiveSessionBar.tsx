import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronUp, Clock3, Timer } from 'lucide-react';
import { db } from '@/db/appDb';
import type { WorkoutSession } from '@/domain/models';
import { remainingRestSeconds, selectPrimaryRestTrack } from '@/domain/rest-timer';
import { remainingSetTimerSeconds } from '@/domain/set-timer';
import { summarizeSessionProgress } from '@/domain/session-summary';
import { formatTimer } from '@/lib/format';

interface ActiveSessionBarProps {
  session: WorkoutSession;
}

/**
 * Der Streifen, der eine laufende Einheit außerhalb der Session sichtbar hält.
 *
 * Er ist die Gegenseite des Minimieren-Knopfes im Kopf: aus der Session
 * herauszugehen darf nichts kosten, aber nur, wenn sie danach nicht
 * verschwindet. Zuvor lag der Rückweg in einer Karte auf der Startseite - wer
 * von der Übungsliste aus zurückwollte, musste erst dorthin.
 *
 * Angezeigt wird immer die Zahl, auf die gerade gewartet wird: läuft ein
 * Satz-Timer, ist es dessen Restzeit, sonst die nächste ablaufende Pause,
 * sonst die Dauer der Einheit. Dieselbe Rangfolge wie in der Leiste der
 * Session - stünde hier eine andere, hieße derselbe Zustand an zwei Orten
 * etwas anderes.
 */
export function ActiveSessionBar({ session }: ActiveSessionBarProps) {
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());

  const setLogs = useLiveQuery(async () => {
    const exercises = await db.workoutSessionExercises
      .where('sessionId')
      .equals(session.id)
      .toArray();

    if (exercises.length === 0) {
      return [];
    }

    return db.workoutSetLogs
      .where('sessionExerciseId')
      .anyOf(exercises.map((item) => item.id))
      .toArray();
  }, [session.id]);

  useEffect(() => {
    // Anders als in der Session tickt es hier immer: die Dauer der Einheit
    // läuft auch dann weiter, wenn gerade keine Pause und kein Satz-Timer
    // steht. Der Takt kostet nur diesen Streifen - die Seite darunter hängt
    // nicht an `now`.
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    // Im Hintergrund tickt kein Intervall; ohne das hier stünde nach dem
    // Zurückwechseln bis zur nächsten Sekunde eine alte Zahl.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const progress = summarizeSessionProgress(setLogs ?? []);
  const elapsedSeconds = Math.max(
    0,
    Math.round((now - Date.parse(session.startedAt)) / 1000),
  );
  const setTimerRemainingSeconds = remainingSetTimerSeconds(session.setTimer, now);
  /*
   * Ohne fokussierte Übung entscheidet allein der nächste Ablauf - welche
   * Übung außerhalb der Session den Fokus hat, ist keine Frage, die sich hier
   * beantworten ließe.
   */
  const primaryRestTrack = selectPrimaryRestTrack(session.restTimers, undefined, undefined, now);
  const restRemainingSeconds = remainingRestSeconds(primaryRestTrack, now);

  const timerLabel =
    setTimerRemainingSeconds > 0
      ? 'Satz'
      : restRemainingSeconds > 0
        ? 'Pause'
        : 'Dauer';
  const timerSeconds =
    setTimerRemainingSeconds > 0
      ? setTimerRemainingSeconds
      : restRemainingSeconds > 0
        ? restRemainingSeconds
        : elapsedSeconds;
  const TimerIcon = setTimerRemainingSeconds > 0 ? Timer : Clock3;

  return (
    <button
      type="button"
      onClick={() => navigate(`/session/${session.id}`)}
      /*
       * Die ganze Fläche ist der Knopf, nicht ein "Fortsetzen" am Rand: der
       * Streifen ist schmal, und ein Ziel über die volle Breite trifft auch
       * eine nasse Hand im Vorbeigehen.
       */
      className="flex w-full items-center gap-3 border-b border-highlight-border bg-highlight px-4 py-2.5 text-left text-highlight-contrast transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] opacity-70">
          Training läuft
        </p>
        <p className="truncate text-sm font-semibold">{session.templateNameSnapshot}</p>
      </div>
      {/*
        Genau ein `role="timer"` im Dokument: die Leiste der Session steht nur
        dort, wo dieser Streifen nicht steht, und umgekehrt. Mehrere Live-
        Regionen im Sekundentakt machen den Screenreader unbenutzbar - deshalb
        auch hier `aria-live="off"`, die Zahl wird gelesen, wenn man sie sucht.
      */}
      <div
        role="timer"
        aria-live="off"
        aria-label={`${timerLabel} ${formatTimer(timerSeconds)}`}
        className="flex shrink-0 items-center gap-1.5 font-display text-lg font-extrabold tabular-nums leading-none"
      >
        <TimerIcon size={15} aria-hidden />
        {formatTimer(timerSeconds)}
      </div>
      {/*
        Gezählt werden Satzzeilen, wie überall sonst - "0/13" ist dieselbe
        Zahl wie im Kopf der Session. Kurz genug, dass sie auch auf 320px
        neben die Uhr passt; für den Screenreader steht sie ausgeschrieben.
      */}
      <span className="shrink-0 text-xs font-semibold tabular-nums opacity-70">
        <span aria-hidden>
          {progress.completedCount}/{progress.totalCount}
        </span>
        <span className="sr-only">
          {progress.completedCount} von {progress.totalCount} Sätzen
        </span>
      </span>
      <ChevronUp size={18} className="shrink-0 opacity-70" aria-hidden />
    </button>
  );
}
