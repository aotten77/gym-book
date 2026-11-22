import type { SVGProps } from 'react';

interface FasciaIconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number | string;
  strokeWidth?: number | string;
}

/**
 * Eine Faszienrolle von der Stirnseite, auf dem Boden liegend - Faszien. Props
 * wie bei `MobilityIcon`; selbst gezeichnet, lucide hat keine passende.
 */
export function FasciaIcon({ size = 24, strokeWidth = 2, className, ...rest }: FasciaIconProps) {
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
      {/* Rolle und ihr Kern */}
      <circle cx="12" cy="11" r="7" />
      <circle cx="12" cy="11" r="2.5" />
      {/* Boden */}
      <path d="M4 21h16" />
    </svg>
  );
}
