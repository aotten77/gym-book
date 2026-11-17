import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/AppShell';
import { Empty } from '@/components/Empty';
import { PlanWeekSection } from '@/components/PlanWeekSection';
import { ProgressionRuleFields } from '@/components/ProgressionRuleFields';
import { SupersetBlock } from '@/components/SupersetBlock';
import { TrainingCalendar } from '@/components/TrainingCalendar';
import { WeekVolumeTiles } from '@/components/WeekVolumeTiles';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { DoneRow, NowCard } from '@/components/ui/StatusCard';
import { db } from '@/db/appDb';
import {
  loadCompletedSessionsBetween,
  loadRunsBetween,
  loadTestDatesBetween,
  loadWeeklyVolume,
} from '@/db/history-queries';
import { loadPlanBetween } from '@/db/plan-queries';
import { clearProgressionRule, saveProgressionRule } from '@/db/template-actions';
import { describeTodayStatus } from '@/domain/plan';
import { parseLocalDate, startOfCalendarWeek } from '@/domain/calendar-week';
import {
  buildCalendarWeeks,
  CALENDAR_WINDOW_STEP,
  CALENDAR_WINDOW_WEEKS,
  defaultFirstMonday,
  keepSelectionInWindow,
  rollCalendarToToday,
  shiftWindow,
} from '@/domain/training-calendar';
import type { ProgramWeek } from '@/domain/models';
import {
  buildWeekPlan,
  describeWeekPrescription,
  type PrescriptionSegment,
  type WeekPlanBlock,
  type WeekPlanEntry,
} from '@/domain/program-plan';
import { foldProgressionRule } from '@/domain/progression-fold';
import {
  buildProgressionRuleForm,
  emptyProgressionRuleForm,
  toProgressionRuleInput,
  type ProgressionRuleFormState,
} from '@/domain/progression-rule-form';
import { resolveWeekControl, toDateInputValue } from '@/domain/program';
import { cn } from '@/lib/utils';

/**
 * Was ist in Woche 3 geplant?
 *
 * Der Reiter zeigte bisher ausschließlich CRUD auf Programm und Woche - der
 * *Inhalt* eines Programms, die Progressionsregeln, kam hier gar nicht vor.
 * Diese Seite beantwortet die Frage, für die es den Reiter gibt, und zwar mit
 * `buildWeekPlan`, also mit derselben Faltung, die der Sessionstart schreibt.
 *
 * Was sie bewusst nicht kann: neben den Wochenvorgaben ein Training starten.
 * Es gibt im Datenmodell keine Verbindung Woche → Workout - alle Workouts
 * laufen in jeder Woche - und die Seite sagt das offen, statt eine
 * Reihenfolge zu erfinden. Gestartet wird nur aus der Tagesliste und dem
 * `NowSheet` („Jetzt trainieren").
 */
