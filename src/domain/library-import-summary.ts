import type { LibraryImportLog } from '@/domain/models';
import { formatNumber } from '@/lib/format';

type ImportCounts = Pick<
  LibraryImportLog,
  | 'createdExercises'
  | 'updatedExercises'
  | 'createdTemplates'
  | 'updatedTemplates'
  | 'createdAssignments'
  | 'updatedAssignments'
  | 'createdBandLevels'
  | 'updatedBandLevels'
  | 'removedAssignments'
  | 'createdPlanEntries'
  | 'updatedPlanEntries'
  | 'removedPlanEntries'
  | 'createdRestrictions'
  | 'updatedRestrictions'
  | 'liftedRestrictions'
  | 'reactivatedRestrictions'
>;

function count(value: number, singular: string, plural: string) {
  return `${formatNumber(value)} ${value === 1 ? singular : plural}`;
}

/**
 * Die eine Zeile pro Import in „Letzte Importe“: was die Datei angelegt oder
 * geändert hat, danach was sie entfernt hat.
 *
 * Alle Zähler der Zeile gehören hinein. Ein Import, der nur offene Termine
 * entfernt oder nur Bandstufen anlegt, soll nicht als „keine Änderungen“
 * erscheinen - das wäre genau der Import, über den man später nachlesen will.
 * Neu und geändert werden zusammengezählt; die Vorschau vor dem Schreiben
 * trennt sie, die Rückschau braucht nur den Umfang. Die Felder für Termine und
 * Entfernungen fehlen bei älteren Zeilen und zählen dort als 0.
 */
export function describeImportCounts(log: ImportCounts): string {
  const changed = [
    {
      value: log.createdTemplates + log.updatedTemplates,
      singular: 'Workout',
      plural: 'Workouts',
    },
    {
      value: log.createdExercises + log.updatedExercises,
      singular: 'Übung',
      plural: 'Übungen',
    },
    {
      value: log.createdAssignments + log.updatedAssignments,
      singular: 'Zuordnung',
      plural: 'Zuordnungen',
    },
    {
      value: log.createdBandLevels + log.updatedBandLevels,
      singular: 'Bandstufe',
      plural: 'Bandstufen',
    },
    {
      value: (log.createdPlanEntries ?? 0) + (log.updatedPlanEntries ?? 0),
      singular: 'Termin',
      plural: 'Termine',
    },
    {
      value: (log.createdRestrictions ?? 0) + (log.updatedRestrictions ?? 0),
      singular: 'Einschränkung',
      plural: 'Einschränkungen',
    },
  ];
  const removed = [
    { value: log.removedAssignments ?? 0, singular: 'Zuordnung', plural: 'Zuordnungen' },
    { value: log.removedPlanEntries ?? 0, singular: 'Termin', plural: 'Termine' },
  ];

  const parts = changed
    .filter((item) => item.value > 0)
    .map((item) => count(item.value, item.singular, item.plural));

  for (const item of removed.filter((entry) => entry.value > 0)) {
    parts.push(`${count(item.value, item.singular, item.plural)} entfernt`);
  }

  // Aufheben und Wiederaktivieren schreiben, auch wenn sonst nichts geschieht.
  if (log.liftedRestrictions) {
    parts.push(`${count(log.liftedRestrictions, 'Einschränkung', 'Einschränkungen')} aufgehoben`);
  }

  if (log.reactivatedRestrictions) {
    parts.push(
      `${count(log.reactivatedRestrictions, 'Einschränkung', 'Einschränkungen')} wieder aktiv`,
    );
  }

  return parts.length > 0 ? parts.join(', ') : 'keine Änderungen';
}
