import { useEffect, useState } from 'react';
import { toDateInputValue } from '@/domain/program';

/**
 * Der lokale Tag als `YYYY-MM-DD`, und er folgt dem Kalender.
 *
 * Eine installierte App bleibt über Nacht offen. Ohne Neulesen stünde morgens
 * noch gestern als „heute“ da, samt Lime-Karte. Neu gelesen wird deshalb bei
 * der Rückkehr in den Vordergrund (`visibilitychange` → `visible`), bei
 * `focus` und jede Minute - so, wie es früher die Programmseite für sich tat. Der Zustand
 * ändert sich nur, wenn der Tag wirklich wechselt; sonst rendert nichts neu.
 */
export function useTodayKey(): string {
  const [todayKey, setTodayKey] = useState(() => toDateInputValue(new Date()));

  useEffect(() => {
    function checkDay() {
      setTodayKey(toDateInputValue(new Date()));
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        checkDay();
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', checkDay);
    const interval = window.setInterval(checkDay, 60_000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', checkDay);
      window.clearInterval(interval);
    };
  }, []);

  return todayKey;
}