export function ProgramsPage() {
  /*
   * Fenster und Wochenauswahl sind reiner Oberflächenzustand - nie
   * `weekOverride`, nie IndexedDB. Woche 5 *ansehen* darf nicht Woche 5
   * *trainieren*: ein Override schlägt Startdatum und Programm-Woche, bis ihn
   * jemand zurücknimmt, und genau dieser Fehler stand auf einem echten Gerät
   * wochenlang. Es gibt einen Schreiber auf `weekOverride`, und der sitzt in
   * den Einstellungen. Die Auswahl ist der Montag der Woche (`YYYY-MM-DD`).
   */
  const [firstMonday, setFirstMonday] = useState(() => defaultFirstMonday(new Date()));
  const [selectedWeek, setSelectedWeek] = useState(() =>
    toDateInputValue(startOfCalendarWeek(new Date())),
  );
  /** Die Zeile, die gerade im Sheet bearbeitet wird - ebenfalls ephemer. */
  const [editingEntry, setEditingEntry] = useState<WeekPlanEntry | null>(null);
  const [ruleForm, setRuleForm] = useState<ProgressionRuleFormState>(emptyProgressionRuleForm);
  const [isSavingRule, setIsSavingRule] = useState(false);

  const settings = useLiveQuery(() => db.appSettings.get('app-settings'), []);
  const program = useLiveQuery(async () => {
    const appSettings = await db.appSettings.get('app-settings');

    return appSettings?.activeProgramId
      ? db.programs.get(appSettings.activeProgramId)
      : undefined;
  }, []);
  const weeks = useLiveQuery(async () => {
    const appSettings = await db.appSettings.get('app-settings');

    if (!appSettings?.activeProgramId) {
      return [] as ProgramWeek[];
    }

    const rows = await db.programWeeks.where('programId').equals(appSettings.activeProgramId).toArray();
    return rows.sort((left, right) => left.weekNumber - right.weekNumber);
  }, []);
  const templates = useLiveQuery(() => db.workoutTemplates.toArray(), []);
  const templateExercises = useLiveQuery(() => db.workoutTemplateExercises.toArray(), []);
  const exercises = useLiveQuery(() => db.exercises.toArray(), []);
  const progressionRules = useLiveQuery(() => db.progressionRules.toArray(), []);
  const bandLevels = useLiveQuery(() => db.bandLevels.toArray(), []);

  const weekControl = resolveWeekControl(settings?.weekOverride, program, weeks ?? []);

  /*
   * Der lokale Tag als Zustand: eine installierte App bleibt über Nacht offen,
   * und ohne Neulesen stünde morgens noch gestern als „Heute · Starten" da.
   */
  const [todayKey, setTodayKey] = useState(() => toDateInputValue(new Date()));
  const dayState = useRef({ todayKey, firstMonday, selectedWeek });
  dayState.current = { todayKey, firstMonday, selectedWeek };
  useEffect(() => {
    function checkDay() {
      const now = new Date();
      const nextKey = toDateInputValue(now);
      const current = dayState.current;

      if (nextKey === current.todayKey) {
        return;
      }

      const rolled = rollCalendarToToday(
        { firstMonday: current.firstMonday, selectedWeek: current.selectedWeek, previousToday: current.todayKey },
        now,
      );

      dayState.current = { todayKey: nextKey, ...rolled };
      setTodayKey(nextKey);
      setFirstMonday(rolled.firstMonday);
      setSelectedWeek(rolled.selectedWeek);
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        checkDay();
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', checkDay);
    const interval = window.setInterval(checkDay, 60_000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', checkDay);
      window.clearInterval(interval);
    };
  }, []);
  const range = useMemo(() => {
    const lastMonday = shiftWindow(firstMonday, CALENDAR_WINDOW_WEEKS - 1);
    const toDay = new Date(lastMonday.getTime());

    toDay.setDate(toDay.getDate() + 6);

    const after = new Date(lastMonday.getTime());

    after.setDate(after.getDate() + 7);

    return {
      fromDay: toDateInputValue(firstMonday),
      toDay: toDateInputValue(toDay),
      fromIso: firstMonday.toISOString(),
      toIso: after.toISOString(),
    };
  }, [firstMonday]);

  const planInRange = useLiveQuery(
    () => loadPlanBetween(range.fromDay, range.toDay),
    [range.fromDay, range.toDay],
  );
  const completedSessions = useLiveQuery(
    () => loadCompletedSessionsBetween(range.fromIso, range.toIso),
    [range.fromIso, range.toIso],
  );
  const runsInRange = useLiveQuery(
    () => loadRunsBetween(range.fromDay, range.toDay),
    [range.fromDay, range.toDay],
  );
  const testDates = useLiveQuery(
    () => loadTestDatesBetween(range.fromIso, range.toIso),
    [range.fromIso, range.toIso],
  );
  const weekVolume = useLiveQuery(async () => {
    const selected = parseLocalDate(selectedWeek);

    return selected ? (await loadWeeklyVolume(selected, selected))[0] : undefined;
  }, [selectedWeek]);
  const todayPlan = useLiveQuery(() => loadPlanBetween(todayKey, todayKey), [todayKey]);

  const templateNames = useMemo(
    () =>
      (templates ?? []).reduce<Record<string, string>>((names, template) => {
        names[template.id] = template.name;
        return names;
      }, {}),
    [templates],
  );

  /* Nur der lokale Tag zählt; ein Tageswechsel bei offener Seite ändert die Abhängigkeit. */
  const today = useMemo(() => parseLocalDate(todayKey) ?? new Date(), [todayKey]);
  const calendarRows = useMemo(
    () =>
      buildCalendarWeeks({
        firstMonday,
        weeks: CALENDAR_WINDOW_WEEKS,
        today,
        program,
        programWeeks: weeks ?? [],
        planEntries: planInRange?.entries ?? [],
        planLinks: planInRange?.links ?? {},
        templates: templates ?? [],
        completedSessions: completedSessions ?? [],
        runs: runsInRange ?? [],
        testDates: testDates ?? [],
      }),
    [firstMonday, today, program, weeks, planInRange, templates, completedSessions, runsInRange, testDates],
  );
  const selectedRow = calendarRows.find((row) => row.key === selectedWeek);
  const selectedProgramWeek = selectedRow?.programWeek
    ? (weeks ?? []).find((week) => week.weekNumber === selectedRow.programWeek?.number)
    : undefined;
  const todayStatus = describeTodayStatus(
    todayPlan?.entries ?? [],
    todayPlan?.links ?? {},
    todayKey,
    templateNames,
  );

  function handleShiftWindow(direction: -1 | 1) {
    const next = shiftWindow(firstMonday, direction * CALENDAR_WINDOW_STEP);

    setFirstMonday(next);
    setSelectedWeek((current) => keepSelectionInWindow(current, next, CALENDAR_WINDOW_WEEKS));
  }

  const bandNameById = useMemo(
    () =>
      (bandLevels ?? []).reduce<Record<string, string>>((names, band) => {
        names[band.id] = band.name;
        return names;
      }, {}),
    [bandLevels],
  );

  const blocks = useMemo(
    () =>
      buildWeekPlan({
        templates: templates ?? [],
        templateExercises: templateExercises ?? [],
        exercises: exercises ?? [],
        progressionRules: progressionRules ?? [],
        programWeekId: selectedProgramWeek?.id,
      }),
    [templates, templateExercises, exercises, progressionRules, selectedProgramWeek?.id],
  );

  /** Wie viele Regeln in dieser Woche überhaupt greifen - für den leeren Zustand. */
  const overrideCount = blocks.reduce(
    (count, block) =>
      count + block.entries.filter((entry) => entry.overriddenFields.length > 0).length,
    0,
  );

  /** Die gespeicherte Regel der offenen Zeile - Grundlage des Formulars. */
  const editingRule =
    editingEntry && selectedProgramWeek
      ? (progressionRules ?? []).find(
          (rule) =>
            rule.templateExerciseId === editingEntry.templateExerciseId &&
            rule.programWeekId === selectedProgramWeek.id,
        )
      : undefined;

  /*
   * Die Basiswerte des Workouts - sie stehen als Platzhalter in den Feldern,
   * damit ein leeres Feld sichtbar "wie im Workout" heißt. `effective` taugt
   * dafür nicht: darin steckt die Regel schon drin.
   */
  const editingTemplateExercise = editingEntry
    ? (templateExercises ?? []).find((item) => item.id === editingEntry.templateExerciseId)
    : undefined;
  const editingBaseTargets = editingTemplateExercise
    ? foldProgressionRule(editingTemplateExercise)
    : undefined;

  function handleEditEntry(entry: WeekPlanEntry) {
    /*
     * Bearbeitet wird der **Plan**, nie eine laufende Ausführung: von hier
     * führt kein Weg zu einer `WorkoutSessionExercise`. Deshalb gibt es
     * neben den Wochenvorgaben keinen Startknopf - der Start löst die Woche über
     * `resolveWeekControl` auf und nicht über die Auswahl oben.
     */
    if (!selectedProgramWeek) {
      return;
    }

    const rule = (progressionRules ?? []).find(
      (item) =>
        item.templateExerciseId === entry.templateExerciseId &&
        item.programWeekId === selectedProgramWeek.id,
    );

    setRuleForm(buildProgressionRuleForm(rule));
    setEditingEntry(entry);
  }

  async function handleSaveRule() {
    if (!editingEntry || !selectedProgramWeek) {
      return;
    }

    setIsSavingRule(true);

    try {
      await saveProgressionRule({
        templateExerciseId: editingEntry.templateExerciseId,
        programWeekId: selectedProgramWeek.id,
        ...toProgressionRuleInput(ruleForm, editingEntry),
      });
      setEditingEntry(null);
    } finally {
      setIsSavingRule(false);
    }
  }

  async function handleClearRule() {
    if (!editingEntry || !selectedProgramWeek) {
      return;
    }

    setIsSavingRule(true);

    try {
      await clearProgressionRule(editingEntry.templateExerciseId, selectedProgramWeek.id);
      setEditingEntry(null);
    } finally {
      setIsSavingRule(false);
    }
  }

  const weekModeHint =
    weekControl.mode === 'override'
      ? 'Von Hand gesetzt'
      : weekControl.mode === 'derived'
        ? 'Läuft mit dem Kalender'
        : weekControl.mode === 'program'
          ? 'Programm-Woche'
          : 'Ohne Programm';

  return (
    <AppShell title="Programm" eyebrow={program?.name}>
      <div className="space-y-4">
        {/*
          Die eine Limettenfläche dieser Seite liegt auf dem, was *jetzt* dran
          ist, nicht auf der gewählten Zeile. Das Raster darunter ist
          Navigation und deshalb Tinte.
        */}
        {program ? (
          <NowCard
            eyebrow="Diese Woche"
            title={`W${weekControl.effectiveWeek}`}
            subtitle={
              <>
                <span className="block">{weekModeHint}</span>
                <span className="block font-semibold">Heute · {todayStatus}</span>
              </>
            }
          />
        ) : (
          <NowCard eyebrow="Heute" title={todayStatus} />
        )}

        {!program ? (
          <div className="min-h-touch flex items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-3">
            <span className="text-sm font-semibold text-content">Kein Programm aktiv</span>
            <Link
              to="/programs/manage"
              className="min-h-touch inline-flex shrink-0 items-center text-sm text-content-secondary underline"
            >
              Programm verwalten
            </Link>
          </div>
        ) : null}

        <div className="space-y-3">
          <TrainingCalendar
            rows={calendarRows}
            selectedWeek={selectedWeek}
            onSelectWeek={setSelectedWeek}
            onShiftWindow={handleShiftWindow}
          />

          <WeekVolumeTiles week={weekVolume} weekKey={selectedWeek} />

          {/*
            Der Testtermin steht nur in der *gewählten* Woche, nicht als
            weitere Marke im Raster: `ProgramWeek.kind` bleibt beschreibend,
            und der Hinweis führt zu den Tests, statt selbst etwas zu
            schreiben.
          */}
          {selectedRow?.hasTestAppointment ? (
            <Link to="/tests" className="block rounded-panel">
              {selectedRow.testDone ? (
                <DoneRow title="Seitenvergleich gemessen" meta="Zu den Tests" />
              ) : (
                <div className="min-h-touch flex items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-3">
                  <span className="text-sm font-semibold text-content">
                    Seitenvergleich messen
                  </span>
                  <span className="shrink-0 text-xs text-content-muted">Zu den Tests</span>
                </div>
              )}
            </Link>
          ) : null}
        </div>

        {/* Ohne Pfeile: die Liste folgt der Auswahl im Raster. */}
        {selectedRow ? <PlanWeekSection week={selectedRow} /> : null}

        {selectedProgramWeek && overrideCount === 0 && blocks.some((block) => block.entries.length > 0) ? (
          /*
            Ohne Regeln ist die Ansicht nicht leer - sie zeigt jedes Workout
            mit seinen Basiswerten. Die Karte ist deshalb weder limette noch
            waldgrün - eine gefüllte Fläche darf keinen Zustand behaupten, den
            es nicht gibt.
          */
          <Empty
            title="Noch keine Wochen-Vorgaben"
            description="Jede Woche zeigt gerade die Basiswerte aus dem Workout. Tippe eine Zeile an, um genau für diese Woche etwas anderes zu planen."
          />
        ) : null}

        {blocks.length === 0 ? (
          <Empty
            title="Noch kein Workout"
            description="Ein Programm plant die Wochen, die Workouts planen die Übungen. Lege zuerst ein Workout an."
            action={
              <Link
                to="/templates"
                className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-4 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
              >
                Zu den Workouts
              </Link>
            }
          />
        ) : (
          (selectedProgramWeek ? blocks : []).map((block) => (
            <WeekPlanBlockCard
              key={block.templateId}
              block={block}
              bandNameById={bandNameById}
              onEditEntry={handleEditEntry}
            />
          ))
        )}

        <div className="pt-2">
          <Link to="/programs/manage" className="inline-block">
            <Button variant="ghost" size="md">
              Programm verwalten
            </Button>
          </Link>
        </div>
      </div>

      {/*
        Bearbeitet wird im Sheet, nicht auf einer eigenen Seite: die Zeile,
        um die es geht, bleibt dahinter stehen. Der große Knopf sitzt im Fuß,
        der am sichtbaren Viewport hängt - sonst schiebt iOS ihn unter die
        Tastatur, sobald ein Zahlenfeld den Fokus bekommt.
      */}
      <Sheet
        open={editingEntry !== null && selectedProgramWeek !== undefined}
        label={`Woche ${selectedProgramWeek?.weekNumber ?? ''} · ${editingEntry?.exerciseName ?? ''}`}
        closeLabel="Bearbeiten schließen"
        onClose={() => setEditingEntry(null)}
        header={
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-content-muted">
              Woche {selectedProgramWeek?.weekNumber}
            </p>
            <h2 className="mt-0.5 truncate font-display text-[21px] font-extrabold leading-[1.06] tracking-[-0.04em]">
              {editingEntry?.exerciseName}
            </h2>
          </div>
        }
        footer={
          <div className="space-y-2">
            <Button
              variant="primary"
              fullWidth
              onClick={() => void handleSaveRule()}
              disabled={isSavingRule}
            >
              Wochenwerte speichern
            </Button>
            <Button
              variant="ghost"
              fullWidth
              onClick={() => void handleClearRule()}
              // Ohne gespeicherte Regel gibt es nichts zurückzunehmen.
              disabled={isSavingRule || !editingRule}
            >
              Auf Basiswerte zurück
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-content-muted">
            Leer heißt „wie im Workout“ - in den Feldern steht der Basiswert als Platzhalter.
          </p>
          <ProgressionRuleFields
            value={ruleForm}
            onChange={setRuleForm}
            trackingMode={editingEntry?.trackingMode}
            loadKind={editingEntry?.loadKind}
            tracksHeight={editingEntry?.tracksHeight}
            baseTargets={editingBaseTargets}
            bandLevels={bandLevels}
            disabled={isSavingRule}
          />
        </div>
      </Sheet>
    </AppShell>
  );
}

function WeekPlanBlockCard({
  block,
  bandNameById,
  onEditEntry,
}: {
  block: WeekPlanBlock;
  bandNameById: Record<string, string>;
  /** Fehlt, solange das Programm keine Wochen hat - dann gibt es nichts zu planen. */
  onEditEntry?: (entry: WeekPlanEntry) => void;
}) {
  /*
   * Supersätze bleiben sichtbar zusammen: `buildWeekPlan` liefert die
   * Mitglieder zusammenhängend, hier werden aufeinanderfolgende Einträge
   * derselben Gruppe unter eine Klammer gelegt - dieselbe wie in der
   * Workout-Liste.
   */
  const groups: WeekPlanEntry[][] = [];

  for (const entry of block.entries) {
    const previous = groups[groups.length - 1];
    const belongsToPrevious =
      entry.supersetGroupId !== undefined &&
      previous?.[0]?.supersetGroupId === entry.supersetGroupId;

    if (belongsToPrevious) {
      previous.push(entry);
    } else {
      groups.push([entry]);
    }
  }

  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-soft">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="min-w-0 truncate text-base font-semibold text-content">
          {block.templateName}
        </h2>
        <p className="shrink-0 text-xs text-content-muted">
          {block.entries.length === 1 ? '1 Übung' : `${block.entries.length} Übungen`}
        </p>
      </div>

      {block.entries.length === 0 ? (
        <p className="text-sm text-content-muted">In diesem Workout steht noch keine Übung.</p>
      ) : (
        <div className="space-y-2">
          {groups.map((group) =>
            group.length > 1 && group[0].supersetGroupId ? (
              <SupersetBlock
                key={group[0].supersetGroupId}
                exerciseNames={group.map((entry) => entry.exerciseName)}
              >
                {group.map((entry) => (
                  <WeekPlanRow
                    key={entry.templateExerciseId}
                    entry={entry}
                    bandNameById={bandNameById}
                    onEdit={onEditEntry}
                  />
                ))}
              </SupersetBlock>
            ) : (
              <WeekPlanRow
                key={group[0].templateExerciseId}
                entry={group[0]}
                bandNameById={bandNameById}
                onEdit={onEditEntry}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}

function WeekPlanRow({
  entry,
  bandNameById,
  onEdit,
}: {
  entry: WeekPlanEntry;
  bandNameById: Record<string, string>;
  onEdit?: (entry: WeekPlanEntry) => void;
}) {
  const segments = describeWeekPrescription(entry, bandNameById);
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-content">{entry.exerciseName}</p>
        {entry.overriddenFields.length > 0 ? (
          /*
            Neutral, nicht limette und nicht waldgrün: "kommt aus dieser
            Woche" ist keiner der drei Zustände, die Farbe in dieser App
            bedeutet.
          */
          <span className="shrink-0 rounded-control border border-line-strong px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-content-secondary">
            Woche
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 text-sm">
        {segments.map((segment, index) => (
          <PrescriptionSegmentText key={segment.text} segment={segment} isFirst={index === 0} />
        ))}
      </p>
    </>
  );

  const shellClasses = 'w-full rounded-panel border border-line bg-surface-sunken px-3 py-2 text-left';

  if (!onEdit) {
    return <div className={shellClasses}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onEdit(entry)}
      aria-label={`${entry.exerciseName} für diese Woche planen`}
      className={cn(
        shellClasses,
        'min-h-touch transition hover:bg-surface-raised',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      )}
    >
      {body}
    </button>
  );
}

/** Basiswert gedämpft, Wochenwert in Tinte - der Unterschied je Feld. */
function PrescriptionSegmentText({
  segment,
  isFirst,
}: {
  segment: PrescriptionSegment;
  isFirst: boolean;
}) {
  return (
    <>
      {isFirst ? null : <span className="text-content-muted"> · </span>}
      <span
        className={cn(
          'tabular-nums',
          segment.overridden ? 'font-semibold text-content' : 'text-content-muted',
        )}
      >
        {segment.text}
      </span>
    </>
  );
}
