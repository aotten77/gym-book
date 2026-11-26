import { useCallback, useRef, useState } from 'react';
import {
  generateAnnouncements,
  type GenerateAnnouncementsResult,
  type OverageInfo,
} from '@/db/announcement-actions';
import { formatNumber } from '@/lib/format';

/** Die Meldung zu einem Ergebnis; `null`, wenn es nichts zu melden gibt. */
export function describeGenerationResult(result: GenerateAnnouncementsResult) {
  if (result.status === 'complete') {
    if (result.unmeasured) {
      return {
        tone: 'error' as const,
        text:
          `${formatNumber(result.generated)} Ansagen erzeugt. Die Länge der Anleitung ließ sich ` +
          'auf diesem Gerät nicht messen – „Mit Anleitung“ bleibt gesperrt.',
      };
    }

    return result.generated > 0
      ? { tone: 'success' as const, text: `${formatNumber(result.generated)} Ansagen erzeugt.` }
      : null;
  }

  if (result.status === 'declined') {
    return {
      tone: 'error' as const,
      text: 'Ansagen nicht erzeugt – die Kosten wurden nicht bestätigt. „Nur Ton“ bleibt, bis sie erzeugt sind.',
    };
  }

  const progress =
    result.generated > 0
      ? ` (${formatNumber(result.generated)} erzeugt, ${formatNumber(result.missing)} fehlen)`
      : '';

  return {
    tone: 'error' as const,
    text: `${result.message ?? 'Ansagen nicht erzeugt'}${progress}. Die Vorlage läuft mit „Nur Ton“.`,
  };
}

/** Der Satz in der Rückfrage bei Überschreitung des Freikontingents. */
export function describeOverage(info: OverageInfo) {
  const cost = info.costUsd > 0 ? `${formatNumber(info.costUsd)} $` : 'unter 0,01 $';

  return (
    `Die Erzeugung braucht ${formatNumber(info.chars)} Zeichen und überschreitet das ` +
    `Freikontingent dieses Monats um ${formatNumber(info.overChars)} Zeichen. Kosten: ca. ${cost}.`
  );
}

/**
 * Stößt die Erzeugung an und hält Zustand für die Oberfläche: läuft sie, welche
 * Meldung gibt es, und wartet gerade eine Kostenfrage. Die Erzeugung wirft nie,
 * der Aufrufer muss also nichts abfangen.
 */
export function useAnnouncementGeneration() {
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [overage, setOverage] = useState<OverageInfo | null>(null);
  const answerRef = useRef<((accepted: boolean) => void) | null>(null);

  const run = useCallback(async (templateIds: readonly string[]) => {
    setIsRunning(true);
    setMessage(null);

    const result = await generateAnnouncements(templateIds, {
      confirmOverage: (info) =>
        new Promise<boolean>((resolve) => {
          answerRef.current = resolve;
          setOverage(info);
        }),
    });

    setOverage(null);
    answerRef.current = null;
    setIsRunning(false);

    const next = describeGenerationResult(result);

    setMessage(next);

    return { result, message: next };
  }, []);

  const answerOverage = useCallback((accepted: boolean) => {
    answerRef.current?.(accepted);
    setOverage(null);
  }, []);

  return { isRunning, message, overage, run, answerOverage };
}
