import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ProgressionRuleFields } from '@/components/ProgressionRuleFields';
import { SectionCard } from '@/components/SectionCard';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/Field';
import { clearProgressionRule, saveProgressionRule } from '@/db/template-actions';
import type {
  AppSettings,
  BandLevel,
  Exercise,
  Program,
  ProgramWeek,
  ProgressionRule,
  WorkoutTemplateExercise,
} from '@/domain/models';
import { describeWeekPrescription } from '@/domain/program-plan';
import { foldProgressionRule, overriddenTargetFields } from '@/domain/progression-fold';
import {
  buildProgressionRuleForm,
  emptyProgressionRuleForm,
  toProgressionRuleInput,
  type ProgressionRuleFormState,
} from '@/domain/progression-rule-form';

interface TemplateProgressionSectionProps {
  programs: Program[] | undefined;
  programWeeks: ProgramWeek[] | undefined;
  progressionRules: ProgressionRule[] | undefined;
  orderedTemplateExercises: WorkoutTemplateExercise[];
  exerciseById: Record<string, Exercise>;
  nameById: Record<string, string>;
  /** Band-Katalog, leicht nach schwer - Auswahl für Band-Übungen. */
  bandLevels: BandLevel[] | undefined;
  activeProgramId: AppSettings['activeProgramId'];
}

/**
 * Eine Übung über alle Wochen - die transponierte Achse zur Wochenansicht.
 *
 * `/programs` zeigt eine Woche über alle Workouts; hier steht eine Übung
 * über alle Wochen untereinander, und für das *Anlegen* einer Progression
 * ("Nordic Curl: 12/14/16/18 s") ist das der richtige Schnitt.
 *
 * Die Programm-Auswahl ist weg: Regeln gelten für das **aktive** Programm,
 * und welches das ist, entscheiden die Einstellungen. Ein zweites Auswahlfeld
 * hier hätte erlaubt, Regeln in ein Programm zu schreiben, das nirgends
 * wirkt - und genau das ist beim Start eines Trainings nicht mehr zu sehen.
 */
