import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/AppShell';
import { Empty } from '@/components/Empty';
import { ProgressionRuleFields } from '@/components/ProgressionRuleFields';
import { SupersetBlock } from '@/components/SupersetBlock';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { NowCard } from '@/components/ui/StatusCard';
import { db } from '@/db/appDb';
import { clearProgressionRule, saveProgressionRule } from '@/db/template-actions';
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
import { resolveWeekControl } from '@/domain/program';
import { cn } from '@/lib/utils';

/**
 * Was ist in Woche 3 geplant?
 *
 * Der Reiter zeigte bisher ausschließlich CRUD auf Programm und Woche - der
 * *Inhalt* eines Programms, die Progressionsregeln, kam hier gar nicht vor.
 * Diese Seite beantwortet die Frage, für die es den Reiter gibt, und zwar mit
 * `buildWeekPlan`, also mit derselben Faltung, die der Sessionstart schreibt.
 *
 * Was sie bewusst nicht kann: ein Training starten. Es gibt im Datenmodell
 * keine Verbindung Woche → Workout - alle Workouts laufen in jeder Woche -
 * und die Seite sagt das offen, statt eine Reihenfolge zu erfinden.
 */
export function ProgramsPage() {
  /*
   * Die Wochenauswahl ist reiner Oberflächenzustand - nie `weekOverride`, nie
   * IndexedDB. Woche 5 *ansehen* darf nicht Woche 5 *trainieren*: ein
   * Override schlägt Startdatum und Programm-Woche, bis ihn jemand
   * zurücknimmt, und genau dieser Fehler stand auf einem echten Gerät
   * wochenlang. Es gibt einen Schreiber auf `weekOverride`, und der sitzt in
   * den Einstellungen.
   */
  const [selectedWeekNumber, setSelectedWeekNumber] = useState<number | null>(null);
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
  const selectedWeek = selectedWeekNumber ?? weekControl.effectiveWeek;
  const selectedProgramWeek = (weeks ?? []).find((week) => week.weekNumber === selectedWeek);

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
  const editingBaseTargets = editingEntry
    ? foldProgressionRule(
        (templateExercises ?? []).find((item) => item.id === editingEntry.templateExerciseId) ?? {},
      )
    : undefined;

  function handleEditEntry(entry: WeekPlanEntry) {
    /*
     * Bearbeitet wird der **Plan**, nie eine laufende Ausführung: von hier
     * führt kein Weg zu einer `WorkoutSessionExercise`. Deshalb gibt es auf
     * dieser Seite auch keinen Startknopf - der Start löst die Woche über
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

  if (!program) {
    return (
      <AppShell title="Programm">
        <Empty
          title="Kein Programm aktiv"
          description="Ein Programm gibt den Wochen ihre Struktur. Lege eines an und wähle es in den Einstellungen aus."
          action={
            <Link
              to="/programs/manage"
              className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-4 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
            >
              Programm verwalten
            </Link>
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell title="Programm" eyebrow={program.name}>
      <div className="space-y-4">
        {/*
          Die eine Limettenfläche dieser Seite liegt auf der *wirksamen*
          Woche, nicht auf dem gewählten Chip: "jetzt dran" ist die Woche, in
          der die nächste Einheit tatsächlich startet. Die Auswahl darunter
          ist Navigation und deshalb Tinte.
        */}
        <NowCard
          eyebrow="Diese Woche"
          title={`W${weekControl.effectiveWeek}`}
          subtitle={weekModeHint}
        />

        {(weeks?.length ?? 0) > 0 ? (
          <div>
            {/*
              Waagerecht scrollend statt umbrechend: jeder Chip muss 44px
              halten, und bei 320px passen etwa sechs davon nebeneinander.
              `-mx-4 px-4` lässt den Streifen bis an den Bildschirmrand
              laufen, damit sichtbar ist, dass es weitergeht.
            */}
            <div
              role="tablist"
              aria-label="Programmwoche wählen"
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
            >
              {(weeks ?? []).map((week) => {
                const isSelected = week.weekNumber === selectedWeek;

                return (
                  <button
                    key={week.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setSelectedWeekNumber(week.weekNumber)}
                    className={cn(
                      'min-h-touch min-w-touch shrink-0 rounded-control border px-3 font-display text-sm font-bold tabular-nums transition',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      isSelected
                        ? 'border-transparent bg-accent text-accent-contrast'
                        : 'border-line bg-surface text-content-secondary hover:bg-surface-raised',
                    )}
                  >
                    W{week.weekNumber}
                  </button>
                );
              })}
            </div>

            <p className="mt-3 px-1 text-sm font-semibold text-content">
              {selectedProgramWeek?.label ?? `Woche ${selectedWeek}`}
            </p>
          </div>
        ) : null}

        {overrideCount === 0 && blocks.some((block) => block.entries.length > 0) ? (
          /*
            Ohne Regeln ist die Ansicht nicht leer - sie zeigt jedes Workout
            mit seinen Basiswerten. Das *ist* die wahre Antwort auf "was ist
            in dieser Woche geplant": dasselbe wie in jeder anderen. Die Karte
            ist deshalb weder limette noch waldgrün - eine gefüllte Fläche
            darf keinen Zustand behaupten, den es nicht gibt.
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
          blocks.map((block) => (
            <WeekPlanBlockCard
              key={block.templateId}
              block={block}
              bandNameById={bandNameById}
              onEditEntry={selectedProgramWeek ? handleEditEntry : undefined}
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
        label={`Woche ${selectedWeek} · ${editingEntry?.exerciseName ?? ''}`}
        closeLabel="Bearbeiten schließen"
        onClose={() => setEditingEntry(null)}
        header={
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-content-muted">
              Woche {selectedWeek}
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
