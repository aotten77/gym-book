import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Sheet } from '@/components/ui/Sheet';
import { liftRestriction } from '@/db/restriction-actions';
import type { RestrictionCard } from '@/db/restriction-queries';
import { formatRestrictionDate } from '@/domain/restriction';
import { cn } from '@/lib/utils';

interface RestrictionSheetProps {
  card: RestrictionCard;
  onClose: () => void;
}

/**
 * Das Sheet einer Einschränkung: Grund, Zeitraum, die Ziele in Klarnamen und
 * „Aufheben“. Ziele, die es nicht mehr gibt oder die derzeit nichts treffen,
 * stehen ausgegraut mit ihrem Zustand da - sie zählen nicht, gelöscht wird
 * nichts.
 *
 * „Aufheben“ ist der einzige Schreibweg der App (`liftRestriction`) und steht
 * hinter einer Rückfrage. Ändern und Anlegen gehen nur über den Import.
 */
export function RestrictionSheet({ card, onClose }: RestrictionSheetProps) {
  const { restriction } = card;
  const [isAsking, setIsAsking] = useState(false);
  const [isLifting, setIsLifting] = useState(false);
  const [error, setError] = useState<string>();
  const period =
    restriction.until === undefined
      ? `ab ${formatRestrictionDate(restriction.from)}, ohne Enddatum`
      : `${formatRestrictionDate(restriction.from)} – ${formatRestrictionDate(restriction.until)}`;

  async function handleLift() {
    setIsLifting(true);
    setError(undefined);

    try {
      await liftRestriction(restriction.id);
      setIsAsking(false);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Die Einschränkung ließ sich nicht aufheben.');
      setIsAsking(false);
    } finally {
      setIsLifting(false);
    }
  }

  const header = (
    <div className="min-w-0">
      <h2 className="break-words font-display text-xl font-bold text-content">{restriction.name}</h2>
      <p className="text-sm text-content-secondary">
        {card.state === 'aktiv' ? 'Aktiv' : 'Angekündigt'} · {period}
      </p>
    </div>
  );

  return (
    <>
      <Sheet
        open
        label={restriction.name}
        closeLabel="Einschränkung schließen"
        header={header}
        onClose={onClose}
      >
        <div className="space-y-4" data-restriction-sheet="">
          {error ? <Alert>{error}</Alert> : null}

          {restriction.reason ? (
            <p className="whitespace-pre-line break-words text-[15px] text-content-secondary">
              {restriction.reason}
            </p>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-content-muted">Ziele</h3>
            <ul className="space-y-2">
              {card.targets.map((target, index) => (
                <li
                  key={index}
                  data-restriction-target={target.status}
                  className={cn(
                    'rounded-panel border border-line px-3 py-2 text-sm',
                    target.status === 'ok'
                      ? 'bg-surface text-content'
                      : 'bg-surface-sunken text-content-secondary',
                  )}
                >
                  <p className="break-words">{target.label}</p>
                  {target.status === 'ok' ? null : (
                    <p className="text-xs font-semibold">{target.status}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <p className="text-sm text-content-muted">
            Einschränkungen kommen per Import aus dem Projekt. Hier lässt sich eine nur aufheben.
          </p>

          <Button variant="secondary" className="w-full" onClick={() => setIsAsking(true)}>
            Aufheben
          </Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={isAsking}
        title={`${restriction.name} aufheben?`}
        description="Ab sofort gilt sie nicht mehr. Schon gestartete und vergangene Einheiten bleiben, wie sie sind."
        confirmLabel="Aufheben"
        cancelLabel="Abbrechen"
        busy={isLifting}
        onConfirm={() => void handleLift()}
        onCancel={() => setIsAsking(false)}
      />
    </>
  );
}
