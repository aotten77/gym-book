import { SectionCard } from '@/components/SectionCard';
import { describeGuidedStepDuration } from '@/domain/guided-steps';
import type { GuidedStep } from '@/domain/models';
import type { GuidedStepRestriction } from '@/domain/restriction';
import { cn } from '@/lib/utils';

/**
 * Die Schritte einer geführten Vorlage auf der Detailseite - nur lesend.
 *
 * Es gibt genau eine Quelle für die Liste, den Import, und deshalb hier nichts
 * zu bearbeiten, hinzuzufügen oder umzusortieren. Name, Dauer (bei einem
 * beidseitigen Schritt je Seite) und „L · R“ wie auf dem Start-Screen.
 *
 * `restrictions` sind die Etiketten von heute je Schritt-Position („Pausiert
 * bis 14.12. · Beispiel A“, „30 s statt 45 · …“) - Auskunft, die Vorlage
 * bleibt, wie sie ist. Ein pausierter Schritt steht ausgegraut da.
 */
export function GuidedStepsCard({
  steps,
  restrictions,
}: {
  steps: readonly GuidedStep[];
  restrictions?: Map<number, GuidedStepRestriction>;
}) {
  return (
    <SectionCard
      title="Schritte"
      subtitle="Geführte Vorlage: die Schritte kommen aus dem Import und lassen sich hier nicht ändern."
    >
      <ol aria-label="Schritte" className="divide-y divide-line rounded-control bg-surface-sunken px-3">
        {steps.map((step, index) => {
          const restriction = restrictions?.get(index);

          return (
            <li
              key={index}
              data-guided-step-restriction={restriction?.kind}
              className="flex min-h-touch items-center justify-between gap-3 py-2 text-sm"
            >
              <span
                className={cn(
                  'min-w-0 break-words',
                  restriction?.kind === 'pausiert' ? 'text-content-secondary' : 'text-content',
                )}
              >
                {step.name}
                {step.bothSides ? <small className="ml-1.5 text-xs text-content-muted">L · R</small> : null}
                {restriction ? (
                  <span className="mt-0.5 block text-xs font-semibold text-content-secondary">
                    <span className="block">{restriction.label}</span>
                    {restriction.notes.map((note, noteIndex) => (
                      <span key={noteIndex} className="block font-normal">
                        {note}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-content-muted">
                {describeGuidedStepDuration(step)}
              </span>
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}
