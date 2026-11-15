import { useId } from "react";

/** Brand mark: an orbit around a leaf-shaped polygon. Decorative. */
export function BrandMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="none">
      <ellipse cx="16" cy="16" rx="14" ry="6.5" transform="rotate(-28 16 16)" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
      <path d="M10 20c0-6 4-10 12-11-1 8-5 12-11 12" fill="currentColor" opacity="0.9" />
      <circle cx="26.5" cy="9" r="2" fill="currentColor" />
    </svg>
  );
}

/** A latitude and longitude grid behind the hero. Decorative; lines only, no gradient. */
export function Graticule({ className }: { className?: string }): JSX.Element {
  const id = useId();
  return (
    <svg aria-hidden="true" className={className}>
      <defs>
        <pattern id={`${id}-grid`} width="56" height="56" patternUnits="userSpaceOnUse">
          <path d="M56 0H0V56" fill="none" stroke="currentColor" strokeWidth="0.75" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-grid)`} />
    </svg>
  );
}

/** Corner brackets of a viewfinder around an image. Decorative. */
export function FrameCorners(): JSX.Element {
  const corner = "absolute h-4 w-4 border-brand-100";
  return (
    <span aria-hidden="true">
      <span className={`${corner} left-1 top-1 border-l-2 border-t-2`} />
      <span className={`${corner} right-1 top-1 border-r-2 border-t-2`} />
      <span className={`${corner} bottom-1 left-1 border-b-2 border-l-2`} />
      <span className={`${corner} bottom-1 right-1 border-b-2 border-r-2`} />
    </span>
  );
}
