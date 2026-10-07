import type { SVGProps } from 'react';

interface MobilityIconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number | string;
  strokeWidth?: number | string;
}

/**
 * Eine Figur mit ausgebreiteten Armen - Mobility statt Kraft. Props wie bei
 * `RunIcon` und den lucide-Icons; selbst gezeichnet, lucide hat keine passende.
 */
export function MobilityIcon({ size = 24, strokeWidth = 2, className, ...rest }: MobilityIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {/* Kopf */}
      <circle cx="12" cy="4.2" r="2.4" />
      {/* Arme, ausgebreitet zur Schulter */}
      <path d="M3 8 10.5 10.5" />
      <path d="M21 8 13.5 10.5" />
      {/* Rumpf, kräftig: doppelte Strichstärke */}
      <path d="M12 10.5v5" strokeWidth={Number(strokeWidth) * 2} />
      {/* Beine */}
      <path d="M11 16 8.5 22" />
      <path d="M13 16 15.5 22" />
    </svg>
  );
}
