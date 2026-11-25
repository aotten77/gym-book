import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight } from 'lucide-react';
import { RestrictionSheet } from '@/components/RestrictionSheet';
import { loadRestrictionCards } from '@/db/restriction-queries';
import { useTodayKey } from '@/hooks/useTodayKey';
import { formatNumber } from '@/lib/format';

/**
 * Die Karte „Einschränkungen“ auf der Plan-Seite: nur, solange es aktive oder
 * angekündigte gibt. Je Zeile Name, Zeitraum („bis 14.12.“, „ab 01.12.“,
 * „ohne Enddatum“) und die Zahl der Ziele, die es gibt; ein Tipp öffnet das
 * Sheet mit Grund, Zielen und „Aufheben“.
 *
 * Neutral wie die übrigen Kopfzeilen: eine Einschränkung ist eine Auskunft,
 * kein Alarm - kein Lime, kein Rot (`docs/architecture/ui-palette.md`).
 */
export function RestrictionsCard() {
  const todayKey = useTodayKey();
  const cards = useLiveQuery(() => loadRestrictionCards(new Date()), [todayKey]);
  const [openId, setOpenId] = useState<string | null>(null);
  const openCard = cards?.find((card) => card.restriction.id === openId);

  if (!cards || cards.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Einschränkungen"
      data-restrictions-card=""
      className="rounded-panel border border-line bg-surface px-3 py-1.5"
    >
      <h2 className="pt-1 text-xs font-bold uppercase tracking-wide text-content-muted">
        Einschränkungen
      </h2>
      <ul className="divide-y divide-line">
        {cards.map((card) => (
          <li key={card.restriction.id}>
            <button
              type="button"
              data-restriction-row={card.restriction.name}
              onClick={() => setOpenId(card.restriction.id)}
              className="flex min-h-touch w-full items-center gap-3 rounded-control text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="min-w-0 flex-1 break-words font-semibold text-content">
                {card.restriction.name}
              </span>
              <span className="shrink-0 whitespace-nowrap text-content-secondary">
                {card.period} · {formatNumber(card.liveTargetCount)}{' '}
                {card.liveTargetCount === 1 ? 'Ziel' : 'Ziele'}
              </span>
              <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-content-muted" />
            </button>
          </li>
        ))}
      </ul>

      {openCard ? <RestrictionSheet card={openCard} onClose={() => setOpenId(null)} /> : null}
    </section>
  );
}
