import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { ActiveSessionHint } from '@/components/ActiveSessionHint';
import { GuidedHintDialog } from '@/components/GuidedHintDialog';
import { GuidedStage } from '@/components/GuidedStage';
import { Button, IconButton } from '@/components/ui/Button';
import { db } from '@/db/appDb';
import { startGuidedSession } from '@/db/guided-session-actions';
import { describeGuidedFacts, describeGuidedStepDuration, isGuidedTemplate } from '@/domain/guided-steps';
import { describeWorkoutCategory, resolveWorkoutCategory } from '@/domain/workout-category';
import { primeTimerSound, setAmbientAudioSession } from '@/lib/sound';
import { readGuidedStartState } from '@/lib/session-navigation';
import { cn } from '@/lib/utils';

/** Kleinschrift über einem Block. */
const CAPTION_CLASSES = 'text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted';

/**
 * Der Start-Screen einer geführten Vorlage: links die Schritte, rechts die
 * Kennzahlen und der Start.
 *
 * Er liest nur - `GuidedStage` stellt ihn hell auf Papier und ins Querformat, und die
 * Schritte kommen von der Vorlage, nicht aus einer Session. Der Knopf startet
 * die Einheit (`startGuidedSession`) und führt auf den Ablauf-Screen; läuft
 * schon eine andere Session, steht dort der Weg zurück zu ihr. Die Kennzahlen stehen in einer
 * Zeile, die sich seitlich scrollen lässt, statt umzubrechen - im Querformat
 * bleibt der Screen so ruhig, auch mit langem Namen und vielen Zahlen.
 *
 * Lime gibt es hier nicht: nichts ist „jetzt dran“, solange nichts läuft. Hell
 * ist nur dieser Screen - dunkel werden erst die Screens des laufenden Ablaufs.
 */
