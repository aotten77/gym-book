import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SectionCard } from '@/components/SectionCard';
import { clearProgressionRule, saveProgressionRule } from '@/db/template-actions';
import type {
  AppSettings,
  Exercise,
  Program,
  ProgramWeek,
  ProgressionRule,
  WorkoutTemplateExercise,
} from '@/domain/models';
import { supportsReps, supportsSeconds, supportsWeight } from '@/domain/tracking';

interface ProgressionRuleFormState {
  targetReps: string;
  targetSeconds: string;
  targetWeight: string;
  notes: string;
}

const defaultProgressionRuleFormState: ProgressionRuleFormState = {
  targetReps: '',
  targetSeconds: '',
  targetWeight: '',
  notes: '',
};

function numberToInputValue(value?: number) {
  return typeof value === 'number' ? String(value) : '';
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildProgressionRuleFormState(rule?: {
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  notes?: string;
}): ProgressionRuleFormState {
  return {
    targetReps: numberToInputValue(rule?.targetReps),
    targetSeconds: numberToInputValue(rule?.targetSeconds),
    targetWeight: numberToInputValue(rule?.targetWeight),
    notes: rule?.notes ?? '',
  };
}

function formatPrescriptionLine(input: {
  workSetCount: number;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  restSeconds?: number;
}) {
  const parts = [
    input.targetReps ? `${input.workSetCount} x ${input.targetReps} Wdh` : null,
    input.targetSeconds ? `${input.workSetCount} x ${input.targetSeconds}s` : null,
    typeof input.targetWeight === 'number' ? `${input.targetWeight} kg` : null,
    typeof input.restSeconds === 'number' ? `Pause ${input.restSeconds}s` : null,
  ].filter(Boolean);

  return parts.join(' · ') || 'Keine Zielwerte gesetzt';
}

interface TemplateProgressionSectionProps {
  programs: Program[] | undefined;
  programWeeks: ProgramWeek[] | undefined;
  progressionRules: ProgressionRule[] | undefined;
  orderedTemplateExercises: WorkoutTemplateExercise[];
  exerciseById: Record<string, Exercise>;
  nameById: Record<string, string>;
  activeProgramId: AppSettings['activeProgramId'];
}

/**
 * Pro Programmwoche Zielwerte fuer eine Template-Uebung ueberschreiben. Der
 * Block ist bewusst eigenstaendig - er teilt bis auf Nachschlagetabellen
 * (Uebungen, Programme, Wochen) keinen State mit dem Rest der Template-Seite.
 */
export function TemplateProgressionSection({
  programs,
  programWeeks,
  progressionRules,
  orderedTemplateExercises,
  exerciseById,
  nameById,
  activeProgramId,
}: TemplateProgressionSectionProps) {
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedProgressionTemplateExerciseId, setSelectedProgressionTemplateExerciseId] =
    useState<string>('');
  const [progressionFormsByWeekId, setProgressionFormsByWeekId] = useState<
    Record<string, ProgressionRuleFormState>
  >({});
  const [isSavingProgressionRule, setIsSavingProgressionRule] = useState(false);

  const selectedProgressionTemplateExercise = useMemo(
    () => orderedTemplateExercises.find((item) => item.id === selectedProgressionTemplateExerciseId),
    [orderedTemplateExercises, selectedProgressionTemplateExerciseId],
  );
  const selectedProgressionExercise = selectedProgressionTemplateExercise?.exerciseId
    ? exerciseById[selectedProgressionTemplateExercise.exerciseId]
    : undefined;
  const selectedProgramWeeks = useMemo(
    () =>
      [...(programWeeks ?? [])]
        .filter((week) => week.programId === selectedProgramId)
        .sort((left, right) => left.weekNumber - right.weekNumber),
    [programWeeks, selectedProgramId],
  );
  const selectedProgressionRulesByWeekId = useMemo(() => {
    if (!selectedProgressionTemplateExerciseId) {
      return {};
    }

    const relevantWeekIds = new Set(selectedProgramWeeks.map((week) => week.id));

    return Object.fromEntries(
      (progressionRules ?? [])
        .filter(
          (rule) =>
            rule.templateExerciseId === selectedProgressionTemplateExerciseId &&
            relevantWeekIds.has(rule.programWeekId),
        )
        .map((rule) => [rule.programWeekId, rule]),
    );
  }, [progressionRules, selectedProgramWeeks, selectedProgressionTemplateExerciseId]);

  useEffect(() => {
    const availableProgramIds = (programs ?? []).map((program) => program.id);

    if (availableProgramIds.length === 0) {
      if (selectedProgramId) {
        setSelectedProgramId('');
      }
      return;
    }

    const preferredProgramId = activeProgramId ?? availableProgramIds[0];

    if (!selectedProgramId || !availableProgramIds.includes(selectedProgramId)) {
      setSelectedProgramId(preferredProgramId);
    }
  }, [activeProgramId, programs, selectedProgramId]);

  useEffect(() => {
    const availableTemplateExerciseIds = orderedTemplateExercises.map((item) => item.id);

    if (availableTemplateExerciseIds.length === 0) {
      if (selectedProgressionTemplateExerciseId) {
        setSelectedProgressionTemplateExerciseId('');
      }
      return;
    }

    if (
      !selectedProgressionTemplateExerciseId ||
      !availableTemplateExerciseIds.includes(selectedProgressionTemplateExerciseId)
    ) {
      setSelectedProgressionTemplateExerciseId(availableTemplateExerciseIds[0]);
    }
  }, [orderedTemplateExercises, selectedProgressionTemplateExerciseId]);

  useEffect(() => {
    if (selectedProgramWeeks.length === 0) {
      setProgressionFormsByWeekId({});
      return;
    }

    setProgressionFormsByWeekId(
      Object.fromEntries(
        selectedProgramWeeks.map((week) => [
          week.id,
          buildProgressionRuleFormState(selectedProgressionRulesByWeekId[week.id]),
        ]),
      ),
    );
  }, [selectedProgramWeeks, selectedProgressionRulesByWeekId]);

  async function handleSaveProgressionForWeek(programWeekId: string) {
    if (!selectedProgressionTemplateExercise) {
      return;
    }

    const draft = progressionFormsByWeekId[programWeekId] ?? defaultProgressionRuleFormState;

    setIsSavingProgressionRule(true);

    try {
      await saveProgressionRule({
        templateExerciseId: selectedProgressionTemplateExercise.id,
        programWeekId,
        targetReps: supportsReps(selectedProgressionExercise?.trackingMode)
          ? parseOptionalNumber(draft.targetReps)
          : undefined,
        targetSeconds: supportsSeconds(selectedProgressionExercise?.trackingMode)
          ? parseOptionalNumber(draft.targetSeconds)
          : undefined,
        targetWeight: supportsWeight(selectedProgressionExercise?.trackingMode)
          ? parseOptionalNumber(draft.targetWeight)
          : undefined,
        notes: draft.notes,
      });
    } finally {
      setIsSavingProgressionRule(false);
    }
  }

  async function handleClearProgressionForWeek(programWeekId: string) {
    if (!selectedProgressionTemplateExercise) {
      return;
    }

    setIsSavingProgressionRule(true);

    try {
      await clearProgressionRule(selectedProgressionTemplateExercise.id, programWeekId);
      setProgressionFormsByWeekId((current) => ({
        ...current,
        [programWeekId]: defaultProgressionRuleFormState,
      }));
    } finally {
      setIsSavingProgressionRule(false);
    }
  }

  return (
    <SectionCard
      title="Wochenprogression"
      subtitle="Pro Programmwoche kannst du Zielwerte fuer diese Vorlage ueberschreiben. Beim Session-Start wird genau diese Stufe als Snapshot uebernommen."
      action={
        <Link
          to="/programs"
          className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
        >
          Programme
        </Link>
      }
    >
      {(programs?.length ?? 0) === 0 ? (
        <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
          Lege zuerst ein Programm mit Wochen an, damit du Wochen-Overrides pflegen kannst.
        </div>
      ) : orderedTemplateExercises.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
          Fuege zuerst eine Template-Uebung hinzu. Danach kannst du hier die Progression je Woche editieren.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={selectedProgramId}
              onChange={(event) => setSelectedProgramId(event.target.value)}
              className="select-control w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            >
              {(programs ?? []).map((program) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </select>
            <select
              value={selectedProgressionTemplateExerciseId}
              onChange={(event) => setSelectedProgressionTemplateExerciseId(event.target.value)}
              className="select-control w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            >
              {orderedTemplateExercises.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.orderIndex}. {nameById[item.exerciseId] ?? 'Unbekannte Uebung'}
                </option>
              ))}
            </select>
          </div>

          {selectedProgressionTemplateExercise ? (
            <div className="rounded-panel bg-surface p-4 text-sm text-content-muted">
              <p className="font-semibold text-content">
                {nameById[selectedProgressionTemplateExercise.exerciseId] ?? 'Unbekannte Uebung'}
              </p>
              <p className="mt-2">Basis: {formatPrescriptionLine(selectedProgressionTemplateExercise)}</p>
              <p className="mt-1">
                Tracking: {selectedProgressionExercise?.trackingMode ?? 'reps_weight'} ·{' '}
                {selectedProgressionExercise?.unilateral ? 'unilateral' : 'beidseitig'}
              </p>
            </div>
          ) : null}

          {selectedProgramWeeks.length > 0 ? (
            <div className="space-y-3">
              {selectedProgramWeeks.map((week) => {
                const draft = progressionFormsByWeekId[week.id] ?? defaultProgressionRuleFormState;
                const hasSavedRule = Boolean(selectedProgressionRulesByWeekId[week.id]);

                return (
                  <div key={week.id} className="rounded-panel border border-line bg-surface p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-content">
                          W{week.weekNumber}
                          {week.label ? ` · ${week.label}` : ''}
                        </p>
                        <p className="mt-1 text-xs text-content-muted">
                          Leer lassen = Basiswerte der Template-Uebung verwenden
                        </p>
                      </div>
                      {hasSavedRule ? (
                        <span className="min-h-touch inline-flex items-center justify-center rounded-control bg-accent-soft px-3 py-2 text-xs font-medium text-accent">
                          Override aktiv
                        </span>
                      ) : null}
                    </div>

                    <div className="space-y-3">
                      {supportsReps(selectedProgressionExercise?.trackingMode) ? (
                        <input
                          value={draft.targetReps}
                          onChange={(event) =>
                            setProgressionFormsByWeekId((current) => ({
                              ...current,
                              [week.id]: {
                                ...(current[week.id] ?? defaultProgressionRuleFormState),
                                targetReps: event.target.value,
                              },
                            }))
                          }
                          inputMode="numeric"
                          aria-label="Ziel-Wdh"
                          placeholder="Ziel-Wdh"
                          className="w-full rounded-panel border border-line bg-surface-sunken px-4 py-4 text-sm text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                        />
                      ) : null}

                      {supportsSeconds(selectedProgressionExercise?.trackingMode) ? (
                        <input
                          value={draft.targetSeconds}
                          onChange={(event) =>
                            setProgressionFormsByWeekId((current) => ({
                              ...current,
                              [week.id]: {
                                ...(current[week.id] ?? defaultProgressionRuleFormState),
                                targetSeconds: event.target.value,
                              },
                            }))
                          }
                          inputMode="decimal"
                          aria-label="Ziel-Sekunden"
                          placeholder="Ziel-Sekunden"
                          className="w-full rounded-panel border border-line bg-surface-sunken px-4 py-4 text-sm text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                        />
                      ) : null}

                      {supportsWeight(selectedProgressionExercise?.trackingMode) ? (
                        <input
                          value={draft.targetWeight}
                          onChange={(event) =>
                            setProgressionFormsByWeekId((current) => ({
                              ...current,
                              [week.id]: {
                                ...(current[week.id] ?? defaultProgressionRuleFormState),
                                targetWeight: event.target.value,
                              },
                            }))
                          }
                          inputMode="decimal"
                          aria-label="Ziel-Gewicht in kg"
                          placeholder="Ziel-Gewicht in kg"
                          className="w-full rounded-panel border border-line bg-surface-sunken px-4 py-4 text-sm text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                        />
                      ) : null}

                      <textarea
                        value={draft.notes}
                        onChange={(event) =>
                          setProgressionFormsByWeekId((current) => ({
                            ...current,
                            [week.id]: {
                              ...(current[week.id] ?? defaultProgressionRuleFormState),
                              notes: event.target.value,
                            },
                          }))
                        }
                        rows={2}
                        aria-label="Wochen-spezifische Notiz"
                        placeholder="Wochen-spezifische Notiz"
                        className="w-full rounded-panel border border-line bg-surface-sunken px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                      />

                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => handleSaveProgressionForWeek(week.id)}
                          disabled={isSavingProgressionRule}
                          className="rounded-panel bg-accent px-4 py-4 text-sm font-semibold text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Wochenwerte speichern
                        </button>
                        <button
                          type="button"
                          onClick={() => handleClearProgressionForWeek(week.id)}
                          disabled={isSavingProgressionRule}
                          className="rounded-panel bg-surface-raised px-4 py-4 text-sm font-medium text-content-secondary transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Override entfernen
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
              Dieses Programm hat noch keine Wochen. Fuege sie in der Programm-Verwaltung hinzu.
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
