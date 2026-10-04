import type { SVGProps } from 'react';

interface RunIconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number | string;
  strokeWidth?: number | string;
}

/**
 * Ein Läufer im Schritt - Props wie bei den lucide-Icons, damit er neben ihnen
 * steht, ohne dass ein Aufrufer den Unterschied merkt. Lucide hat keinen.
 */
export function RunIcon({ size = 24, strokeWidth = 2, className, ...rest }: RunIconProps) {
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
      <circle cx="15.5" cy="4" r="1.5" />
      {/* Rumpf, nach vorn geneigt */}
      <path d="M13 8.5 10.5 14" />
      {/* Arm vor, Arm zurück */}
      <path d="m13 8.5 4 2.5" />
      <path d="m13 8.5-3.5.5-2 3" />
      {/* Bein vor, Bein zurück */}
      <path d="m10.5 14 3.5 2.5-1 4.5" />
      <path d="m10.5 14-3.5 4H3.5" />
    </svg>
  );
}