export function TemplateProgressionSection({
  programs,
  programWeeks,
  progressionRules,
  orderedTemplateExercises,
  exerciseById,
  nameById,
  bandLevels,
  activeProgramId,
}: TemplateProgressionSectionProps) {
  const bandNameById = useMemo(
    () => Object.fromEntries((bandLevels ?? []).map((band) => [band.id, band.name])),
    [bandLevels],
  );
  const [selectedProgressionTemplateExerciseId, setSelectedProgressionTemplateExerciseId] =
    useState<string>('');
  const [progressionFormsByWeekId, setProgressionFormsByWeekId] = useState<
    Record<string, ProgressionRuleFormState>
  >({});
  const [isSavingProgressionRule, setIsSavingProgressionRule] = useState(false);

  const activeProgram = (programs ?? []).find((program) => program.id === activeProgramId);
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
        .filter((week) => week.programId === activeProgramId)
        .sort((left, right) => left.weekNumber - right.weekNumber),
    [programWeeks, activeProgramId],
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
          buildProgressionRuleForm(selectedProgressionRulesByWeekId[week.id]),
        ]),
      ),
    );
  }, [selectedProgramWeeks, selectedProgressionRulesByWeekId]);

  /** Die Basiswerte der Übung - Platzhalter in den Feldern und Kopfzeile. */
  const baseTargets = selectedProgressionTemplateExercise
    ? foldProgressionRule(selectedProgressionTemplateExercise)
    : undefined;

  async function handleSaveProgressionForWeek(programWeekId: string) {
    if (!selectedProgressionTemplateExercise) {
      return;
    }

    const draft = progressionFormsByWeekId[programWeekId] ?? emptyProgressionRuleForm;

    setIsSavingProgressionRule(true);

    try {
      await saveProgressionRule({
        templateExerciseId: selectedProgressionTemplateExercise.id,
        programWeekId,
        ...toProgressionRuleInput(draft, selectedProgressionExercise),
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
        [programWeekId]: emptyProgressionRuleForm,
      }));
    } finally {
      setIsSavingProgressionRule(false);
    }
  }

  return (
    <SectionCard
      title="Wochenprogression"
      subtitle={
        activeProgram
          ? `Zielwerte je Woche in „${activeProgram.name}“. Beim Start des Trainings gilt genau die Stufe der aktiven Woche.`
          : 'Pro Programmwoche kannst du Zielwerte für dieses Workout überschreiben.'
      }
      action={
        <Link
          to="/programs"
          className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
        >
          Wochen
        </Link>
      }
    >
      {!activeProgram ? (
        <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
          Es ist kein Programm aktiv. Lege eines an und wähle es in den Einstellungen aus, damit du
          Wochenwerte pflegen kannst.
        </div>
      ) : orderedTemplateExercises.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
          Füge zuerst eine Übung hinzu. Danach kannst du hier die Progression je Woche pflegen.
        </div>
      ) : (
        <div className="space-y-4">
          <SelectField
            label="Übung"
            value={selectedProgressionTemplateExerciseId}
            onChange={(event) => setSelectedProgressionTemplateExerciseId(event.target.value)}
          >
            {orderedTemplateExercises.map((item) => (
              <option key={item.id} value={item.id}>
                {item.orderIndex}. {nameById[item.exerciseId] ?? 'Unbekannte Übung'}
              </option>
            ))}
          </SelectField>

          {selectedProgressionTemplateExercise && baseTargets ? (
            <div className="rounded-panel bg-surface p-4 text-sm text-content-muted">
              <p className="font-semibold text-content">
                {nameById[selectedProgressionTemplateExercise.exerciseId] ?? 'Unbekannte Übung'}
              </p>
              {/*
                Dieselbe Formatierung wie in der Wochenansicht: zwei
                Formatierer sind der Weg, auf dem "3 × 8-10" und "3 x 8 Wdh"
                auf zwei Bildschirmen landen.
              */}
              <p className="mt-2">
                Basis:{' '}
                {describeWeekPrescription({ effective: baseTargets, overriddenFields: [] }, bandNameById)
                  .map((segment) => segment.text)
                  .join(' · ') || 'Keine Zielwerte gesetzt'}
              </p>
            </div>
          ) : null}

          {selectedProgramWeeks.length > 0 ? (
            <div className="space-y-3">
              {selectedProgramWeeks.map((week) => {
                const draft = progressionFormsByWeekId[week.id] ?? emptyProgressionRuleForm;
                const savedRule = selectedProgressionRulesByWeekId[week.id];
                const overriddenCount = overriddenTargetFields(savedRule).length;

                return (
                  <div key={week.id} className="rounded-panel border border-line bg-surface p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-content">
                          W{week.weekNumber}
                          {week.label ? ` · ${week.label}` : ''}
                        </p>
                        <p className="mt-1 text-xs text-content-muted">
                          Leer heißt „wie im Workout“
                        </p>
                      </div>
                      {overriddenCount > 0 ? (
                        <span className="shrink-0 rounded-control border border-line-strong px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-content-secondary">
                          Woche
                        </span>
                      ) : null}
                    </div>

                    <ProgressionRuleFields
                      value={draft}
                      onChange={(next) =>
                        setProgressionFormsByWeekId((current) => ({ ...current, [week.id]: next }))
                      }
                      trackingMode={selectedProgressionExercise?.trackingMode}
                      loadKind={selectedProgressionExercise?.loadKind}
                      tracksHeight={selectedProgressionExercise?.tracksHeight}
                      baseTargets={baseTargets}
                      bandLevels={bandLevels}
                      disabled={isSavingProgressionRule}
                    />

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => void handleSaveProgressionForWeek(week.id)}
                        disabled={isSavingProgressionRule}
                      >
                        Wochenwerte speichern
                      </Button>
                      <Button
                        variant="ghost"
                        size="md"
                        onClick={() => void handleClearProgressionForWeek(week.id)}
                        disabled={isSavingProgressionRule || !savedRule}
                      >
                        Auf Basiswerte zurück
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
              Dieses Programm hat noch keine Wochen. Füge sie in der Programm-Verwaltung hinzu.
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
