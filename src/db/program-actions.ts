import type { Program, ProgramWeek } from '@/domain/models';
import { db } from '@/db/appDb';
import { ensureSettings, normalizeOptionalText } from '@/db/normalize';
import { createId } from '@/lib/id';

async function getProgramWeeks(programId: string) {
  const weeks = await db.programWeeks.where('programId').equals(programId).toArray();
  return weeks.sort((left, right) => left.weekNumber - right.weekNumber);
}

export async function createProgram(input: { name: string; weekCount: number }) {
  const name = input.name.trim();

  if (!name) {
    throw new Error('Programmname fehlt');
  }

  const weekCount = Math.max(1, Math.floor(input.weekCount));
  const now = new Date().toISOString();
  const programId = createId();

  const program: Program = {
    id: programId,
    name,
    activeWeek: 1,
    createdAt: now,
    updatedAt: now,
  };

  const weeks: ProgramWeek[] = Array.from({ length: weekCount }, (_, index) => ({
    id: createId(),
    programId,
    weekNumber: index + 1,
    label: `Woche ${index + 1}`,
  }));

  const settings = await ensureSettings();

  await db.transaction('rw', db.programs, db.programWeeks, db.appSettings, async () => {
    await db.programs.add(program);
    await db.programWeeks.bulkAdd(weeks);

    if (!settings.activeProgramId) {
      await db.appSettings.put({
        ...settings,
        activeProgramId: programId,
        updatedAt: now,
      });
    }
  });

  return programId;
}

