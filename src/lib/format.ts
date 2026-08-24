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

/**
 * Eine Zahl in deutscher Schreibweise: "82,5" statt "82.5".
 *
 * Ohne das steht im ganzen UI der englische Dezimalpunkt - eine Stange wiegt
 * 82,5 kg, nicht 82.5. Zwei Nachkommastellen, weil die kleinste Scheibe 1,25
 * wiegt; mehr entsteht in der Eingabe nicht.
 *
 * `Intl` gruppiert ab vier Stellen ("1.250" für Volumen), was hier richtig ist
 * - dieselbe Zahl mit Punkt als Tausendertrenner ist deutsch eindeutig.
 */
const numberFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

export function formatNumber(value: number) {
  return numberFormat.format(value);
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

  // Die Höhe vor der Last: sie beschreibt, worauf überhaupt gearbeitet wurde.
  if (typeof setLog.heightCm === 'number') {
    parts.push(`${formatNumber(setLog.heightCm)} cm`);
  }

  if (typeof setLog.weight === 'number') {
    parts.push(`${formatNumber(setLog.weight)} kg`);
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

export function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
}

/** Die Schätzung in zwei Teilen - die Zahl groß, die Einheit klein daneben. */
export interface RemainingEstimateLabel {
  value: string;
  unit: string;
}

/**
 * Grobe Restzeit: "~42 min", "~1:20 h", "<1 min".
 *
 * Die Tilde gehört dazu: das ist eine Schätzung, keine Uhr. Ab einer Stunde
 * wird auf Stunden umgestellt, weil "~102 min" neben Dauer und Sätzen nicht
 * mehr auf ein 320px-Gerät passt - anders als `formatTimer`, das die beiden
 * Countdowns trägt und deshalb bei mm:ss bleibt.
 */
export function formatRemainingEstimate(seconds: number): RemainingEstimateLabel {
  const minutes = Math.round(Math.max(0, seconds) / 60);

  // Nie "0 min": solange eine Zeile offen ist, steht noch etwas an.
  if (minutes < 1) {
    return { value: '<1', unit: 'min' };
  }

  if (minutes < 60) {
    return { value: `~${minutes}`, unit: 'min' };
  }

  const hours = Math.floor(minutes / 60);

  return { value: `~${hours}:${String(minutes % 60).padStart(2, '0')}`, unit: 'h' };
}

/** Dieselbe Angabe als Fließtext, für Screenreader: "etwa 42 Minuten". */
export function describeRemainingEstimate(seconds: number) {
  const minutes = Math.round(Math.max(0, seconds) / 60);

  if (minutes < 1) {
    return 'weniger als eine Minute';
  }

  if (minutes < 60) {
    return `etwa ${minutes} Minuten`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  const hourLabel = hours === 1 ? 'eine Stunde' : `${hours} Stunden`;

  return restMinutes === 0
    ? `etwa ${hourLabel}`
    : `etwa ${hourLabel} und ${restMinutes} Minuten`;
}
