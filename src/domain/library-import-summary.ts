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

  return parts.length > 0 ? parts.join(', ') : 'keine Änderungen';
}
