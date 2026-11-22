import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { GuidedHintDialog } from '@/components/GuidedHintDialog';
import { GuidedStage } from '@/components/GuidedStage';
import { Button, IconButton } from '@/components/ui/Button';
import { db } from '@/db/appDb';
import { describeGuidedFacts, describeGuidedStepDuration, isGuidedTemplate } from '@/domain/guided-steps';
import { describeWorkoutCategory, resolveWorkoutCategory } from '@/domain/workout-category';
import { cn } from '@/lib/utils';

/** Kleinschrift über einem Block - wie im Ruhemodus, auf Tinte gedämpft. */
const CAPTION_CLASSES = 'text-[10px] font-bold uppercase tracking-[0.16em] text-accent-contrast/60';

/** Umriss auf Tinte; der Ring der App ist Tinte und wäre hier unsichtbar. */
const ON_INK_FOCUS_CLASSES =
  'focus-visible:ring-accent-contrast focus-visible:ring-offset-accent';

/**
 * Der Start-Screen einer geführten Vorlage: links die Schritte, rechts die
 * Kennzahlen und der Start.
 *
 * Er liest nur - `GuidedStage` stellt ihn dunkel und ins Querformat, und die
 * Schritte kommen von der Vorlage, nicht aus einer Session. Gestartet wird hier
 * noch nicht: der Knopf wartet auf den Ablauf. Die Kennzahlen stehen in einer
 * Zeile, die sich seitlich scrollen lässt, statt umzubrechen - im Querformat
 * bleibt der Screen so ruhig, auch mit langem Namen und vielen Zahlen.
 *
 * Lime gibt es hier nicht: nichts ist „jetzt dran“, solange nichts läuft.
 */
export function GuidedStartPage() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [hintStepIndex, setHintStepIndex] = useState<number | null>(null);

  // `null` heißt „gibt es nicht“, `undefined` „noch nicht geladen“.
  const template = useLiveQuery(
    async () => (templateId ? ((await db.workoutTemplates.get(templateId)) ?? null) : null),
    [templateId],
  );

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
      className={cn(
        'rounded-full border-accent-contrast/25 text-accent-contrast/80 hover:bg-accent-contrast/10',
        ON_INK_FOCUS_CLASSES,
      )}
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
          className="min-h-0 overflow-y-auto rounded-panel bg-accent-contrast/10 px-3 py-0.5"
        >
          {steps.map((step, index) => (
            <li
              key={index}
              data-guided-step={index}
              className="flex min-h-[2.5rem] items-center justify-between gap-3 border-b border-accent-contrast/10 py-1.5 text-[13px] last:border-b-0"
            >
              <span className="min-w-0 break-words">
                {step.name}
                {step.bothSides ? (
                  <small className="ml-1 text-[11px] text-accent-contrast/60">L · R</small>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="whitespace-nowrap text-xs tabular-nums text-accent-contrast/60">
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
                      'focus-visible:outline-none focus-visible:ring-2',
                      ON_INK_FOCUS_CLASSES,
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="grid h-7 w-7 place-items-center rounded-full bg-accent-contrast/15 font-serif text-base font-bold italic leading-none"
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
                className="flex-none whitespace-nowrap rounded-full bg-accent-contrast/10 px-[9px] py-[5px] text-[11.5px] font-semibold text-accent-contrast/85"
              >
                {fact}
              </li>
            ))}
          </ul>

          <div className="min-h-2 flex-1" />

          {/* Wartet auf den Ablauf: ohne ihn gibt es nichts zu starten. */}
          <Button
            variant="primary"
            disabled
            className={cn('rounded-full bg-accent-contrast text-accent', ON_INK_FOCUS_CLASSES)}
          >
            Einheit starten
          </Button>
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
