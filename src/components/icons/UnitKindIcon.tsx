import { Dumbbell, Scale } from 'lucide-react';
import { FasciaIcon } from '@/components/icons/FasciaIcon';
import { MobilityIcon } from '@/components/icons/MobilityIcon';
import { RunIcon } from '@/components/icons/RunIcon';
import { YogaIcon } from '@/components/icons/YogaIcon';
import type { CalendarUnitKind } from '@/domain/training-calendar';

interface UnitKindIconProps {
  kind: CalendarUnitKind;
  size?: number;
  className?: string;
}

/**
 * Das Zeichen einer Einheit: Hantel (Kraft), Figur mit Armen (Mobility),
 * Schneidersitz (Yoga), Rolle (Faszien), Läufer (Lauf), Waage (Seitenvergleich).
 */
export function UnitKindIcon({ kind, size = 18, className }: UnitKindIconProps) {
  if (kind === 'mobility') {
    return <MobilityIcon size={size} className={className} aria-hidden="true" />;
  }

  if (kind === 'yoga') {
    return <YogaIcon size={size} className={className} aria-hidden="true" />;
  }

  if (kind === 'faszien') {
    return <FasciaIcon size={size} className={className} aria-hidden="true" />;
  }

  if (kind === 'run') {
    return <RunIcon size={size} className={className} aria-hidden="true" />;
  }

  if (kind === 'test') {
    return <Scale size={size} className={className} aria-hidden="true" />;
  }

  return <Dumbbell size={size} className={className} aria-hidden="true" />;
}
