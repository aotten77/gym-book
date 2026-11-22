import { SectionCard } from '@/components/SectionCard';
import { describeGuidedStepDuration } from '@/domain/guided-steps';
import type { GuidedStep } from '@/domain/models';

/**
 * Die Schritte einer geführten Vorlage auf der Detailseite - nur lesend.
 *
 * Es gibt genau eine Quelle für die Liste, den Import, und deshalb hier nichts
 * zu bearbeiten, hinzuzufügen oder umzusortieren. Name, Dauer (bei einem
 * beidseitigen Schritt je Seite) und „L · R“ wie auf dem Start-Screen.
 */
export function GuidedStepsCard({ steps }: { steps: readonly GuidedStep[] }) {
  return (
    <SectionCard
      title="Schritte"
      subtitle="Geführte Vorlage: die Schritte kommen aus dem Import und lassen sich hier nicht ändern."
    >
      <ol aria-label="Schritte" className="divide-y divide-line rounded-control bg-surface-sunken px-3">
        {steps.map((step, index) => (
          <li key={index} className="flex min-h-touch items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0 break-words text-content">
              {step.name}
              {step.bothSides ? <small className="ml-1.5 text-xs text-content-muted">L · R</small> : null}
            </span>
            <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-content-muted">
              {describeGuidedStepDuration(step)}
            </span>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
