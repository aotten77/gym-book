import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronRight, ImageOff, Play, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Alert } from '@/components/Alert';
import { Empty } from '@/components/Empty';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { SectionCard } from '@/components/SectionCard';
import { SupersetBlock } from '@/components/SupersetBlock';
import { Button } from '@/components/ui/Button';
import { DoneRow, NowCard } from '@/components/ui/StatusCard';
import { db } from '@/db/appDb';
import { loadTemplateRecency, loadWeekSummary } from '@/db/history-queries';
import { startSessionFromTemplate } from '@/db/session-actions';
import { createTemplate } from '@/db/template-actions';
import { startOfCalendarWeek } from '@/domain/calendar-week';
import type { WorkoutTemplateExercise } from '@/domain/models';
import { pickNextTemplate } from '@/domain/next-workout';
import { buildSupersetBlocks } from '@/domain/superset';
import { formatDateTime, formatNumber } from '@/lib/format';

export function TemplatesPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const templates = useLiveQuery(() => db.workoutTemplates.toArray(), []);
  const templateExercises = useLiveQuery(() => db.workoutTemplateExercises.toArray(), []);
  const exercises = useLiveQuery(() => db.exercises.toArray(), []);
  const bandLevels = useLiveQuery(() => db.bandLevels.toArray(), []);
  const mediaAssets = useLiveQuery(() => db.mediaAssets.toArray(), []);
  const templateRecency = useLiveQuery(() => loadTemplateRecency(), []);
  const weekSummary = useLiveQuery(
    () => loadWeekSummary(startOfCalendarWeek(new Date()).toISOString()),
    [],
  );

  const exerciseById = Object.fromEntries((exercises ?? []).map((item) => [item.id, item]));
  const bandNameById = Object.fromEntries((bandLevels ?? []).map((band) => [band.id, band.name]));
  const mediaAssetById = Object.fromEntries((mediaAssets ?? []).map((asset) => [asset.id, asset]));

  const nextTemplate = pickNextTemplate(templates ?? [], templateRecency ?? {});
  const nextTemplateExerciseCount = (templateExercises ?? []).filter(
    (item) => item.templateId === nextTemplate?.id,
  ).length;

  async function handleCreateTemplate() {
    if (!name.trim()) {
      return;
    }

    setIsSaving(true);

    try {
      const templateId = await createTemplate({ name, notes });
      setName('');
      setNotes('');
      navigate(`/templates/${templateId}`);
    } finally {
      setIsSaving(false);
    }
  }

  /*
   * Von hier ließ sich bisher kein Training starten - man musste zurück auf
   * die Startseite, obwohl man genau vor der Liste der Workouts stand.
   */
  async function handleStartSession(templateId: string) {
    setIsStartingSession(true);

    try {
      const sessionId = await startSessionFromTemplate(templateId);
      setStartError(null);
      navigate(`/session/${sessionId}`);
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : 'Session konnte nicht gestartet werden.',
      );
      setIsStartingSession(false);
    }
  }

  /**
   * Eine Übungszeile der Übersicht.
   *
   * Als Funktion und nicht inline, weil dieselbe Zeile an zwei Stellen der
   * Liste steht: allein und als Mitglied eines Supersatz-Blocks.
   */
  function renderTemplateExerciseRow(templateId: string, item: WorkoutTemplateExercise) {
    const exercise = exerciseById[item.exerciseId];
    const media = exercise?.mediaAssetId ? mediaAssetById[exercise.mediaAssetId] : undefined;

    return (
      <Link
        key={item.id}
        to={`/templates/${templateId}`}
        className="flex items-center gap-3 rounded-panel border border-line bg-surface px-3 py-3"
      >
        {/*
          Derselbe Rahmen wie in der Übungsbibliothek: `ExerciseMedia` rendert
          ohne Bild `null`, und ohne festen Platzhalter sprängen die Zeilen je
          nachdem, ob eine Übung ein Bild hat.
        */}
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-surface-raised text-content-muted">
          {media ? (
            <ExerciseMedia
              mediaAsset={media}
              alt=""
              className="h-full w-full rounded-none border-0"
              imageClassName="h-full w-full"
            />
          ) : (
            <ImageOff size={18} aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-content">
            {item.orderIndex}. {exercise?.name ?? 'Unbekannte Übung'}
          </p>
          <p className="mt-1 text-sm text-content-muted">
            {item.targetReps ? `${item.workSetCount} x ${item.targetReps} Wdh` : null}
            {item.targetReps && item.targetSeconds ? ' · ' : null}
            {item.targetSeconds ? `${item.workSetCount} x ${item.targetSeconds}s` : null}
            {item.targetWeight ? ` · ${formatNumber(item.targetWeight)} kg` : ''}
            {item.targetBandId ? ` · ${bandNameById[item.targetBandId] ?? 'Band'}` : ''}
          </p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-content-muted" />
      </Link>
    );
  }

  return (
    <AppShell title="Workouts">
      <div className="space-y-4">
        {startError ? <Alert>{startError}</Alert> : null}

        {/* Das eine Limettenfeld dieser Seite - dieselbe Heuristik wie auf der Startseite. */}
        {nextTemplate ? (
          <NowCard
            eyebrow="Am längsten her"
            title={nextTemplate.name}
            subtitle={nextTemplateExerciseCount === 1 ? '1 Übung' : `${nextTemplateExerciseCount} Übungen`}
            onClick={() => void handleStartSession(nextTemplate.id)}
            disabled={isStartingSession}
            action={
              <span className="flex h-11 w-11 items-center justify-center rounded-control bg-accent text-accent-contrast">
                <Play size={18} />
              </span>
            }
          />
        ) : null}

        {/*
          Waldgrün darf sich wiederholen: erledigt sind mehrere Einheiten
          gleichzeitig, und eine Zeile reicht dafür - "fertig" braucht wenig
          Platz, im Gegensatz zu dem, was als Nächstes ansteht.
        */}
        {weekSummary && weekSummary.sessions.length > 0 ? (
          <section className="space-y-2">
            <h2 className="px-1 text-xs font-bold uppercase tracking-[0.16em] text-content-muted">
              Diese Woche erledigt
            </h2>
            {weekSummary.sessions.map((session) => (
              <DoneRow
                key={session.id}
                title={session.templateName}
                meta={formatDateTime(session.completedAt)}
                icon={<Check size={16} strokeWidth={3} aria-hidden="true" />}
              />
            ))}
          </section>
        ) : null}

        {(templates ?? []).map((template) => {
          const items = (templateExercises ?? [])
            .filter((item) => item.templateId === template.id)
            .sort((left, right) => left.orderIndex - right.orderIndex);
          /*
           * Dieselbe Klammer wie in der Bearbeiten-Ansicht und im Verlauf.
           * Vorher stand hier nur „· Supersatz“ am Ende der Zieldaten - der
           * Zusammenhang ist aber eine Eigenschaft *zwischen* zwei Zeilen, und
           * als Wort in der einen Zeile war nicht zu sehen, mit welcher
           * anderen sie zusammengehört.
           */
          const blocks = buildSupersetBlocks(items);

          return (
            <SectionCard
              key={template.id}
              title={template.name}
              subtitle={`${items.length} Übungen`}
              action={
                <Link
                  to={`/templates/${template.id}`}
                  className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
                >
                  Bearbeiten
                </Link>
              }
            >
              <div className="space-y-3">
                {items.length > 0 ? (
                  blocks.map((block) =>
                    block.kind === 'single' ? (
                      renderTemplateExerciseRow(template.id, block.exercise)
                    ) : (
                      <SupersetBlock
                        key={block.groupId}
                        exerciseNames={block.exercises.map(
                          (entry) => exerciseById[entry.exerciseId]?.name ?? 'Unbekannte Übung',
                        )}
                      >
                        {block.exercises.map((entry) =>
                          renderTemplateExerciseRow(template.id, entry),
                        )}
                      </SupersetBlock>
                    ),
                  )
                ) : (
                  <Empty
                    title="Noch keine Übungen"
                    description="Im Detailscreen referenzierst du bestehende Übungen oder legst neue an."
                  />
                )}
              </div>
            </SectionCard>
          );
        })}

        {/*
          Anlegen steht unter der Liste, nicht darüber: die Seite wird
          überwiegend gelesen und gestartet, nicht befüllt.
        */}
        <SectionCard
          title="Neues Workout"
          subtitle="Erst benennen, dann im Detail mit Übungen füllen."
          action={
            <div className="flex h-10 w-10 items-center justify-center rounded-control bg-accent-soft text-accent">
              <Plus size={18} />
            </div>
          }
        >
          <div className="space-y-3">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="z. B. Einheit B" placeholder="z. B. Einheit B"
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            />
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              aria-label="Kurznotiz für Fokus, Ziel oder Belastungssteuerung" placeholder="Kurznotiz für Fokus, Ziel oder Belastungssteuerung"
              rows={3}
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Button
              variant="primary"
              fullWidth
              onClick={handleCreateTemplate}
              disabled={!name.trim() || isSaving}
            >
              Workout anlegen
            </Button>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
