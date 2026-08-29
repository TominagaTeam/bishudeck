import { useLayoutEffect, useRef, useState } from 'react';

const MARGIN = 32;

/**
 * Scale that fits a fixed logical stage size into the measured container.
 *
 * Slides render at their design size and are scaled visually rather than
 * reflowed, so viewport-relative CSS in the deck behaves the same at every zoom
 * level and in the presentation window.
 */
export function useFitScale(designWidth: number, designHeight: number, override: number | null) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(1);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const available = container.getBoundingClientRect();
      const width = Math.max(available.width - MARGIN * 2, 1);
      const height = Math.max(available.height - MARGIN * 2, 1);
      setFit(Math.min(width / designWidth, height / designHeight));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [designWidth, designHeight]);

  return { containerRef, scale: override ?? fit, fitScale: fit };
}
