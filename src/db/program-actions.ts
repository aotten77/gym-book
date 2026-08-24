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

export async function updateProgramWeek(programWeekId: string, input: { label: string }) {
  const week = await db.programWeeks.get(programWeekId);

  if (!week) {
    throw new Error('Programm-Woche nicht gefunden');
  }

  await db.programWeeks.update(programWeekId, {
    label: normalizeOptionalText(input.label),
  });
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
