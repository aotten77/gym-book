import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Alert } from '@/components/Alert';
import { SectionCard } from '@/components/SectionCard';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { db } from '@/db/appDb';
import {
  addProgramWeek,
  createProgram,
  deleteProgram,
  deleteProgramWeek,
  updateProgram,
  updateProgramWeek,
} from '@/db/program-actions';
import { setActiveProgram } from '@/db/settings-actions';

export function ProgramsPage() {
  const [newProgramName, setNewProgramName] = useState('');
  const [newProgramWeekCount, setNewProgramWeekCount] = useState('8');
  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [editingProgramName, setEditingProgramName] = useState('');
  const [editingWeekId, setEditingWeekId] = useState<string | null>(null);
  const [editingWeekLabel, setEditingWeekLabel] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Löschen war hier bisher ein einziger Tap ohne Rückfrage - und nimmt beim
   * Programm alle Wochen und Progressionsregeln mit.
   */
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'program' | 'week'; id: string; name: string } | null
  >(null);
  const programs = useLiveQuery(async () => {
    const items = await db.programs.toArray();
    return items.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }, []);
  const weeks = useLiveQuery(() => db.programWeeks.toArray(), []);
  const settings = useLiveQuery(() => db.appSettings.get('app-settings'), []);

  const weeksByProgramId = useMemo(() => {
    return (weeks ?? []).reduce<Record<string, typeof weeks>>((accumulator, week) => {
      const bucket = accumulator[week.programId] ?? [];
      bucket.push(week);
      accumulator[week.programId] = bucket;
      return accumulator;
    }, {});
  }, [weeks]);

  async function handleCreateProgram() {
    if (!newProgramName.trim()) {
      return;
    }

    setIsSaving(true);

    try {
      await createProgram({
        name: newProgramName,
        weekCount: Number(newProgramWeekCount) || 1,
      });
      setNewProgramName('');
      setNewProgramWeekCount('8');
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Programm konnte nicht angelegt werden.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveProgram(programId: string) {
    if (!editingProgramName.trim()) {
      return;
    }

    setIsSaving(true);

    try {
      await updateProgram(programId, { name: editingProgramName });
      setEditingProgramId(null);
      setEditingProgramName('');
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Programm konnte nicht aktualisiert werden.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) {
      return;
    }

    setIsSaving(true);

    try {
      if (pendingDelete.kind === 'program') {
        await deleteProgram(pendingDelete.id);
      } else {
        await deleteProgramWeek(pendingDelete.id);
      }

      setError(null);
      setPendingDelete(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : 'Löschen ist fehlgeschlagen.',
      );
      setPendingDelete(null);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddWeek(programId: string) {
    setIsSaving(true);

    try {
      await addProgramWeek(programId);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Woche konnte nicht angelegt werden.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveWeek(programWeekId: string) {
    setIsSaving(true);

    try {
      await updateProgramWeek(programWeekId, { label: editingWeekLabel });
      setEditingWeekId(null);
      setEditingWeekLabel('');
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Woche konnte nicht aktualisiert werden.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSetActiveProgram(programId: string) {
    setIsSaving(true);

    try {
      await setActiveProgram(programId);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Aktives Programm konnte nicht gesetzt werden.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell title="Programm">
      <div className="space-y-4">
        <SectionCard
          title="Neues Programm"
          subtitle="Trainingsblock anlegen und direkt mit einer brauchbaren Wochenstruktur starten."
          action={
            <div className="flex h-10 w-10 items-center justify-center rounded-control bg-accent-soft text-accent">
              <Plus size={18} />
            </div>
          }
        >
          <div className="space-y-3">
            <input
              value={newProgramName}
              onChange={(event) => setNewProgramName(event.target.value)}
              aria-label="z. B. Block Hypertrophie" placeholder="z. B. Block Hypertrophie"
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            />
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <input
                value={newProgramWeekCount}
                onChange={(event) => setNewProgramWeekCount(event.target.value)}
                inputMode="numeric"
                aria-label="8" placeholder="8"
                className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
              />
              <button
                type="button"
                onClick={handleCreateProgram}
                disabled={!newProgramName.trim() || isSaving}
                className="rounded-panel bg-accent px-5 py-4 text-sm font-semibold text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Anlegen
              </button>
            </div>
          </div>
        </SectionCard>

        {error ? <Alert>{error}</Alert> : null}

        {(programs ?? []).map((program) => {
          const programWeeks = [...(weeksByProgramId[program.id] ?? [])].sort(
            (left, right) => left.weekNumber - right.weekNumber,
          );
          const isActive = settings?.activeProgramId === program.id;
          const isEditingProgram = editingProgramId === program.id;

          return (
            <SectionCard
              key={program.id}
              title={program.name}
              subtitle={`${programWeeks.length} Wochen · aktive Programm-Woche W${program.activeWeek}`}
              action={
                <button
                  type="button"
                  onClick={() => handleSetActiveProgram(program.id)}
                  disabled={isActive || isSaving}
                  className="min-h-touch rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isActive ? 'Aktiv' : 'Aktiv setzen'}
                </button>
              }
            >
              <div className="space-y-4">
                {isEditingProgram ? (
                  <div className="grid grid-cols-[1fr_auto] gap-3">
                    <input
                      value={editingProgramName}
                      onChange={(event) => setEditingProgramName(event.target.value)}
                      className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveProgram(program.id)}
                      disabled={!editingProgramName.trim() || isSaving}
                      className="rounded-panel bg-accent px-5 py-4 text-sm font-semibold text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Speichern
                    </button>
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <IconButton
                    label={`Programm ${program.name} umbenennen`}
                    onClick={() => {
                      setEditingProgramId(program.id);
                      setEditingProgramName(program.name);
                    }}
                    disabled={isSaving}
                  >
                    <Pencil size={18} />
                  </IconButton>
                  <IconButton
                    label={`Programm ${program.name} löschen`}
                    variant="danger"
                    onClick={() => setPendingDelete({ kind: 'program', id: program.id, name: program.name })}
                    disabled={isSaving}
                  >
                    <Trash2 size={18} />
                  </IconButton>
                  <Button variant="ghost" size="md" onClick={() => handleAddWeek(program.id)} disabled={isSaving}>
                    Woche hinzufügen
                  </Button>
                </div>

                <div className="space-y-3">
                  {programWeeks.map((week) => {
                    const isEditingWeek = editingWeekId === week.id;

                    return (
                      <div
                        key={week.id}
                        className="rounded-panel border border-line bg-surface px-4 py-4"
                      >
                        {isEditingWeek ? (
                          <div className="grid grid-cols-[1fr_auto] gap-3">
                            <input
                              value={editingWeekLabel}
                              onChange={(event) => setEditingWeekLabel(event.target.value)}
                              placeholder={`Woche ${week.weekNumber}`}
                              className="w-full rounded-panel border border-line bg-surface-sunken px-4 py-4 text-base text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveWeek(week.id)}
                              disabled={isSaving}
                              className="rounded-panel bg-accent px-5 py-4 text-sm font-semibold text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Speichern
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-content">W{week.weekNumber}</p>
                              <p className="mt-1 text-sm text-content-muted">
                                {week.label ?? `Woche ${week.weekNumber}`}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <IconButton
                                label={`Woche ${week.weekNumber} umbenennen`}
                                onClick={() => {
                                  setEditingWeekId(week.id);
                                  setEditingWeekLabel(week.label ?? '');
                                }}
                                disabled={isSaving}
                              >
                                <Pencil size={18} />
                              </IconButton>
                              <IconButton
                                label={`Woche ${week.weekNumber} löschen`}
                                variant="danger"
                                onClick={() => setPendingDelete({ kind: 'week', id: week.id, name: `Woche ${week.weekNumber}` })}
                                disabled={isSaving}
                              >
                                <Trash2 size={18} />
                              </IconButton>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </SectionCard>
          );
        })}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === 'program' ? 'Programm löschen?' : 'Woche löschen?'}
        description={
          pendingDelete?.kind === 'program'
            ? `"${pendingDelete.name}" wird mit allen Wochen und Progressionsregeln entfernt. Bereits absolvierte Trainings bleiben im Verlauf erhalten.`
            : `"${pendingDelete?.name}" wird entfernt, die folgenden Wochen rücken auf. Progressionsregeln dieser Woche gehen verloren.`
        }
        busy={isSaving}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </AppShell>
  );
}
