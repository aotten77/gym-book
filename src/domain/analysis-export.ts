import { sortSetLogs } from '@/domain/history';
import type {
  BandLevel,
  Exercise,
  ExerciseTest,
  Program,
  Side,
  TrackingMode,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSetLog,
} from '@/domain/models';
import { toDateInputValue, type WeekControl } from '@/domain/program';
import { supportsReps } from '@/domain/tracking';
import { sumWorkVolume } from '@/domain/volume';

/**
 * Der Analyse-Export - ein zweiter, ausdrücklich **verlustbehafteter** Export
 * neben der Sicherung.
 *
 * Der Vollexport in [lib/export.ts] ist ein Backup: vollständig, normalisiert,
 * mit UUID-Fremdschlüsseln und den Bildern als Data-URLs. Genau das macht ihn
 * zum Auswerten unbrauchbar - von 5,2 MB sind rund 2,5 MB Bilder, 85 % der
 * Satzzeilen sind leere Vorgaben aus nie gestarteten Sessions, und jede Frage
 * an die Daten beginnt mit drei Joins über 36-Zeichen-Ids.
 *
 * Hier entsteht deshalb das Gegenteil: eine breite Tabelle in Klartext, eine
 * Zeile je Session × Übung × Seite, ohne eine einzige Id. Das ist **nicht**
 * reimportierbar und soll es nicht sein - was hier wegfällt, fällt bewusst weg.
 * Damit die Auswahl trotzdem nachvollziehbar bleibt, nennt `meta.json` jede
 * verworfene Session mit einer Zeile Begründung: gefiltert wurde sichtbar, statt
 * die Auswertung mit Rauschen zuzumüllen.
 */

/** Trennzeichen der CSV. Siehe `formatCsvNumber` zur Zahlenschreibweise. */
const CSV_SEPARATOR = ',';

/**
 * Ab wann eine begonnene Einheit als unvollständig gilt.
 *
 * Wer eine Einheit anfängt und nach zwei Sätzen abbricht, hat trotzdem etwas
 * gemacht - die Zeilen sind interpretierbar und bleiben deshalb im Export. Sie
 * dürfen nur nicht aussehen wie eine durchgezogene Einheit, sonst verfälschen
 * sie jede Aussage über Volumen und Abstände.
 */
const MINIMUM_COMPLETION_RATIO = 0.2;

/**
 * Wochentage in Ortszeit, indiziert über `Date.getDay()` (0 = Sonntag).
 *
 * Von Hand und nicht über `Intl`: `de-DE` liefert "Mo." mit Punkt, und die
 * Spalte soll zweistellig sein. Außerdem bleibt der Export damit unabhängig
 * von der ICU-Datenlage des Geräts.
 */
const WEEKDAY_LABELS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const SIDE_LABELS: Record<Side, string> = {
  both: 'beide',
  left: 'links',
  right: 'rechts',
};

const SIDE_ORDER: Record<Side, number> = {
  both: 0,
  left: 1,
  right: 2,
};

/**
 * Das Workout, gegen das `std_seit_letzter_einheit_b` misst.
 *
 * Der einzige Ort im Export, an dem ein Workout beim Namen genannt wird - und
 * deshalb ein Parameter mit Vorgabewert statt einer Konstante mitten im Code:
 * wer anders schneidet, gibt einen anderen Namen mit, und wo es das Workout
 * nicht gibt, bleibt die Spalte leer statt zu raten.
 */
export const DEFAULT_REFERENCE_TEMPLATE_NAME = 'Einheit B';

export interface AnalysisExportInput {
  exportedAt: Date;
  /**
   * Die Übungsbibliothek - ausschließlich für den aktuellen `trackingMode` in
   * `meta.uebungen`. Siehe `describeTrackingMode`: ohne sie beschreibt der
   * Export die Vergangenheit und liest sich wie eine Aussage über heute.
   */
  exercises: Exercise[];
  sessions: WorkoutSession[];
  sessionExercises: WorkoutSessionExercise[];
  setLogs: WorkoutSetLog[];
  bandLevels: BandLevel[];
  /** Das aktive Programm - nur für `meta.programm`. */
  program?: Program;
  /**
   * Die wirksame Woche, aufgelöst über `resolveWeekControl`.
   *
   * Kommt als fertiges Ergebnis herein und wird hier nicht nachgebaut: die
   * Rangfolge Override → Startdatum → activeWeek hat genau eine Stelle.
   */
  weekControl: WeekControl;
  /**
   * Die Seitenvergleichs-Tests - unabhängig vom Training erhoben.
   *
   * Sie hängen an keiner Session und werden deshalb auch nicht mit einer
   * verworfen: ein Test vom Sonntag zählt, auch wenn an dem Tag keine Einheit
   * lief. Siehe `buildTestsCsv` dazu, warum sie eine eigene Datei bekommen.
   */
  tests: ExerciseTest[];
  /** Siehe [DEFAULT_REFERENCE_TEMPLATE_NAME]. */
  referenceTemplateName?: string;
}

