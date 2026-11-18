import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { db } from '@/db/appDb';
import { resolveWeekControl } from '@/domain/program';
import { formatNumber } from '@/lib/format';

/*
 * Nachschlagen und kleine Korrekturen: der Bestand ist ein Hub aus Zeilen, kein
 * Arbeitsplatz. Gestartet wird nur über Plan und "Jetzt", deshalb trägt hier
 * nichts einen Startknopf - und nichts Lime, denn nichts hier ist "jetzt dran".
 */
export function LibraryPage() {
  const library = useLiveQuery(async () => {
    const settings = await db.appSettings.get('app-settings');
    const program = settings?.activeProgramId ? await db.programs.get(settings.activeProgramId) : undefined;
    const weeks = program ? await db.programWeeks.where('programId').equals(program.id).toArray() : [];

    return {
      workouts: await db.workoutTemplates.count(),
      exercises: await db.exercises.count(),
      bands: await db.bandLevels.count(),
      tests: await db.exerciseTests.count(),
      program,
      week: resolveWeekControl(settings?.weekOverride, program, weeks).effectiveWeek,
    };
  }, []);

  const rows = [
    {
      to: '/templates',
      title: 'Workouts',
      detail: library ? formatNumber(library.workouts) : '',
    },
    {
      to: '/exercises',
      title: 'Übungen',
      detail: library ? formatNumber(library.exercises) : '',
    },
    {
      to: '/programs/manage',
      title: 'Programm',
      detail: library
        ? library.program
          ? `${library.program.name} · W${formatNumber(library.week)}`
          : 'Kein Programm aktiv'
        : '',
    },
    {
      to: '/bands',
      title: 'Bänder',
      detail: library ? `${formatNumber(library.bands)} ${library.bands === 1 ? 'Stufe' : 'Stufen'}` : '',
    },
    {
      to: '/tests',
      title: 'Tests',
      detail: library ? formatNumber(library.tests) : '',
    },
  ];

  return (
    <AppShell title="Bestand">
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.to}>
            <Link
              to={row.to}
              className="flex min-h-touch items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-soft transition hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span>
                <span className="block text-base font-semibold text-content">{row.title}</span>
                <span className="block text-sm text-content-muted">{row.detail}</span>
              </span>
              <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-content-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
