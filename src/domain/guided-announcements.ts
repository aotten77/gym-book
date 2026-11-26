import type { GuidedStep } from '@/domain/models';
import {
  guidedSideSeconds,
  plannedTransitionSeconds,
  resolveGuidedSections,
  type GuidedSide,
} from '@/domain/guided-steps';

/*
 * Der Text der Ansagen einer geführten Vorlage. Rein: dieselbe Funktion, die
 * den Satz baut, bestimmt auch, welche Sätze eine Vorlage braucht - so kann
 * der Ablauf nie eine Ansage verlangen, die die Erzeugung nicht kannte.
 */

export const GUIDED_DONE_TEXT = 'Geschafft.';

/**
 * Wie lange nach dem Wechselsignal die Ansage beginnt: das Signal dauert 0,4 s,
 * dazu eine kurze Atempause - nacheinander statt übereinander. Der Player
 * wartet so lange, und ein Wechsel mit Anleitung rechnet sie mit ein.
 */
export const GUIDED_ANNOUNCEMENT_DELAY_SECONDS = 0.7;

/** Ruhe nach dem Ende der Anleitung, bevor die Uhr der Übung startet. */
export const GUIDED_GUIDANCE_PAD_SECONDS = 2;

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

/**
 * „Als Nächstes: Taube, links, 75 Sekunden“; die Seite fehlt bei einseitigen
 * Schritten. Trägt der Schritt `guidanceSeconds` (nur im Snapshot), folgt die
 * Anleitung im selben Satz - aber nicht vor der rechten Seite.
 */
export function buildNextAnnouncement(
  step: Pick<
    GuidedStep,
    'name' | 'spokenName' | 'seconds' | 'bothSides' | 'guidance' | 'guidanceSeconds'
  >,
  side?: GuidedSide,
): string {
  const name = step.spokenName?.trim() || step.name;
  const parts = [name];

  if (side) {
    parts.push(side === 'left' ? 'links' : 'rechts');
  }

  // Bei einem beidseitigen Schritt die Zeit dieser Seite, nicht die des ganzen Schritts.
  parts.push(describeSpokenDuration(guidedSideSeconds(step)));

  const next = `Als Nächstes: ${parts.join(', ')}`;
  const guidance = step.guidance?.trim();

  return step.guidanceSeconds !== undefined && guidance && side !== 'right'
    ? `${next}. ${guidance}`
    : next;
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

/**
 * Die Sätze mit Anleitung für **Vorlagen**schritte: je Schritt mit Anleitung
 * einer (vor der ersten bzw. einzigen Seite), in Schrittreihenfolge. Gebaut
 * über `buildNextAnnouncement` mit einem Platzhalter-`guidanceSeconds`, damit
 * Erzeugung, Messung und Ablauf garantiert denselben Satz meinen.
 */
export function requiredGuidanceTexts(
  steps: readonly GuidedStep[],
): { stepIndex: number; text: string }[] {
  return steps.flatMap((step, stepIndex) =>
    step.guidance?.trim()
      ? [
          {
            stepIndex,
            text: buildNextAnnouncement(
              { ...step, guidanceSeconds: 1 },
              step.bothSides ? 'left' : undefined,
            ),
          },
        ]
      : [],
  );
}

/**
 * Die Länge eines Wechsels mit Anleitung: Verzögerung nach dem Signal, die
 * gemessene Ansage und eine kurze Ruhe, aufgerundet - nie kürzer als der
 * Wechsel, den der Schritt ohne Anleitung hätte.
 */
export function guidanceTransitionSeconds(plannedSeconds: number, durationMs: number): number {
  return Math.max(
    plannedSeconds,
    Math.ceil(GUIDED_ANNOUNCEMENT_DELAY_SECONDS + durationMs / 1000 + GUIDED_GUIDANCE_PAD_SECONDS),
  );
}

/**
 * Setzt an jedem Schritt mit Anleitung `guidanceSeconds` aus der gemessenen
 * Dauer seines Satzes - eine Kopie, die Eingabe bleibt unverändert. `null`,
 * wenn kein Schritt eine Anleitung hat oder für einen die Dauer fehlt: dann
 * läuft die Einheit ohne Anleitung.
 */
export function applyGuidance(
  steps: readonly GuidedStep[],
  durationsByText: ReadonlyMap<string, number>,
): GuidedStep[] | null {
  const guided = requiredGuidanceTexts(steps);

  if (guided.length === 0) {
    return null;
  }

  const result = steps.map((step) => ({ ...step }));

  for (const { stepIndex, text } of guided) {
    const durationMs = durationsByText.get(text);

    if (durationMs === undefined) {
      return null;
    }

    result[stepIndex].guidanceSeconds = guidanceTransitionSeconds(
      plannedTransitionSeconds(steps, stepIndex),
      durationMs,
    );
  }

  return result;
}
