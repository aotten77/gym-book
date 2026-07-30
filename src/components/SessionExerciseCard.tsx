import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronUp, ImageOff, SkipForward, X } from 'lucide-react';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { SectionCard } from '@/components/SectionCard';
import { Button, IconButton } from '@/components/ui/Button';
import { toggleSetCompletion, updateSetLogValues, type SetLogValuesInput } from '@/db/session-actions';
import type { LastSetValues, SetValues } from '@/domain/history';
import type { MediaAsset, TrackingMode, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { supportsReps, supportsSeconds, supportsWeight } from '@/domain/tracking';
import { formatSideLabel } from '@/lib/format';
import { parseNumberInput, toInputValue } from '@/lib/number-input';
import { cn } from '@/lib/utils';

/** Pause zwischen Tastendruck und Autosave - siehe SetLogEditor. */
const AUTOSAVE_DELAY_MS = 600;

interface SetLogDraft {
  reps: string;
  seconds: string;
  weight: string;
}

function createSetLogDraft(log: WorkoutSetLog): SetLogDraft {
  return {
    reps: toInputValue(log.reps),
    seconds: toInputValue(log.seconds),
    weight: toInputValue(log.weight),
  };
}

const SET_LOG_FIELDS = [
  { key: 'reps', supported: supportsReps },
  { key: 'seconds', supported: supportsSeconds },
  { key: 'weight', supported: supportsWeight },
] as const;

const SET_LOG_FIELD_LABELS = {
  reps: 'Wdh',
  seconds: 'Sekunden',
  weight: 'Gewicht in kg',
} as const;

/**
 * Sammelt die Felder, die tatsächlich geschrieben werden sollen.
 *
 * Ungültige Eingaben werden ausgelassen statt als `undefined` gesendet -
 * sonst würde eine Fehleingabe den gespeicherten Wert löschen. Ein bewusst
 * geleertes Feld wird dagegen als `undefined` übernommen.
 */
function collectSetLogChanges(draft: SetLogDraft, log: WorkoutSetLog, trackingMode: TrackingMode) {
  const changes: SetLogValuesInput = {};
  let hasChange = false;

  for (const { key, supported } of SET_LOG_FIELDS) {
    if (!supported(trackingMode)) {
      continue;
    }

    const parsed = parseNumberInput(draft[key]);

    if (parsed.status === 'invalid') {
      continue;
    }

    const nextValue = parsed.status === 'valid' ? parsed.value : undefined;

    if (nextValue !== log[key]) {
      changes[key] = nextValue;
      hasChange = true;
    }
  }

  return hasChange ? changes : null;
}

function findInvalidSetLogFields(draft: SetLogDraft, trackingMode: TrackingMode) {
  return SET_LOG_FIELDS.filter(
    ({ key, supported }) => supported(trackingMode) && parseNumberInput(draft[key]).status === 'invalid',
  ).map(({ key }) => key);
}

/**
 * Übernimmt die Werte der letzten Woche in leer gelassene Felder.
 *
 * Der häufigste Fall im Training ist "genau wie letzte Woche". Dafür soll ein
 * Tap auf Fertig genügen, ohne dieselben Zahlen erneut zu tippen - der
 * Platzhalter wird damit zum echten, gespeicherten Wert.
 */
function adoptPlaceholders(draft: SetLogDraft, lastValues: SetValues, trackingMode: TrackingMode) {
  let next = draft;

  for (const { key, supported } of SET_LOG_FIELDS) {
    if (!supported(trackingMode) || draft[key].trim()) {
      continue;
    }

    const placeholder = toInputValue(lastValues[key]);

    if (!placeholder) {
      continue;
    }

    next = { ...next, [key]: placeholder };
  }

  return next;
}

interface SetLogEditorProps {
  log: WorkoutSetLog;
  trackingMode: TrackingMode;
  /** Werte derselben Satzzeile aus der letzten abgeschlossenen Ausführung. */
  lastValues?: SetValues;
  onCompleted: () => void;
  onRequestDelete: (log: WorkoutSetLog) => void;
  disabled?: boolean;
}

function SetLogEditor({
  log,
  trackingMode,
  lastValues,
  onCompleted,
  onRequestDelete,
  disabled,
}: SetLogEditorProps) {
  const [draft, setDraft] = useState<SetLogDraft>(() => createSetLogDraft(log));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const syncedRef = useRef<SetLogDraft>(createSetLogDraft(log));

  /*
   * Übernimmt Änderungen aus der Datenbank, ohne gerade Getipptes zu
   * zerstören.
   *
   * Ein naives `setDraft(createSetLogDraft(log))` wäre fatal: speichert das
   * Autosave ein Feld, feuert die Live-Query, und der Effekt würde die
   * Eingabe im Nachbarfeld überschreiben, während der Nutzer noch tippt.
   * Deshalb wird ein Feld nur übernommen, wenn es seit dem letzten Abgleich
   * unverändert ist.
   */
  useEffect(() => {
    const incoming = createSetLogDraft(log);

    setDraft((current) => ({
      reps: current.reps === syncedRef.current.reps ? incoming.reps : current.reps,
      seconds: current.seconds === syncedRef.current.seconds ? incoming.seconds : current.seconds,
      weight: current.weight === syncedRef.current.weight ? incoming.weight : current.weight,
    }));

    syncedRef.current = incoming;
    // Bewusst an den Primitiven statt am `log`-Objekt: useLiveQuery liefert bei
    // jedem Emit eine neue Objektidentität, der Effekt würde sonst ständig
    // laufen und den Draft ausbremsen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.completed, log.id, log.reps, log.seconds, log.weight]);

  const invalidFields = findInvalidSetLogFields(draft, trackingMode);
  const hasInvalidInput = invalidFields.length > 0;
  const pendingChanges = disabled ? null : collectSetLogChanges(draft, log, trackingMode);
  const dirty = pendingChanges !== null;

  const persist = useCallback(
    async (nextDraft?: SetLogDraft) => {
      const changes = collectSetLogChanges(nextDraft ?? draft, log, trackingMode);

      if (!changes || disabled) {
        return;
      }

      setIsSaving(true);

      try {
        await updateSetLogValues(log.id, changes);
        setSaveError(null);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Werte konnten nicht gespeichert werden.');
      } finally {
        setIsSaving(false);
      }
    },
    [disabled, draft, log, trackingMode],
  );

  // Autosave: getippte Werte müssen einen Reload mitten im Training überleben.
  useEffect(() => {
    if (!dirty || hasInvalidInput || disabled) {
      return undefined;
    }

    const handle = window.setTimeout(() => {
      void persist();
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(handle);
  }, [dirty, hasInvalidInput, disabled, persist]);

  async function handleToggleCompletion() {
    if (disabled || hasInvalidInput) {
      return;
    }

    const willComplete = !log.completed;
    /*
     * Beim Abhaken zählt der Platzhalter als Eingabe: wer dasselbe geschafft
     * hat wie letzte Woche, tippt nichts und tappt nur auf Fertig. Beim
     * Zurücknehmen bleibt der Draft unangetastet.
     */
    const effectiveDraft =
      willComplete && lastValues ? adoptPlaceholders(draft, lastValues, trackingMode) : draft;

    if (effectiveDraft !== draft) {
      setDraft(effectiveDraft);
    }

    await persist(effectiveDraft);
    await toggleSetCompletion(log.id);

    if (willComplete) {
      onCompleted();
    }
  }

  const setLabel = `${log.setKind === 'warmup' ? 'Warmup' : `Satz ${log.setNumber}`}${
    log.side !== 'both' ? ` ${formatSideLabel(log.side)}` : ''
  }`;
  const fieldCount = Number(supportsReps(trackingMode)) + Number(supportsSeconds(trackingMode)) + Number(supportsWeight(trackingMode));

  return (
    /*
     * Zeile statt Karte: die Sätze lagen zuvor als eigene Boxen in der
     * Übungskarte, deren Eingabefelder wiederum eigene Rahmen trugen - drei
     * Rahmenebenen übereinander. Die Trennung übernimmt jetzt die Linie des
     * Containers, der erledigte Zustand die Fläche.
     */
    <div className={cn('px-4 py-4 transition', log.completed && 'bg-accent-soft', disabled && 'opacity-80')}>
      <div className="flex items-center justify-between gap-3">
        {/*
          Nur die Satzbezeichnung, ohne Wiederholung der Werte: hier stand
          zuvor "4 Wdh · 82,5 kg" - exakt das, was eine Zeile tiefer schon in
          den Feldern steht. Kein `truncate`: "Satz 1 · rechts" passt auf
          320px nicht neben beide Buttons, und "SATZ 1 · RECH..." benennt den
          Satz nicht mehr eindeutig.
        */}
        <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-content-muted">
          {log.setKind === 'warmup' ? 'Warmup' : `Satz ${log.setNumber}`}
          {log.side !== 'both' ? ` · ${formatSideLabel(log.side)}` : ''}
        </p>
        <div className="flex items-center gap-2">
          {!disabled ? (
            <IconButton
              label={`${setLabel} entfernen`}
              variant="danger"
              onClick={() => onRequestDelete(log)}
            >
              <X size={16} />
            </IconButton>
          ) : null}
          {/*
            Häkchen in beiden Zuständen, quadratisch: der Wechsel von "Fertig"
            zum Icon änderte vorher die Buttonbreite und ließ die Zeile beim
            Abhaken springen. Der gewonnene Platz geht an das Satzlabel, das
            auf 320px sonst abschnitt. Den Namen trägt das `aria-label`.
          */}
          <button
            type="button"
            onClick={handleToggleCompletion}
            disabled={disabled || hasInvalidInput}
            aria-label={log.completed ? 'Satz als offen markieren' : 'Satz als erledigt markieren'}
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-control border transition',
              log.completed
                ? 'border-accent bg-accent text-accent-contrast'
                : 'border-line-strong text-content-muted hover:bg-surface-hover hover:text-content',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <Check size={22} strokeWidth={log.completed ? 3 : 2} />
          </button>
        </div>
      </div>

      <div className={cn('mt-3 grid gap-2', fieldCount === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
        {SET_LOG_FIELDS.filter(({ supported }) => supported(trackingMode)).map(({ key }) => {
          const isInvalid = invalidFields.includes(key);
          const fieldId = `${log.id}-${key}`;
          // Zeigt, was beim letzten Mal in genau diesem Satz stand.
          const placeholder = toInputValue(lastValues?.[key]);

          return (
            <div key={key}>
              <label
                htmlFor={fieldId}
                className="mb-1 block text-[11px] font-medium uppercase tracking-[0.12em] text-content-muted"
              >
                {SET_LOG_FIELD_LABELS[key]}
              </label>
              {/*
                Der eingetragene Wert ist das, was im Training aus einem Meter
                Entfernung lesbar sein muss - deshalb trägt er das Gewicht der
                Zeile, nicht seine Beschriftung. Der Rahmen entfällt; die
                versenkte Fläche grenzt das Feld ab. `ring-inset` markiert
                Fehler ohne Sprung im Layout.
              */}
              <input
                id={fieldId}
                value={draft[key]}
                onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                onBlur={() => {
                  if (!hasInvalidInput) {
                    void persist();
                  }
                }}
                inputMode={key === 'reps' ? 'numeric' : 'decimal'}
                placeholder={placeholder}
                aria-invalid={isInvalid}
                disabled={disabled}
                className={cn(
                  'w-full rounded-panel bg-surface-sunken px-4 py-2.5 text-2xl font-semibold tabular-nums text-content',
                  'outline-none transition placeholder:font-normal placeholder:text-content-muted',
                  'focus-visible:ring-2 focus-visible:ring-accent',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                  isInvalid && 'ring-2 ring-inset ring-danger-border',
                )}
              />
            </div>
          );
        })}
      </div>

      {hasInvalidInput ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          Bitte eine Zahl eintragen (Komma erlaubt, z. B. 52,5). Bisherige Werte bleiben gespeichert.
        </p>
      ) : null}

      {saveError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {saveError}
        </p>
      ) : null}

      {isSaving ? <p className="mt-3 text-xs text-content-muted">Wird gespeichert...</p> : null}
    </div>
  );
}

function formatSessionExerciseSubtitle(exercise: WorkoutSessionExercise) {
  if (exercise.wasSkipped) {
    return 'Aktuell übersprungen';
  }

  if (exercise.addedInSession) {
    return 'Während der Session hinzugefügt';
  }

  return 'Teil der laufenden Session';
}

/** Ziel-Vorgabe der Übung als eine Zeile: "Ziel: 5 Wdh · 82,5 kg · Pause 90s". */
function ExerciseTargetLine({ exercise }: { exercise: WorkoutSessionExercise }) {
  return (
    <p className="text-sm text-content-secondary">
      Ziel: {exercise.targetReps ? `${exercise.targetReps} Wdh` : null}
      {exercise.targetReps && exercise.targetSeconds ? ' · ' : null}
      {exercise.targetSeconds ? `${exercise.targetSeconds}s` : null}
      {exercise.targetWeight ? ` · ${exercise.targetWeight} kg` : ''}
      {exercise.restSeconds ? ` · Pause ${exercise.restSeconds}s` : ''}
    </p>
  );
}

/** Werte derselben Übung aus der letzten abgeschlossenen Ausführung. */
export interface LastValuesSummary {
  text: string;
  completedAt: string;
  templateName?: string;
}

interface SessionExerciseCardProps {
  exercise: WorkoutSessionExercise;
  exerciseLogs: WorkoutSetLog[];
  mediaAsset?: MediaAsset;
  lastSetValues?: LastSetValues;
  /** Nur für die fokussierte Karte gefüllt - sonst steht der Block auf jeder Karte. */
  lastValuesSummary?: LastValuesSummary;
  isFocused: boolean;
  isBusy: boolean;
  isReadOnly: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (sessionExerciseId: string, direction: -1 | 1) => void;
  onFocus: (sessionExerciseId: string) => void;
  onToggleSkip: (sessionExerciseId: string) => void;
  onSetCompleted: (sessionExerciseId: string, completedSetLogId: string, restSeconds?: number) => void;
  onRequestDeleteSetLog: (log: WorkoutSetLog, exerciseName: string) => void;
  onOpenMedia: (mediaAsset: MediaAsset, alt: string) => void;
}

export function SessionExerciseCard({
  exercise,
  exerciseLogs,
  mediaAsset,
  lastSetValues,
  lastValuesSummary,
  isFocused,
  isBusy,
  isReadOnly,
  isFirst,
  isLast,
  onMove,
  onFocus,
  onToggleSkip,
  onSetCompleted,
  onRequestDeleteSetLog,
  onOpenMedia,
}: SessionExerciseCardProps) {
  return (
    <SectionCard
      title={exercise.exerciseNameSnapshot}
      subtitle={formatSessionExerciseSubtitle(exercise)}
      className={cn(
        'transition',
        /*
         * Genau eine Karte steht im Vordergrund - der Contract verlangt, dass
         * die laufende Übung sichtbar dominiert. Der Balken links trägt das
         * am deutlichsten, weil er auch dann noch zu sehen ist, wenn nur die
         * Kartenkante ins Bild ragt.
         *
         * Die inaktiven Karten werden über die Fläche zurückgenommen, nicht
         * über `opacity`: eine gedämpfte Deckkraft senkt den tatsächlichen
         * Textkontrast, ohne dass `getComputedStyle().color` sich ändert -
         * der Kontrast-Check in den e2e-Tests würde den Verstoß nicht sehen.
         */
        isFocused
          ? 'border-l-4 border-l-accent border-accent-border bg-accent-soft'
          : 'bg-surface hover:border-accent-border hover:bg-surface-raised',
      )}
      action={
        <div className="flex items-center gap-2">
          {/*
            Pfeile statt Drag: die alte Geste sprang schon bei acht Pixeln an
            und sortierte beim Scrollen versehentlich um.
          */}
          <IconButton
            label={`${exercise.exerciseNameSnapshot} nach oben`}
            disabled={isBusy || isReadOnly || isFirst}
            onClick={() => onMove(exercise.id, -1)}
          >
            <ChevronUp size={16} />
          </IconButton>
          <IconButton
            label={`${exercise.exerciseNameSnapshot} nach unten`}
            disabled={isBusy || isReadOnly || isLast}
            onClick={() => onMove(exercise.id, 1)}
          >
            <ChevronDown size={16} />
          </IconButton>
          {/* Auf der aktiven Karte wäre "Fokus" ein Button ohne Wirkung. */}
          {isFocused ? (
            <span className="inline-flex min-h-touch items-center rounded-control bg-accent px-3 text-xs font-semibold uppercase tracking-[0.1em] text-accent-contrast">
              Aktiv
            </span>
          ) : (
            <Button variant="ghost" size="md" onClick={() => onFocus(exercise.id)}>
              Fokus
            </Button>
          )}
        </div>
      }
    >
      {/*
        Bild, letzte Werte und Ziel nur auf der aktiven Karte: auf jeder Karte
        standen sie zuvor drei Bildschirmhöhen lang untereinander, ohne dass
        eine davon hervorstach.
      */}
      {!isFocused ? null : mediaAsset ? (
        <button
          type="button"
          onClick={() => onOpenMedia(mediaAsset, exercise.exerciseNameSnapshot)}
          aria-label={`Bild von ${exercise.exerciseNameSnapshot} vergrößern`}
          className="mb-4 block w-full rounded-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ExerciseMedia
            mediaAsset={mediaAsset}
            alt={exercise.exerciseNameSnapshot}
            className="h-40 w-full"
            imageClassName="h-full w-full"
          />
        </button>
      ) : (
        <div className="mb-4 rounded-panel border border-dashed border-line bg-surface px-4 py-2">
          <div className="flex items-center gap-3 text-sm text-content-muted">
            <ImageOff size={16} className="shrink-0" />
            <span>Kein Bild hinterlegt.</span>
          </div>
          {/*
            Eigene Zeile statt Link mitten im Satz: als Inline-Link maß die
            Trefferfläche 36px und lag damit unter den 44px, die überall sonst
            gelten.
          */}
          <Link
            to="/exercises"
            className="inline-flex min-h-touch items-center text-sm text-accent underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            In der Bibliothek ergänzen
          </Link>
        </div>
      )}

      {isFocused ? (
        <div className="mb-4 rounded-panel bg-surface-sunken p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-content-muted">
            Letzte Werte
          </p>
          {lastValuesSummary ? (
            <>
              <p className="mt-2 text-sm text-content-secondary">{lastValuesSummary.text}</p>
              <p className="mt-1 text-xs text-content-muted">
                {lastValuesSummary.completedAt}
                {lastValuesSummary.templateName ? ` · ${lastValuesSummary.templateName}` : ''}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-content-secondary">Noch kein Verlauf vorhanden</p>
          )}
          <div className="mt-3">
            <ExerciseTargetLine exercise={exercise} />
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="md" onClick={() => onToggleSkip(exercise.id)} disabled={isReadOnly}>
          <SkipForward size={14} />
          {exercise.wasSkipped ? 'Zurückholen' : 'Skip'}
        </Button>
      </div>

      {/*
        `divide-y` trägt die Trennung zwischen den Sätzen - zusammen mit dem
        negativen Margin in SetLogEditor läuft die Linie über die volle
        Kartenbreite, ohne dass jede Zeile einen eigenen Rahmen braucht.
      */}
      <div className="-mx-4 -mb-4 divide-y divide-line border-t border-line">
        {exerciseLogs.map((log) => (
          <SetLogEditor
            key={log.id}
            log={log}
            trackingMode={exercise.trackingMode}
            lastValues={lastSetValues?.resolve(log)}
            onCompleted={() => onSetCompleted(exercise.id, log.id, exercise.restSeconds)}
            onRequestDelete={(item) => onRequestDeleteSetLog(item, exercise.exerciseNameSnapshot)}
            disabled={isReadOnly}
          />
        ))}
      </div>
    </SectionCard>
  );
}
