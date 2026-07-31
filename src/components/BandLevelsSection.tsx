import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronDown, ChevronUp, Pencil, Plus, X } from 'lucide-react';
import { Alert } from '@/components/Alert';
import { SectionCard } from '@/components/SectionCard';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TextField } from '@/components/ui/Field';
import { db } from '@/db/appDb';
import {
  createBandLevel,
  deleteBandLevel,
  renameBandLevel,
  reorderBandLevels,
  seedDefaultBandLevels,
} from '@/db/band-actions';
import type { BandLevel } from '@/domain/models';
import { moveItem } from '@/lib/reorder';

/**
 * Pflege des Band-Katalogs.
 *
 * Die Reihenfolge ist hier kein Sortier-Komfort, sondern der Inhalt: sie
 * bestimmt, welches Band als schwerer gilt, und trägt damit das
 * Fortschrittsdiagramm einer Band-Übung.
 */
export function BandLevelsSection() {
  const bandLevels = useLiveQuery(() => db.bandLevels.orderBy('orderIndex').toArray(), []);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<BandLevel | null>(null);
  const [usageCount, setUsageCount] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setIsBusy(true);

    try {
      await action();
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Aktion fehlgeschlagen.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreate() {
    const name = newName;
    await run(async () => {
      await createBandLevel(name);
      setNewName('');
    });
  }

  async function handleRename(bandId: string) {
    const name = editingName;
    await run(async () => {
      await renameBandLevel(bandId, name);
      setEditingId(null);
    });
  }

  async function handleMove(bandId: string, direction: -1 | 1) {
    const current = (bandLevels ?? []).map((band) => band.id);
    const index = current.indexOf(bandId);
    const next = moveItem(current, index, index + direction);

    if (next === current) {
      return;
    }

    await run(() => reorderBandLevels(next));
  }

  async function handleRequestDelete(band: BandLevel) {
    // Zählt nur, um es im Dialog zu sagen - gelöscht wird trotzdem, die Sätze
    // behalten ihren Bandnamen.
    const count = await db.workoutSetLogs.filter((log) => log.bandId === band.id).count();
    setUsageCount(count);
    setPendingDelete(band);
  }

  async function handleConfirmDelete() {
    const band = pendingDelete;

    if (!band) {
      return;
    }

    await run(async () => {
      await deleteBandLevel(band.id);
      setPendingDelete(null);
    });
  }

  return (
    <SectionCard
      title="Bänder"
      subtitle="Für Übungen mit Widerstandsbändern: die Reihenfolge geht von leicht nach schwer."
    >
      <div className="space-y-3">
        {error ? <Alert>{error}</Alert> : null}

        {(bandLevels?.length ?? 0) === 0 ? (
          <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5">
            <p className="text-sm text-content-muted">
              Noch keine Bänder angelegt. Eine Übung kann erst dann auf "Band" gestellt werden.
            </p>
            <Button
              variant="ghost"
              className="mt-3"
              onClick={() => void run(seedDefaultBandLevels)}
              disabled={isBusy}
            >
              Standard-Bänder einfügen
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {(bandLevels ?? []).map((band, index) => (
              <li
                key={band.id}
                className="flex items-center gap-2 rounded-panel border border-line bg-surface px-3 py-2"
              >
                <div className="flex shrink-0 flex-col gap-1">
                  <IconButton
                    label={`${band.name} nach oben`}
                    onClick={() => void handleMove(band.id, -1)}
                    disabled={isBusy || index === 0}
                  >
                    <ChevronUp size={16} />
                  </IconButton>
                  <IconButton
                    label={`${band.name} nach unten`}
                    onClick={() => void handleMove(band.id, 1)}
                    disabled={isBusy || index === (bandLevels?.length ?? 0) - 1}
                  >
                    <ChevronDown size={16} />
                  </IconButton>
                </div>

                {editingId === band.id ? (
                  <>
                    <TextField
                      label={`Name von ${band.name}`}
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      autoComplete="off"
                      containerClassName="min-w-0 flex-1"
                    />
                    <IconButton
                      label="Namen speichern"
                      onClick={() => void handleRename(band.id)}
                      disabled={isBusy || !editingName.trim()}
                    >
                      <Check size={16} />
                    </IconButton>
                    <IconButton label="Umbenennen abbrechen" onClick={() => setEditingId(null)}>
                      <X size={16} />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-content">{band.name}</p>
                      <p className="text-xs text-content-muted">
                        Stufe {index + 1} von {bandLevels?.length ?? 0}
                      </p>
                    </div>
                    <IconButton
                      label={`${band.name} umbenennen`}
                      onClick={() => {
                        setEditingId(band.id);
                        setEditingName(band.name);
                      }}
                      disabled={isBusy}
                    >
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton
                      label={`${band.name} löschen`}
                      variant="danger"
                      onClick={() => void handleRequestDelete(band)}
                      disabled={isBusy}
                    >
                      <X size={16} />
                    </IconButton>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-2">
          <TextField
            label="Neues Band"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="z. B. gelb"
            autoComplete="off"
            containerClassName="flex-1"
          />
          <Button
            variant="primary"
            onClick={() => void handleCreate()}
            disabled={isBusy || !newName.trim()}
          >
            <Plus size={16} />
            Anlegen
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Band "${pendingDelete?.name}" löschen?`}
        description={
          usageCount > 0
            ? `${usageCount} protokollierte Sätze nutzen dieses Band. Sie behalten den Namen in der Historie, verlieren aber ihren Punkt im Verlaufsdiagramm. Ziel-Bänder in Vorlagen werden geleert.`
            : 'Ziel-Bänder in Vorlagen und Progressionsregeln werden geleert.'
        }
        busy={isBusy}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </SectionCard>
  );
}