export function GuidedStartPage() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [hintStepIndex, setHintStepIndex] = useState<number | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // `null` heißt „gibt es nicht“, `undefined` „noch nicht geladen“.
  const template = useLiveQuery(
    async () => (templateId ? ((await db.workoutTemplates.get(templateId)) ?? null) : null),
    [templateId],
  );

  // Läuft schon eine Einheit, startet keine zweite - wie beim Kraft-Start.
  const activeSession = useLiveQuery(
    async () => (await db.workoutSessions.where('status').equals('active').first()) ?? null,
    [],
  );

  async function handleStart() {
    if (!template || isStarting) {
      return;
    }

    /*
     * Zuerst, noch in der Geste und vor jedem `await`: Safari gibt den Ton nur
     * innerhalb einer Berührung frei, und das erste Signal kommt Sekunden
     * später ohne eine.
     */
    primeTimerSound();
    setAmbientAudioSession();
    setIsStarting(true);
    setStartError(null);

    try {
      const sessionId = await startGuidedSession(template.id, readGuidedStartState(location.state));

      // Ersetzen, nicht anhängen: „Zurück“ vom Ablauf soll nicht auf diesen Start-Screen führen.
      navigate(`/guided/run/${sessionId}`, { replace: true });
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : 'Die Einheit konnte nicht gestartet werden.',
      );
      setIsStarting(false);
    }
  }

  // Ohne Verlauf (Kaltstart auf diesem Screen) führte `navigate(-1)` aus der App heraus.
  function handleClose() {
    if (location.key === 'default') {
      navigate('/');
      return;
    }

    navigate(-1);
  }

  const closeButton = (
    <IconButton
      label="Start-Screen schließen"
      className="rounded-full border-transparent bg-surface-raised text-content-secondary hover:bg-surface-hover"
      onClick={handleClose}
    >
      <X size={16} aria-hidden="true" />
    </IconButton>
  );

  if (template === undefined) {
    return <GuidedStage label="Geführte Einheit" screen="loading">{null}</GuidedStage>;
  }

  if (!template || !isGuidedTemplate(template)) {
    return (
      <GuidedStage label="Geführte Einheit" screen="missing">
        <div className="flex flex-1 items-center justify-between gap-4">
          <p className="text-lg">
            {template
              ? `${template.name} ist keine geführte Vorlage.`
              : 'Diese Vorlage gibt es nicht mehr.'}
          </p>
          {closeButton}
        </div>
      </GuidedStage>
    );
  }

  const steps = template.steps ?? [];
  const category = resolveWorkoutCategory(template.category);
  const hintStep = hintStepIndex === null ? undefined : steps[hintStepIndex];

  return (
    <GuidedStage label={template.name} screen="start">
      <div
        data-guided-template={template.id}
        className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_14.75rem] gap-4"
      >
        <ol
          aria-label="Schritte"
          data-guided-steps
          className="min-h-0 overflow-y-auto rounded-panel bg-surface-sunken px-3 py-0.5"
        >
          {steps.map((step, index) => (
            <li
              key={index}
              data-guided-step={index}
              className="flex min-h-[2.5rem] items-center justify-between gap-3 border-b border-line py-1.5 text-[13px] last:border-b-0"
            >
              <span className="min-w-0 break-words">
                {step.name}
                {step.bothSides ? (
                  <small className="ml-1 text-[11px] text-content-muted">L · R</small>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="whitespace-nowrap text-xs tabular-nums text-content-muted">
                  {describeGuidedStepDuration(step)}
                </span>
                {step.hint ? (
                  /*
                    Das „i“ ist 44px groß, damit man es trifft, und zieht sich
                    mit negativem Rand zusammen, damit die Zeile nicht wächst.
                  */
                  <button
                    type="button"
                    aria-label={`Hinweis: ${step.name}`}
                    onClick={() => setHintStepIndex(index)}
                    className={cn(
                      '-my-2 -mr-2.5 grid h-11 w-11 place-items-center rounded-full',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="grid h-7 w-7 place-items-center rounded-full bg-surface-raised font-serif text-base font-bold italic leading-none"
                    >
                      i
                    </span>
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ol>

        <div className="flex min-h-0 flex-col">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={CAPTION_CLASSES}>
                {category === 'strength' ? 'Geführt' : `Geführt · ${describeWorkoutCategory(category)}`}
              </p>
              <h1 className="mt-[3px] break-words font-display text-[23px] font-extrabold leading-[1.06] tracking-[-0.04em]">
                {template.name}
              </h1>
            </div>
            {closeButton}
          </div>

          {/* Eine Zeile, seitlich scrollbar: Umbruch machte den Screen unruhig. */}
          <ul
            aria-label="Kennzahlen"
            data-guided-facts
            className="mt-2 flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {describeGuidedFacts(steps).map((fact) => (
              <li
                key={fact}
                className="flex-none whitespace-nowrap rounded-full bg-surface-sunken px-[9px] py-[5px] text-[11.5px] font-semibold text-content-secondary"
              >
                {fact}
              </li>
            ))}
          </ul>

          <div className="min-h-2 flex-1" />

          {startError ? (
            <p role="alert" data-guided-error className="mb-2 text-xs text-danger">
              {startError}
            </p>
          ) : null}

          {activeSession ? (
            <>
              <div data-guided-running className="mb-2 text-xs">
                <ActiveSessionHint />
              </div>
              {/* Zurück in die laufende Einheit: die Session-Route kennt beide Arten. */}
              <Button
                variant="primary"
                className="rounded-full"
                onClick={() => navigate(`/session/${activeSession.id}`)}
              >
                Zur laufenden Einheit
              </Button>
            </>
          ) : (
            /* Tinte, nicht Lime: ein Start ist eine Handlung, nichts ist „jetzt dran“. */
            <Button
              variant="primary"
              className="rounded-full"
              disabled={isStarting || activeSession === undefined}
              onClick={() => void handleStart()}
            >
              Einheit starten
            </Button>
          )}
        </div>
      </div>

      {hintStep?.hint ? (
        <GuidedHintDialog
          title={hintStep.name}
          hint={hintStep.hint}
          onClose={() => setHintStepIndex(null)}
        />
      ) : null}
    </GuidedStage>
  );
}
