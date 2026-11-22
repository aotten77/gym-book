import type { SVGProps } from 'react';

interface YogaIconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number | string;
  strokeWidth?: number | string;
}

/**
 * Eine Figur im Schneidersitz, die Hände auf den Knien - Yoga. Props wie bei
 * `MobilityIcon`; selbst gezeichnet, lucide hat keine passende.
 */
export function YogaIcon({ size = 24, strokeWidth = 2, className, ...rest }: YogaIconProps) {
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
      <circle cx="12" cy="4.2" r="2.2" />
      {/* Rumpf */}
      <path d="M12 8.5v6" />
      {/* Arme, auf die Knie gestützt */}
      <path d="M6 15 9.5 10h5L18 15" />
      {/* Verschränkte Beine */}
      <path d="M4 19.5c3-3.5 13-3.5 16 0" />
      <path d="M4 19.5h16" />
    </svg>
  );
}
