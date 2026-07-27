import type { WorkoutSetLog } from '@/domain/models';

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

  return parts.length > 0 ? parts.join(' · ') : 'Noch nicht protokolliert';
}

export function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
}
