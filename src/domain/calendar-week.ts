/**
 * Kalenderwoche - die Woche am Kalender, Montag bis Sonntag, in der Zeitzone
 * des Geräts.
 *
 * Der lange Name ist Absicht: "Woche" ist in diesem Repo doppelt belegt.
 * `Program.activeWeek`, `settings.weekOverride` und `resolvedProgramWeek` sind
 * eine **von Hand gestellte Programmwoche** - eine Zahl, die der Nutzer
 * weiterschaltet und die nirgends aus einem Datum abgeleitet wird. Was hier
 * steht, hat damit nichts zu tun und darf nie gegeneinander gerechnet werden:
 * Programmwoche 3 sagt nichts darüber, welcher Montag gerade war.
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
