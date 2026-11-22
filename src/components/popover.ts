import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

const MARGIN = 12;
const GAP = 6;
/** Below this much room under the anchor, a popover opens upwards if there's more room above. */
const MIN_BELOW = 260;

/**
 * Position for a popover attached to `anchor`, in window coordinates (`position: fixed`), so it isn't clipped
 * by a scrolling container such as the track list. Kept inside the window; opens upwards near the bottom.
 */
export function useAnchoredPopover(open: boolean, anchor: RefObject<HTMLElement>, width: number) {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = Math.min(width, window.innerWidth - MARGIN * 2);
      const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - w - MARGIN));
      const below = window.innerHeight - r.bottom - GAP - MARGIN;
      const above = r.top - GAP - MARGIN;
      const up = below < MIN_BELOW && above > below;
      setStyle({
        position: 'fixed',
        left,
        width: w,
        ...(up
          ? { bottom: window.innerHeight - r.top + GAP, maxHeight: above }
          : { top: r.bottom + GAP, maxHeight: below }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, width]);
  return style;
}
