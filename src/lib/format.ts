import type { TrackingMode, WorkoutSession, WorkoutSetLog } from '@/domain/models';

const TRACKING_MODE_LABELS: Record<TrackingMode, string> = {
  reps_weight: 'Wiederholungen + Gewicht',
  time: 'Zeit',
  time_weight: 'Zeit + Gewicht',
};

/**
 * Übersetzt den Tracking-Modus in etwas Lesbares.
 *
 * Der rohe Enum stand zuvor so im UI ("Modus: reps_weight") - für jemanden,
 * der die Datenstruktur nicht kennt, ist das keine Information.
 */
export function formatTrackingMode(trackingMode?: TrackingMode) {
  return trackingMode ? TRACKING_MODE_LABELS[trackingMode] : 'Unbekannt';
}

/**
 * Beschreibt, aus welcher Programmwoche eine Session materialisiert wurde.
 *
 * Bisher in drei Seiten kopiert - und alle drei zeigten "Woche 8 · Woche 8",
 * weil die aufgelöste Wochennummer und das Wochen-Label meist denselben Text
 * ergeben. Das Label gewinnt, die Nummer springt nur ein, wenn keines da ist.
 */
export function formatSessionWeekContext(session: WorkoutSession) {
  const weekLabel = session.programWeekLabelSnapshot?.trim();
  const parts = [
    weekLabel || `Woche ${session.resolvedProgramWeek}`,
    session.programNameSnapshot,
    // "Programm" ist der Normalfall und damit keine Information wert.
    session.usedWeekOverride ? 'Override' : undefined,
  ];

  return parts.filter(Boolean).join(' · ');
}

export function formatDateTime(value?: string) {
  if (!value) {
    return 'Noch offen';
  }

  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatLoadLabel(setLog: WorkoutSetLog) {
  const parts: string[] = [];

  if (typeof setLog.reps === 'number') {
    parts.push(`${setLog.reps} Wdh`);
  }

  if (typeof setLog.seconds === 'number') {
    parts.push(`${setLog.seconds}s`);
  }

  if (typeof setLog.weight === 'number') {
    parts.push(`${setLog.weight} kg`);
  }

  // Band statt Kilo: die Übung trägt entweder das eine oder das andere, und
  // der Name steht am Satz, damit er einen Umbenennung im Katalog übersteht.
  if (setLog.bandNameSnapshot) {
    parts.push(setLog.bandNameSnapshot);
  }

  return parts.length > 0 ? parts.join(' · ') : 'Noch nicht protokolliert';
}

export function formatSideLabel(side: WorkoutSetLog['side']) {
  if (side === 'left') {
    return 'links';
  }

  if (side === 'right') {
    return 'rechts';
  }

  return '';
}

/**
 * Bei unilateralen Übungen ist die Zahl ohne Seitenangabe wertlos - man
 * weiß sonst nicht, ob "50 kg | 45 kg" zwei Sätze oder zwei Seiten sind.
 */
export function formatSetLogWithSide(log: WorkoutSetLog) {
  const sideLabel = formatSideLabel(log.side);
  return sideLabel ? `${formatLoadLabel(log)} (${sideLabel})` : formatLoadLabel(log);
}

export function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
}