export interface AnalysisExportFiles {
  sessionsCsv: string;
  metaJson: string;
  progressionCsv: string;
  testsCsv: string;
}

/** Was den Export einer Session verhindert hat - eine Zeile in `meta.json`. */
interface DiscardedSession {
  datum: string;
  einheit: string;
  grund: string;
}

interface AnalysisRow {
  datum: string;
  wochentag: string;
  einheit: string;
  pos: number;
  uebung: string;
  seite: Side;
  arbeitssaetze: number;
  aufwaermsaetze: number;
  topGewicht?: number;
  topWdh?: number;
  topSekunden?: number;
  topBand?: string;
  topHoeheCm?: number;
  volumen?: number;
  uebersprungen: boolean;
  unvollstaendig: boolean;
  stundenSeitLetzterEinheit?: number;
  stundenSeitReferenz?: number;
  /** Der Spitzensatz als Kurzform - Rohstoff für `progression.csv`. */
  topKurz: string;
}

/** Ein Datum als `YYYY-MM-DD` in **Ortszeit**. */
function localDate(iso: string): string {
  return toDateInputValue(new Date(iso));
}

/** `2026-08-02T21:39` in Ortszeit - Minutengenau, das reicht als Kennung. */
function localDateTimeMinutes(iso: string): string {
  const date = new Date(iso);
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');

  return `${toDateInputValue(date)}T${hours}:${minutes}`;
}

/**
 * Ein Zeitstempel mit dem Zonenversatz des Geräts: `2026-08-26T09:00:00+02:00`.
 *
 * `toISOString()` wäre UTC und würde einen Abendexport auf den Folgetag
 * schieben - dieselbe Falle, wegen der auch `datum` in Ortszeit steht.
 */
function localIsoWithOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const offsetHours = `${Math.floor(Math.abs(offsetMinutes) / 60)}`.padStart(2, '0');
  const offsetRest = `${Math.abs(offsetMinutes) % 60}`.padStart(2, '0');
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => `${part}`.padStart(2, '0'))
    .join(':');

  return `${toDateInputValue(date)}T${time}${sign}${offsetHours}:${offsetRest}`;
}

function weekdayLabel(iso: string): string {
  return WEEKDAY_LABELS[new Date(iso).getDay()] ?? '';
}

/**
 * Vergleicht Namen so, wie der Bibliotheks-Import es tut: getrimmt und ohne
 * Groß-/Kleinschreibung. "einheit b" und "Einheit B" sind dasselbe Workout.
 */
function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase('de');
}

/**
 * Eine Zahl für die Maschine, nicht fürs Auge.
 *
 * Bewusst **nicht** `formatNumber`: das deutsche Komma ist die Konvention für
 * jede *gerenderte* Zahl dieser App, in einer kommagetrennten Datei wäre es
 * ein Trennzeichen. Der Export geht in ein Tabellenblatt oder ein Skript,
 * deshalb Punkt als Dezimaltrenner und keine Tausendergruppierung.
 */
function formatCsvNumber(value: number): string {
  return `${Math.round(value * 1000) / 1000}`;
}

function csvCell(value: string | number | boolean | undefined): string {
  if (value === undefined) {
    return '';
  }

  if (typeof value === 'boolean') {
    return value ? 'ja' : 'nein';
  }

  const text = typeof value === 'number' ? formatCsvNumber(value) : value;

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(cells: (string | number | boolean | undefined)[]): string {
  return cells.map(csvCell).join(CSV_SEPARATOR);
}

function hoursBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000);
}

/**
 * Wann eine Session zu Ende war.
 *
 * `closeSession` stempelt `completedAt` auch auf eine abgebrochene Session, und
 * für den Abstand zur nächsten Einheit ist genau das der richtige Zeitpunkt.
 * Fehlt er, bleibt der Start als bestmögliche Auskunft.
 */
