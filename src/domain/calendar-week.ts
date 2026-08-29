/**
 * Kalenderwoche - die Woche am Kalender, Montag bis Sonntag, in der Zeitzone
 * des Geräts.
 *
 * Der lange Name ist Absicht: "Woche" ist in diesem Repo doppelt belegt.
 * `Program.activeWeek`, `settings.weekOverride` und `resolvedProgramWeek` sind
 * eine **Programmwoche** - die Nummer der Woche *innerhalb* eines Programms.
 * Was hier steht, ist die Woche am Kalender und beantwortet eine andere Frage:
 * Programmwoche 3 sagt für sich genommen nicht, welcher Montag gerade war.
 *
 * Eine einzige Brücke gibt es zwischen beiden: trägt ein Programm ein
 * `startedOn`, zählt `deriveProgramWeek` in [program.ts] die Kalenderwochen
 * seit diesem Montag - über `calendarWeeksBetween` hier unten und nirgendwo
 * sonst. Ohne Startdatum bleibt die Programmwoche das, was sie war: eine Zahl,
 * die von Hand weitergeschaltet wird.
 *
 * Dieselbe Brücke gibt es einmal rückwärts, und auch nur einmal:
 * `programWeekStart` in [training-calendar.ts] rechnet von der Programmwoche
 * auf ihren Montag zurück, damit der Kalender Termine anzeigen kann. Beide
 * Richtungen müssen zueinander passen, deshalb rechnen beide über
 * `startOfCalendarWeek` und über ganze Tage - nie über 7 x 24 Stunden.
 */

const DAYS_PER_WEEK = 7;

/**
 * Montag 00:00 Uhr Ortszeit der Woche, in der `now` liegt.
 *
 * `getDay()` zählt ab Sonntag; `(day + 6) % 7` dreht das auf einen Montag als
 * Wochenanfang, wie hierzulande üblich.
 */
export function startOfCalendarWeek(now: Date): Date {
  const start = new Date(now.getTime());
  const offset = (start.getDay() + 6) % DAYS_PER_WEEK;

  start.setDate(start.getDate() - offset);
  start.setHours(0, 0, 0, 0);

  return start;
}

/**
 * Liest ein Datum als **Ortszeit**.
 *
 * `new Date('2026-08-24')` ist laut Norm Mitternacht UTC - westlich von
 * Greenwich landet der Wert damit einen Tag früher und im Zweifel in der
 * Vorwoche. Ein reines Datum ohne Uhrzeit meint aber den Tag am Ort des
 * Geräts, deshalb wird es von Hand zerlegt. Zeitstempel mit Uhrzeit gehen
 * unverändert durch.
 */
export function parseLocalDate(value: string): Date | undefined {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Volle Kalenderwochen zwischen zwei Zeitpunkten, gezählt von Montag zu Montag.
 *
 * Gerechnet wird über die Differenz der beiden Wochenanfänge geteilt durch
 * sieben Tage - und zwar gerundet, nicht abgeschnitten: zwischen zwei Montagen
 * liegen an der Zeitumstellung 167 oder 169 Stunden, und eine Division mit
 * `floor` machte daraus je nach Richtung eine Woche zu wenig. Ein Datum vor
 * `now` ergibt eine negative Zahl; das Klemmen ist Sache des Aufrufers.
 */
export function calendarWeeksBetween(startIso: string, now: Date): number | undefined {
  const start = parseLocalDate(startIso);

  if (!start) {
    return undefined;
  }

  const startWeek = startOfCalendarWeek(start).getTime();
  const nowWeek = startOfCalendarWeek(now).getTime();

  return Math.round((nowWeek - startWeek) / (DAYS_PER_WEEK * 24 * 60 * 60 * 1000));
}

/**
 * Liegt der Zeitstempel in derselben Kalenderwoche wie `now`?
 *
 * Das Ende der Woche wird über `setDate(+7)` gebildet und nicht über sieben mal
 * 24 Stunden: an der Zeitumstellung ist eine Woche 167 oder 169 Stunden lang,
 * und der Sonntagabend fiele sonst heraus oder der nächste Montag hinein.
 */
export function isInCalendarWeek(iso: string, now: Date): boolean {
  const value = new Date(iso);

  if (Number.isNaN(value.getTime())) {
    return false;
  }

  const start = startOfCalendarWeek(now);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + DAYS_PER_WEEK);

  return value.getTime() >= start.getTime() && value.getTime() < end.getTime();
}
