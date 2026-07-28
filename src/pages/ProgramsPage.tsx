import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { SectionCard } from '@/components/SectionCard';
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
  const programs = useLiveQuery(() => db.programs.orderBy('createdAt').toArray(), []);
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

  async function handleDeleteProgram(programId: string) {
    setIsSaving(true);

    try {
      await deleteProgram(programId);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Programm konnte nicht geloescht werden.');
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

  async function handleDeleteWeek(programWeekId: string) {
    setIsSaving(true);

    try {
      await deleteProgramWeek(programWeekId);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Woche konnte nicht geloescht werden.');
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
    <AppShell title="Programme" eyebrow="Progression">
      <div className="space-y-4">
        <SectionCard
          title="Neues Programm"
          subtitle="Trainingsblock anlegen und direkt mit einer brauchbaren Wochenstruktur starten."
          action={
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-lime-300/10 text-lime-200">
              <Plus size={18} />
            </div>
          }
        >
          <div className="space-y-3">
            <input
              value={newProgramName}
              onChange={(event) => setNewProgramName(event.target.value)}
              placeholder="z. B. Block Hypertrophie"
              className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
            />
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <input
                value={newProgramWeekCount}
                onChange={(event) => setNewProgramWeekCount(event.target.value)}
                inputMode="numeric"
                placeholder="8"
                className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
              />
              <button
                type="button"
                onClick={handleCreateProgram}
                disabled={!newProgramName.trim() || isSaving}
                className="rounded-3xl bg-lime-300 px-5 py-4 text-sm font-semibold text-zinc-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Anlegen
              </button>
            </div>
          </div>
        </SectionCard>

        {error ? (
          <div className="rounded-3xl border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

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
                  className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
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
                      className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition focus:border-lime-300/40"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveProgram(program.id)}
                      disabled={!editingProgramName.trim() || isSaving}
                      className="rounded-3xl bg-lime-300 px-5 py-4 text-sm font-semibold text-zinc-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Speichern
                    </button>
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProgramId(program.id);
                      setEditingProgramName(program.name);
                    }}
                    disabled={isSaving}
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 text-zinc-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteProgram(program.id)}
                    disabled={isSaving}
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-300/20 text-rose-100 transition hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddWeek(program.id)}
                    disabled={isSaving}
                    className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Woche hinzufuegen
                  </button>
                </div>

                <div className="space-y-3">
                  {programWeeks.map((week) => {
                    const isEditingWeek = editingWeekId === week.id;

                    return (
                      <div
                        key={week.id}
                        className="rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4"
                      >
                        {isEditingWeek ? (
                          <div className="grid grid-cols-[1fr_auto] gap-3">
                            <input
                              value={editingWeekLabel}
                              onChange={(event) => setEditingWeekLabel(event.target.value)}
                              placeholder={`Woche ${week.weekNumber}`}
                              className="w-full rounded-3xl border border-white/10 bg-zinc-900 px-4 py-4 text-sm text-zinc-50 outline-none transition focus:border-lime-300/40"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveWeek(week.id)}
                              disabled={isSaving}
                              className="rounded-3xl bg-lime-300 px-5 py-4 text-sm font-semibold text-zinc-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Speichern
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-zinc-50">W{week.weekNumber}</p>
                              <p className="mt-1 text-sm text-zinc-400">
                                {week.label ?? `Woche ${week.weekNumber}`}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingWeekId(week.id);
                                  setEditingWeekLabel(week.label ?? '');
                                }}
                                disabled={isSaving}
                                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 text-zinc-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Pencil size={18} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteWeek(week.id)}
                                disabled={isSaving}
                                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-300/20 text-rose-100 transition hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Trash2 size={18} />
                              </button>
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
    </AppShell>
  );
}