function sessionEnd(session: WorkoutSession): string {
  return session.completedAt ?? session.startedAt;
}

/**
 * Der schwerste Satz einer Menge.
 *
 * Die Rangfolge ist Gewicht → Band → Höhe → Sekunden → Wiederholungen. Die
 * Vorgabe lautet "höchstes Gewicht, bei Gleichstand die meisten Wiederholungen"
 * - für eine Übung ohne Kilo (Band, Zeit, Stufe) wäre das keine Auswahl,
 * sondern Zufall, deshalb stehen die anderen Lastachsen dazwischen. Wo es nur
 * Gewicht und Wiederholungen gibt, ist es exakt die Vorgabe.
 */
function compareBySeverity(
  left: WorkoutSetLog,
  right: WorkoutSetLog,
  bandRank: (bandId?: string) => number,
): number {
  return (
    (left.weight ?? 0) - (right.weight ?? 0) ||
    bandRank(left.bandId) - bandRank(right.bandId) ||
    (left.heightCm ?? 0) - (right.heightCm ?? 0) ||
    (left.seconds ?? 0) - (right.seconds ?? 0) ||
    (left.reps ?? 0) - (right.reps ?? 0)
  );
}

function pickTopSet(
  logs: WorkoutSetLog[],
  bandRank: (bandId?: string) => number,
): WorkoutSetLog | undefined {
  return logs.reduce<WorkoutSetLog | undefined>(
    (best, log) => (best && compareBySeverity(best, log, bandRank) >= 0 ? best : log),
    undefined,
  );
}

/**
 * Der Spitzensatz als eine Zelle: `40x6`, `45s`, `Lila x8`, `25cm 40x6`.
 *
 * Die Kurzform ist der ganze Inhalt von `progression.csv` - dort steht je
 * Übung und Seite eine Spalte pro Trainingstag, und Stagnation ist sichtbar,
 * ohne dass jemand erst pivotieren muss.
 */
