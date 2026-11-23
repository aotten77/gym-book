import type { GuidedStep } from '@/domain/models';
import { guidedSideSeconds, resolveGuidedSections, type GuidedSide } from '@/domain/guided-steps';

/*
 * Der Text der Ansagen einer geführten Vorlage. Rein: dieselbe Funktion, die
 * den Satz baut, bestimmt auch, welche Sätze eine Vorlage braucht - so kann
 * der Ablauf nie eine Ansage verlangen, die die Erzeugung nicht kannte.
 */

export const GUIDED_DONE_TEXT = 'Geschafft.';

/** Bis hierhin (einschließlich) in Sekunden, darüber in Minuten. */
const SECONDS_LIMIT = 90;

/** „75 Sekunden“, „2 Minuten“, „2 Minuten 30“, „1 Minute“. */
export function describeSpokenDuration(seconds: number): string {
  const total = Math.round(seconds);

  if (total <= SECONDS_LIMIT) {
    return `${total} ${total === 1 ? 'Sekunde' : 'Sekunden'}`;
  }

  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  const minuteText = `${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`;

  return rest === 0 ? minuteText : `${minuteText} ${rest}`;
}

/** „Als Nächstes: Taube, links, 75 Sekunden“; die Seite fehlt bei einseitigen Schritten. */
export function buildNextAnnouncement(
  step: Pick<GuidedStep, 'name' | 'spokenName' | 'seconds' | 'bothSides'>,
  side?: GuidedSide,
): string {
  const name = step.spokenName?.trim() || step.name;
  const parts = [name];

  if (side) {
    parts.push(side === 'left' ? 'links' : 'rechts');
  }

  // Bei einem beidseitigen Schritt die Zeit dieser Seite, nicht die des ganzen Schritts.
  parts.push(describeSpokenDuration(guidedSideSeconds(step)));

  return `Als Nächstes: ${parts.join(', ')}`;
}

/**
 * Alle Sätze einer Vorlage ohne Duplikate, in der Reihenfolge des Ablaufs:
 * eine Ansage je Übungsabschnitt (die vor dem ersten Wechsel eingeschlossen)
 * und am Ende „Geschafft.“.
 */
export function requiredAnnouncementTexts(steps: readonly GuidedStep[]): string[] {
  const texts = new Set<string>();

  for (const section of resolveGuidedSections(steps)) {
    if (section.kind === 'exercise') {
      texts.add(buildNextAnnouncement(steps[section.stepIndex], section.side));
    }
  }

  texts.add(GUIDED_DONE_TEXT);

  return [...texts];
}