export async function updateProgram(programId: string, input: { name: string }) {
  const program = await db.programs.get(programId);

  if (!program) {
    throw new Error('Programm nicht gefunden');
  }

  const name = input.name.trim();

  if (!name) {
    throw new Error('Programmname fehlt');
  }

  await db.programs.update(programId, {
    name,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteProgram(programId: string) {
  const program = await db.programs.get(programId);

  if (!program) {
    throw new Error('Programm nicht gefunden');
  }

  const weeks = await getProgramWeeks(programId);
  const weekIds = weeks.map((week) => week.id);
  const allPrograms = await db.programs.toArray();
  const fallbackProgram = allPrograms.find((item) => item.id !== programId);
  const settings = await ensureSettings();
  const now = new Date().toISOString();

  await db.transaction(
    'rw',
    db.programs,
    db.programWeeks,
    db.progressionRules,
    db.appSettings,
    async () => {
      if (weekIds.length > 0) {
        await db.progressionRules.where('programWeekId').anyOf(weekIds).delete();
        await db.programWeeks.bulkDelete(weekIds);
      }

      await db.programs.delete(programId);

      if (settings.activeProgramId === programId) {
        await db.appSettings.put({
          ...settings,
          activeProgramId: fallbackProgram?.id,
          weekOverride: undefined,
          updatedAt: now,
        });
      }
    },
  );
}

export async function addProgramWeek(programId: string) {
  const program = await db.programs.get(programId);

  if (!program) {
    throw new Error('Programm nicht gefunden');
  }

  const weeks = await getProgramWeeks(programId);
  const weekNumber = (weeks.at(-1)?.weekNumber ?? 0) + 1;
  const weekId = createId();

  await db.programWeeks.add({
    id: weekId,
    programId,
    weekNumber,
    label: `Woche ${weekNumber}`,
  });

  return weekId;
}

/**
 * Beschriftung und Art einer Woche.
 *
 * `kind: null` heißt ausdrücklich "wieder eine normale Woche", ein fehlender
 * Schlüssel dagegen "nicht anfassen". Der Unterschied ist hier nötig, weil
 * Dexies `Table.update` jede Property mit dem Wert `undefined` **löscht** -
 * ein durchgereichtes `undefined` würde also stillschweigend die Art einer
 * Woche entfernen, die nur umbenannt werden sollte.
 */
export async function updateProgramWeek(
  programWeekId: string,
  input: { label?: string; kind?: ProgramWeek['kind'] | null },
) {
  const week = await db.programWeeks.get(programWeekId);

  if (!week) {
    throw new Error('Programm-Woche nicht gefunden');
  }

  const changes: Partial<ProgramWeek> = {};

  if (input.label !== undefined) {
    changes.label = normalizeOptionalText(input.label);
  }

  if (input.kind !== undefined) {
    changes.kind = input.kind ?? undefined;
  }

  await db.programWeeks.update(programWeekId, changes);
}

export async function deleteProgramWeek(programWeekId: string) {
  const week = await db.programWeeks.get(programWeekId);

  if (!week) {
    throw new Error('Programm-Woche nicht gefunden');
  }

  const program = await db.programs.get(week.programId);

  if (!program) {
    throw new Error('Programm nicht gefunden');
  }

  const weeks = await getProgramWeeks(week.programId);

  if (weeks.length <= 1) {
    throw new Error('Ein Programm braucht mindestens eine Woche');
  }

  const settings = await ensureSettings();
  const remainingWeeks = weeks.filter((item) => item.id !== programWeekId);
  const maxWeekNumber = remainingWeeks.length;
  const nextProgramWeek = Math.min(program.activeWeek, maxWeekNumber);
  const nextOverride =
    settings.activeProgramId === program.id && settings.weekOverride
      ? Math.min(settings.weekOverride, maxWeekNumber)
      : settings.weekOverride;
  const now = new Date().toISOString();

  await db.transaction(
    'rw',
    db.programWeeks,
    db.progressionRules,
    db.programs,
    db.appSettings,
    async () => {
      await db.progressionRules.where('programWeekId').equals(programWeekId).delete();
      await db.programWeeks.delete(programWeekId);

      await Promise.all(
        remainingWeeks.map((item, index) =>
          db.programWeeks.update(item.id, {
            weekNumber: index + 1,
            label: item.label ?? `Woche ${index + 1}`,
          }),
        ),
      );

      await db.programs.update(program.id, {
        activeWeek: nextProgramWeek,
        updatedAt: now,
      });

      if (settings.activeProgramId === program.id) {
        await db.appSettings.put({
          ...settings,
          weekOverride: nextOverride,
          updatedAt: now,
        });
      }
    },
  );
}

/**
 * Setzt oder entfernt das Startdatum des Programms.
 *
 * Solange es steht, läuft die Programmwoche mit dem Kalender
 * (`deriveProgramWeek`); ohne bleibt es bei `activeWeek`. Erwartet `YYYY-MM-DD`
 * - das Format des Datumsfelds und zugleich das, was `parseLocalDate` in
 * [calendar-week.ts] als Tag am Ort des Geräts liest.
 */
export async function setProgramStartDate(programId: string, startedOn?: string) {
  const trimmed = startedOn?.trim();

  if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error('Das Startdatum braucht die Form JJJJ-MM-TT.');
  }

  await db.transaction('rw', db.programs, async () => {
    const program = await db.programs.get(programId);

    if (!program) {
      throw new Error('Programm nicht gefunden');
    }

    await db.programs.update(programId, {
      // `undefined` löscht die Property über Dexies Update-Semantik - beim
      // Zurücknehmen des Datums ist genau das gemeint.
      startedOn: trimmed ? trimmed : undefined,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function setProgramActiveWeek(programId: string, activeWeek: number) {
  const program = await db.programs.get(programId);

  if (!program) {
    throw new Error('Programm nicht gefunden');
  }

  const weeks = await getProgramWeeks(programId);
  const maxWeek = Math.max(1, ...(weeks.map((week) => week.weekNumber)));
  const nextWeek = Math.min(maxWeek, Math.max(1, Math.floor(activeWeek)));

  await db.programs.update(programId, {
    activeWeek: nextWeek,
    updatedAt: new Date().toISOString(),
  });
}
