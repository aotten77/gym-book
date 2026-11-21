import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { UnitKindIcon } from '@/components/icons/UnitKindIcon';
import { WeekPrescriptionBlock } from '@/components/WeekPrescriptionBlock';
import { IconButton } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { DONE_SURFACE, DoneRow } from '@/components/ui/StatusCard';
import { db } from '@/db/appDb';
import {
  loadCompletedSessionsBetween,
  loadRunsBetween,
  loadTestsBetween,
  loadWeeklyVolume,
} from '@/db/history-queries';
import { loadPlanBetween } from '@/db/plan-queries';
import { parseLocalDate } from '@/domain/calendar-week';
import type { ProgramWeek } from '@/domain/models';
import { resolveWeekControl, toDateInputValue } from '@/domain/program';
import { buildWeekPlan, describeWeekKind } from '@/domain/program-plan';
import { buildCalendarWeeks, describeWeekRange, shiftWindow } from '@/domain/training-calendar';
import { buildWeekSheetTiles, selectWeekSheetBlocks } from '@/domain/week-sheet';
import { useTodayKey } from '@/hooks/useTodayKey';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

interface WeekSheetProps {
  /** Der Montag der gezeigten Woche; das Sheet ist offen, solange er gesetzt ist. */
  weekKey: string | null;
  onChangeWeek: (key: string) => void;
  onClose: () => void;
}

/**
 * Eine Woche des Zeitstrahls zum Lesen: Kacheln, Testtermin und die
 * Vorgaben ihrer Programmwoche.
 *
 * Nichts hier schreibt oder startet. Die Woche ist ephemerer Zustand der
 * Seite - ‹ › blättern, ohne `weekOverride` anzufassen: Woche 5 *ansehen*
 * heißt nicht Woche 5 *trainieren*, und genau dafür steht bei einer von Hand
 * gesetzten Woche ein Hinweis im Sheet.
 */