function formatTopSet(log: WorkoutSetLog): string {
  const count =
    log.reps !== undefined
      ? formatCsvNumber(log.reps)
      : log.seconds !== undefined
        ? `${formatCsvNumber(log.seconds)}s`
        : '';
  const prefix = [
    log.heightCm !== undefined ? `${formatCsvNumber(log.heightCm)}cm` : undefined,
    log.weight === undefined ? log.bandNameSnapshot : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  const core =
    log.weight !== undefined
      ? count
        ? `${formatCsvNumber(log.weight)}x${count}`
        : formatCsvNumber(log.weight)
      : count;

  if (!prefix) {
    return core;
  }

  if (!core) {
    return prefix;
  }

  // Ohne Kilo trägt das `x` die Trennung zur Zahl: "Lila x8" statt "Lilax8".
  return log.weight !== undefined ? `${prefix} ${core}` : `${prefix} x${core}`;
}

const SESSION_COLUMNS = [
  'datum',
  'wochentag',
  'einheit',
  'pos',
  'uebung',
  'seite',
  'arbeitssaetze',
  'aufwaermsaetze',
  'top_gewicht',
  'top_wdh',
  'top_sekunden',
  'top_band',
  'top_hoehe_cm',
  'volumen',
  'uebersprungen',
  'unvollstaendig',
  'std_seit_letzter_einheit',
  'std_seit_letzter_einheit_b',
];

/**
 * Baut die drei Dateien des Analyse-Exports.
 *
 * Rein: nimmt die Tabellen als Arrays und gibt Text zurück. Die Filterregeln
 * stehen deshalb alle hier und sind einzeln testbar - was aus dem Export
 * fliegt, ist eine Entscheidung über Trainingsdaten und keine Nebenwirkung
 * einer Abfrage.
 */
export function buildAnalysisExport(input: AnalysisExportInput): AnalysisExportFiles {
  const referenceName = normalizeName(input.referenceTemplateName ?? DEFAULT_REFERENCE_TEMPLATE_NAME);
  const bandRankById = new Map(input.bandLevels.map((band) => [band.id, band.orderIndex]));
  const bandRank = (bandId?: string) => (bandId ? (bandRankById.get(bandId) ?? 0) : 0);

  const exercisesBySession = new Map<string, WorkoutSessionExercise[]>();
  for (const exercise of input.sessionExercises) {
    const bucket = exercisesBySession.get(exercise.sessionId);
    if (bucket) {
      bucket.push(exercise);
    } else {
      exercisesBySession.set(exercise.sessionId, [exercise]);
    }
  }

  const logsByExercise = new Map<string, WorkoutSetLog[]>();
  for (const log of input.setLogs) {
    const bucket = logsByExercise.get(log.sessionExerciseId);
    if (bucket) {
      bucket.push(log);
    } else {
      logsByExercise.set(log.sessionExerciseId, [log]);
    }
  }

  const sessions = [...input.sessions].sort(
    (left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime(),
  );

  const rows: AnalysisRow[] = [];
  const discarded: DiscardedSession[] = [];
  const trainedExercises = new Map<
    string,
    { name: string; unilateral: boolean; snapshotModes: Set<TrackingMode> }
  >();
  let exportedCount = 0;
  let previousEnd: string | undefined;
  let previousReferenceEnd: string | undefined;

  for (const session of sessions) {
    const sessionExercises = [...(exercisesBySession.get(session.id) ?? [])].sort(
      (left, right) => left.orderIndex - right.orderIndex,
    );
    const completedWorkLogs = new Map<string, WorkoutSetLog[]>();
    let plannedWorkRows = 0;
    let completedWorkRows = 0;

    for (const exercise of sessionExercises) {
      const logs = sortSetLogs(logsByExercise.get(exercise.id) ?? []);
      const completed = logs.filter((log) => log.completed && log.setKind === 'work');

      completedWorkLogs.set(exercise.id, completed);
      completedWorkRows += completed.length;

      /*
       * Übersprungene Übungen zählen nicht als geplant: Überspringen ändert
       * den Plan dieser Session (siehe `toggleSkipSessionExercise`), es ist
       * kein Versäumnis. Sonst sähe jede bewusst gekürzte Einheit
       * unvollständig aus.
       */
      if (!exercise.wasSkipped) {
        plannedWorkRows += logs.filter((log) => log.setKind === 'work').length;
      }
    }

    /*
     * Regel 2: ohne einen einzigen abgeschlossenen Arbeitssatz gibt es nichts
     * zu messen. Eine laufende Session fliegt ebenfalls heraus - sie hat noch
     * kein Ende, und ohne Ende ist der Abstand zur nächsten Einheit nicht
     * berechenbar.
     */
    if (session.status === 'active') {
      discarded.push({
        datum: localDateTimeMinutes(session.startedAt),
        einheit: session.templateNameSnapshot,
        grund: 'läuft noch',
      });
      continue;
    }

    if (completedWorkRows === 0) {
      discarded.push({
        datum: localDateTimeMinutes(session.startedAt),
        einheit: session.templateNameSnapshot,
        grund: 'keine abgeschlossenen Sätze',
      });
      continue;
    }

    exportedCount += 1;

    const incomplete =
      plannedWorkRows > 0 && completedWorkRows / plannedWorkRows < MINIMUM_COMPLETION_RATIO;
    const stundenSeitLetzterEinheit = previousEnd
      ? hoursBetween(previousEnd, session.startedAt)
      : undefined;
    const stundenSeitReferenz = previousReferenceEnd
      ? hoursBetween(previousReferenceEnd, session.startedAt)
      : undefined;

    for (const exercise of sessionExercises) {
      const completed = completedWorkLogs.get(exercise.id) ?? [];
      const warmups = (logsByExercise.get(exercise.id) ?? []).filter(
        (log) => log.completed && log.setKind === 'warmup',
      );

      /*
       * Eine Zeile entsteht nur für Übungen, die ausgeführt oder ausdrücklich
       * übersprungen wurden. Alles andere ist eine Übung, die in einer
       * abgebrochenen Einheit nie an die Reihe kam - genau die leeren Zeilen,
       * die den Vollexport unlesbar machen.
       */
      if (completed.length === 0 && !exercise.wasSkipped) {
        continue;
      }

      /*
       * Die Modi werden **gesammelt**, nicht überschrieben. Eine Übung, deren
       * Erfassung einmal umgestellt wurde, trägt in alten Sessions den alten
       * Snapshot - und wer hier den letzten gewinnen ließe, machte aus der
       * Vergangenheit eine Aussage über heute. Siehe `buildMetaJson`.
       */
      const key = normalizeName(exercise.exerciseNameSnapshot);
      const seen = trainedExercises.get(key);

      if (seen) {
        seen.snapshotModes.add(exercise.trackingMode);
      } else {
        trainedExercises.set(key, {
          name: exercise.exerciseNameSnapshot,
          unilateral: exercise.unilateral,
          snapshotModes: new Set([exercise.trackingMode]),
        });
      }

      const expectedSides: Side[] = exercise.unilateral ? ['left', 'right'] : ['both'];
      const sides = [...new Set([...expectedSides, ...completed.map((log) => log.side)])].sort(
        (left, right) => SIDE_ORDER[left] - SIDE_ORDER[right],
      );

      for (const side of sides) {
        const sideLogs = completed.filter((log) => log.side === side);
        const topSet = pickTopSet(sideLogs, bandRank);
        /*
         * Volumen nur, wo Kilo mal Wiederholungen auch eine Aussage ist:
         * `sumWorkVolume` würde bei einer Zeitübung Kilo mal Sekunden
         * summieren, und eine Körpergewichtsübung ergibt null - beides
         * bleibt leer statt eine Null zu behaupten.
         */
        const volume = supportsReps(exercise.trackingMode) ? sumWorkVolume(sideLogs) : 0;

        rows.push({
          datum: localDate(session.startedAt),
          wochentag: weekdayLabel(session.startedAt),
          einheit: session.templateNameSnapshot,
          pos: exercise.orderIndex,
          uebung: exercise.exerciseNameSnapshot,
          seite: side,
          arbeitssaetze: sideLogs.length,
          aufwaermsaetze: warmups.filter((log) => log.side === side).length,
          topGewicht: topSet?.weight,
          topWdh: topSet?.reps,
          topSekunden: topSet?.seconds,
          topBand: topSet?.bandNameSnapshot,
          topHoeheCm: topSet?.heightCm,
          volumen: volume > 0 ? volume : undefined,
          uebersprungen: exercise.wasSkipped,
          unvollstaendig: incomplete,
          stundenSeitLetzterEinheit,
          stundenSeitReferenz,
          topKurz: topSet ? formatTopSet(topSet) : '',
        });
      }
    }

    /*
     * Nur exportierte Sessions verschieben den Bezugspunkt: ein Start, der
     * innerhalb derselben Minute wieder abgebrochen wurde, ist keine Einheit
     * und darf den Abstand zur vorigen nicht auf null Stunden drücken.
     */
    previousEnd = sessionEnd(session);

    if (normalizeName(session.templateNameSnapshot) === referenceName) {
      previousReferenceEnd = previousEnd;
    }
  }

  return {
    sessionsCsv: buildSessionsCsv(rows),
    progressionCsv: buildProgressionCsv(rows),
    testsCsv: buildTestsCsv(input.tests),
    metaJson: buildMetaJson(input, {
      rows,
      discarded,
      exportedCount,
      totalSessions: input.sessions.length,
      exercises: [...trainedExercises.values()],
    }),
  };
}

function buildSessionsCsv(rows: AnalysisRow[]): string {
  const lines = [SESSION_COLUMNS.join(CSV_SEPARATOR)];

  for (const row of rows) {
    lines.push(
      csvLine([
        row.datum,
        row.wochentag,
        row.einheit,
        row.pos,
        row.uebung,
        SIDE_LABELS[row.seite],
        row.arbeitssaetze,
        row.aufwaermsaetze,
        row.topGewicht,
        row.topWdh,
        row.topSekunden,
        row.topBand,
        row.topHoeheCm,
        row.volumen,
        row.uebersprungen,
        row.unvollstaendig,
        row.stundenSeitLetzterEinheit,
        row.stundenSeitReferenz,
      ]),
    );
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Die transponierte Sicht: je Übung und Seite eine Zeile, je Trainingstag eine
 * Spalte, in der Zelle der Spitzensatz.
 *
 * Übungen ohne einen einzigen Spitzensatz - übersprungene also - fallen hier
 * heraus: eine Zeile aus lauter leeren Zellen ist keine Verlaufskurve.
 */
function buildProgressionCsv(rows: AnalysisRow[]): string {
  const dates = [...new Set(rows.map((row) => row.datum))].sort();
  const byKey = new Map<string, { uebung: string; seite: Side; cells: Map<string, string[]> }>();

  for (const row of rows) {
    if (!row.topKurz) {
      continue;
    }

    const key = `${row.uebung} ${row.seite}`;
    let entry = byKey.get(key);

    if (!entry) {
      entry = { uebung: row.uebung, seite: row.seite, cells: new Map() };
      byKey.set(key, entry);
    }

    const cell = entry.cells.get(row.datum);

    if (cell) {
      // Zweimal dieselbe Übung an einem Tag: beide Werte, keiner verschwindet.
      cell.push(row.topKurz);
    } else {
      entry.cells.set(row.datum, [row.topKurz]);
    }
  }

  const entries = [...byKey.values()].sort(
    (left, right) =>
      left.uebung.localeCompare(right.uebung, 'de') || SIDE_ORDER[left.seite] - SIDE_ORDER[right.seite],
  );
  const lines = [['uebung', 'seite', ...dates].map(csvCell).join(CSV_SEPARATOR)];

  for (const entry of entries) {
    lines.push(
      csvLine([
        entry.uebung,
        SIDE_LABELS[entry.seite],
        ...dates.map((date) => entry.cells.get(date)?.join('; ')),
      ]),
    );
  }

  return `${lines.join('\n')}\n`;
}

const TEST_COLUMNS = ['datum', 'uebung', 'links', 'rechts', 'asymmetrie_prozent', 'notiz'];

/**
 * Die Seitenvergleichs-Tests, zeitlich absteigend - der neueste Wert oben.
 *
 * **Warum eine vierte Datei und kein Block in `meta.json`.** Das Argument für
 * `meta.json` lautet: wenige Zeilen, anderes Korn als Session × Übung × Seite,
 * und ein Anhang weniger. Zwei Drittel davon halten nicht.
 *
 * Das Korn ist kein Gegenargument, sondern der Grund: `progression.csv` hat
 * schon ein anderes als `sessions.csv`, und genau dafür gibt es dort eine
 * zweite Datei statt einer breiteren ersten. Der Anhang kostet ebenfalls
 * nichts - `createZipArchive` packt ohnehin alles in *ein* Archiv, das ist
 * sein einziger Zweck. Bleibt "wenige Zeilen", und das ist eine Aussage über
 * heute: eine Messreihe, die zwölf Wochen läuft, ist eine Tabelle.
 *
 * Dagegen steht, was `meta.json` ist: die Auskunft *über* den Export - was
 * drin ist, was fehlt, was verworfen wurde. Messwerte sind keine Herkunft.
 * Ausgerechnet Hüft-Innenrotation und Knie-zur-Wand-Seitendifferenz, die
 * Zielgrößen, an denen der Fortschritt hängt, stünden dann als Anhang in der
 * Beschreibung der Datei statt in ihr.
 *
 * Der Übungsname kommt aus `exerciseNameSnapshot` und wird **nicht** über
 * `exerciseId` nachgeschlagen - dafür gibt es den Snapshot: eine gelöschte
 * oder umbenannte Übung kostet sonst eine Messung, die tatsächlich
 * stattgefunden hat.
 */
function buildTestsCsv(tests: ExerciseTest[]): string {
  const lines = [TEST_COLUMNS.join(CSV_SEPARATOR)];
  const sorted = [...tests].sort(
    (left, right) => new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime(),
  );

  for (const test of sorted) {
    lines.push(
      csvLine([
        localDate(test.recordedAt),
        test.exerciseNameSnapshot,
        test.leftValue,
        test.rightValue,
        test.asymmetryPercent,
        test.notes,
      ]),
    );
  }

  return `${lines.join('\n')}\n`;
}

interface MetaContext {
  rows: AnalysisRow[];
  discarded: DiscardedSession[];
  exportedCount: number;
  totalSessions: number;
  exercises: { name: string; unilateral: boolean; snapshotModes: Set<TrackingMode> }[];
}

/**
 * Der Tracking-Modus einer Übung - aktueller Stand zuerst, Vergangenheit
 * daneben.
 *
 * `meta.uebungen` sah aus wie eine Auskunft über die Bibliothek und war eine
 * über die Sessions: der Modus kam aus dem Snapshot der Session-Übung. Wer den
 * Nordic Curl von `time` auf `reps_weight` umstellt, hat danach 27 alte
 * Snapshots mit `time` und zwei neue mit `reps_weight` - und der Export meldete
 * die Mehrheit, also die Vergangenheit. Eine Auswertung schloss daraus
 * prompt, die Umstellung sei nie angekommen, und empfahl sie ein zweites Mal.
 *
 * Deshalb steht hier jetzt der **Bibliothekswert** unter `trackingMode`, und
 * abweichende Snapshots stehen als `trackingModeHistorisch` daneben - das ist
 * dieselbe Unterscheidung, die `isLegacyExecution` in [progress.ts] intern
 * schon trifft, wenn der Verlauf alte Ausführungen still fallen lässt.
 *
 * Der Abgleich läuft über den **Namen**, wie überall im Import: der Export
 * trägt keine Ids. Findet sich die Übung nicht in der Bibliothek - umbenannt
 * oder gelöscht -, bleibt der Snapshot die bestmögliche Auskunft.
 */
function describeTrackingMode(
  name: string,
  snapshotModes: Set<TrackingMode>,
  library: Map<string, TrackingMode>,
): { trackingMode: TrackingMode; trackingModeHistorisch?: TrackingMode[] } {
  const snapshots = [...snapshotModes];
  const current = library.get(normalizeName(name)) ?? snapshots[snapshots.length - 1];
  const historic = snapshots.filter((mode) => mode !== current).sort();

  return historic.length > 0
    ? { trackingMode: current, trackingModeHistorisch: historic }
    : { trackingMode: current };
}

function buildMetaJson(input: AnalysisExportInput, context: MetaContext): string {
  const dates = [...new Set(context.rows.map((row) => row.datum))].sort();
  const library = new Map(
    input.exercises.map((exercise) => [normalizeName(exercise.name), exercise.trackingMode]),
  );

  return `${JSON.stringify(
    {
      exportiertAm: localIsoWithOffset(input.exportedAt),
      zeitraum: {
        von: dates[0] ?? null,
        bis: dates[dates.length - 1] ?? null,
      },
      programm: input.program?.name ?? null,
      aktiveWoche: input.weekControl.effectiveWeek,
      weekOverrideAktiv: input.weekControl.mode === 'override',
      sessions: {
        gesamt: context.totalSessions,
        exportiert: context.exportedCount,
        verworfen: context.totalSessions - context.exportedCount,
      },
      uebungen: context.exercises
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name, 'de'))
        .map((exercise) => ({
          name: exercise.name,
          ...describeTrackingMode(exercise.name, exercise.snapshotModes, library),
          unilateral: exercise.unilateral,
        })),
      bandLevels: [...input.bandLevels]
        .sort((left, right) => left.orderIndex - right.orderIndex)
        .map((band) => band.name),
      verworfeneSessions: context.discarded,
    },
    null,
    2,
  )}\n`;
}

/**
 * Dieselben vier Dateien als ein Text zum Einfügen.
 *
 * Das ZIP ist auf dem Telefon der längere Weg: sichern, App wechseln, Anhang
 * suchen - und ein Archiv wird am anderen Ende oft gar nicht ausgepackt. Über
 * die Zwischenablage geht derselbe Inhalt direkt in ein Gespräch. Der Import
 * hat neben dem Dateipicker aus genau diesem Grund längst ein Textfeld; das
 * hier ist die fehlende Hälfte davon.
 *
 * `meta.json` steht bewusst **zuerst**. Dort stehen Zeitraum, Programm, die
 * wirksame Woche samt `weekOverrideAktiv` und die Übungen mit ihrem
 * `trackingMode` - ohne das liest man die Tabelle darunter falsch und addiert
 * Sekunden zu Wiederholungen. Die verworfenen Sessions stehen aus demselben
 * Grund dort und nicht am Ende: was gefiltert wurde, gehört vor die Zahlen.
 */
export function buildAnalysisPasteText(
  files: AnalysisExportFiles,
  exportedAt: Date,
): string {
  return [
    `# Gym Book Analyse-Export ${toDateInputValue(exportedAt)}`,
    '',
    '## meta.json',
    '',
    '```json',
    files.metaJson.trimEnd(),
    '```',
    '',
    '## sessions.csv',
    '',
    '```csv',
    files.sessionsCsv.trimEnd(),
    '```',
    '',
    '## progression.csv',
    '',
    '```csv',
    files.progressionCsv.trimEnd(),
    '```',
    '',
    '## tests.csv',
    '',
    '```csv',
    files.testsCsv.trimEnd(),
    '```',
    '',
  ].join('\n');
}