export function WeekSheet({ weekKey, onChangeWeek, onClose }: WeekSheetProps) {
  const todayKey = useTodayKey();
  const today = useMemo(() => parseLocalDate(todayKey) ?? new Date(), [todayKey]);

  const data = useLiveQuery(async () => {
    const monday = weekKey ? parseLocalDate(weekKey) : undefined;

    if (!monday) {
      return undefined;
    }

    const sunday = new Date(monday.getTime());

    sunday.setDate(sunday.getDate() + 6);

    const after = new Date(monday.getTime());

    after.setDate(after.getDate() + 7);

    const settings = await db.appSettings.get('app-settings');
    const activeProgramId = settings?.activeProgramId;
    const [
      program,
      programWeeks,
      templates,
      templateExercises,
      exercises,
      progressionRules,
      bandLevels,
      plan,
      completedSessions,
      runs,
      tests,
      volumes,
    ] = await Promise.all([
      activeProgramId ? db.programs.get(activeProgramId) : undefined,
      activeProgramId
        ? db.programWeeks.where('programId').equals(activeProgramId).toArray()
        : ([] as ProgramWeek[]),
      db.workoutTemplates.toArray(),
      db.workoutTemplateExercises.toArray(),
      db.exercises.toArray(),
      db.progressionRules.toArray(),
      db.bandLevels.toArray(),
      loadPlanBetween(toDateInputValue(monday), toDateInputValue(sunday)),
      loadCompletedSessionsBetween(monday.toISOString(), after.toISOString()),
      loadRunsBetween(toDateInputValue(monday), toDateInputValue(sunday)),
      loadTestsBetween(monday.toISOString(), after.toISOString()),
      loadWeeklyVolume(monday, monday),
    ]);

    return {
      weekKey,
      settings,
      program,
      programWeeks: [...programWeeks].sort((left, right) => left.weekNumber - right.weekNumber),
      templates,
      templateExercises,
      exercises,
      progressionRules,
      bandLevels,
      plan,
      completedSessions,
      runs,
      tests,
      volume: volumes[0],
    };
  }, [weekKey]);

  // Beim Blättern liefert `useLiveQuery` bis zur neuen Antwort noch die alte Woche.
  const current = data && data.weekKey === weekKey ? data : undefined;
  const monday = weekKey ? parseLocalDate(weekKey) : undefined;
  const week = useMemo(
    () =>
      current && monday
        ? buildCalendarWeeks({
            firstMonday: monday,
            weeks: 1,
            today,
            program: current.program,
            programWeeks: current.programWeeks,
            planEntries: current.plan.entries,
            planLinks: current.plan.links,
            templates: current.templates,
            completedSessions: current.completedSessions,
            runs: current.runs,
            tests: current.tests,
          })[0]
        : undefined,
    // `monday` ist eine neue Date je Render; die Woche steckt im Schlüssel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, today, weekKey],
  );

  const programWeekNumber = week?.programWeek?.number;
  const programWeek =
    programWeekNumber === undefined
      ? undefined
      : current?.programWeeks.find((item) => item.weekNumber === programWeekNumber);
  const blocks = useMemo(
    () =>
      current && programWeek
        ? selectWeekSheetBlocks({
            blocks: buildWeekPlan({
              templates: current.templates,
              templateExercises: current.templateExercises,
              exercises: current.exercises,
              progressionRules: current.progressionRules,
              programWeekId: programWeek.id,
            }),
            entries: current.plan.entries,
            links: current.plan.links,
            todayKey,
          })
        : [],
    [current, programWeek, todayKey],
  );
  const tiles = useMemo(
    () =>
      current && week
        ? buildWeekSheetTiles({
            week,
            entries: current.plan.entries,
            templates: current.templates,
            volume: current.volume,
            todayKey,
          })
        : [],
    [current, week, todayKey],
  );
  const bandNameById = useMemo(
    () =>
      (current?.bandLevels ?? []).reduce<Record<string, string>>((names, band) => {
        names[band.id] = band.name;
        return names;
      }, {}),
    [current?.bandLevels],
  );

  const weekControl = current
    ? resolveWeekControl(current.settings?.weekOverride, current.program, current.programWeeks)
    : undefined;
  const showOverrideNote =
    weekControl !== undefined &&
    weekControl.mode === 'override' &&
    week?.isCurrent === true &&
    programWeekNumber !== undefined &&
    weekControl.effectiveWeek !== programWeekNumber;

  const kind = week?.programWeek?.kind ? describeWeekKind(week.programWeek.kind) : undefined;
  const title =
    programWeekNumber === undefined
      ? 'Woche'
      : kind
        ? `W${formatNumber(programWeekNumber)} · ${kind}`
        : `W${formatNumber(programWeekNumber)}`;
  const range = week ? describeWeekRange(week.start, week.end) : '';

  function changeWeek(direction: -1 | 1) {
    const base = weekKey ? parseLocalDate(weekKey) : undefined;

    if (base) {
      onChangeWeek(toDateInputValue(shiftWindow(base, direction)));
    }
  }

  return (
    <Sheet
      open={weekKey !== null}
      label={week ? `${title} · ${range}` : 'Woche'}
      closeLabel="Woche schließen"
      onClose={onClose}
      header={
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-content-muted">
              {range}
              {week?.isCurrent ? ' · diese Woche' : ''}
            </p>
            <h2 className="mt-0.5 truncate font-display text-[21px] font-extrabold leading-[1.06] tracking-[-0.04em]">
              {title}
            </h2>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <IconButton label="Vorige Woche" onClick={() => changeWeek(-1)}>
              <ChevronLeft size={18} aria-hidden="true" />
            </IconButton>
            <IconButton label="Nächste Woche" onClick={() => changeWeek(1)}>
              <ChevronRight size={18} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      }
    >
      {current && week ? (
        <div data-week-sheet={weekKey ?? ''} className="min-w-0 space-y-4">
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
            {tiles.map((tile) => (
              <div
                key={tile.kind}
                data-week-tile={tile.kind}
                data-tile-done={tile.done ? '' : undefined}
                className={cn(
                  'min-w-0 px-3 py-2',
                  tile.done ? DONE_SURFACE : 'rounded-card border border-line bg-surface text-content',
                )}
              >
                <p className="flex items-center gap-1.5 text-xs font-bold">
                  <UnitKindIcon kind={tile.kind} size={15} />
                  {tile.title}
                </p>
                <p className="mt-1 font-display text-xl font-bold tabular-nums tracking-tight">{tile.count}</p>
                {tile.detail ? (
                  <p className={cn('text-xs tabular-nums', tile.done ? 'opacity-75' : 'text-content-muted')}>
                    {tile.detail}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          {/*
            Der Testtermin ist reine Anzeige und führt zu den Tests - erfasst
            wird dort, nicht hier. `ProgramWeek.kind` bleibt beschreibend.
          */}
          {week.hasTestAppointment ? (
            <Link
              to="/tests"
              data-week-test=""
              className="block rounded-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {week.testDone ? (
                <DoneRow title="Seitenvergleich gemessen" meta="Zu den Tests" />
              ) : (
                <div className="flex min-h-touch items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-3">
                  <span className="min-w-0 text-sm text-content">
                    <span className="font-semibold">Testtermin</span> · Seitenvergleich in dieser Woche
                  </span>
                  <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-content-muted" />
                </div>
              )}
            </Link>
          ) : null}

          {showOverrideNote && weekControl && programWeekNumber !== undefined ? (
            <p
              data-week-sheet-override=""
              className="rounded-panel border border-line bg-surface-raised px-3 py-2 text-sm text-content-secondary"
            >
              Von Hand auf W{formatNumber(weekControl.effectiveWeek)} gesetzt – ein Start trainiert W
              {formatNumber(weekControl.effectiveWeek)}, nicht W{formatNumber(programWeekNumber)}.
            </p>
          ) : null}

          {programWeekNumber !== undefined && programWeek ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-content-muted">
                Vorgaben W{formatNumber(programWeekNumber)}
              </h3>
              {blocks.map(({ block, days }) => (
                <WeekPrescriptionBlock
                  key={block.templateId}
                  block={block}
                  days={days}
                  bandNameById={bandNameById}
                  programWeekNumber={programWeekNumber}
                />
              ))}
            </section>
          ) : null}

          <p className="text-center text-xs text-content-muted">
            Nur zum Lesen. Wochenvorgaben änderst du im Workout unter „Wochenprogression“.
          </p>
        </div>
      ) : null}
    </Sheet>
  );
}
