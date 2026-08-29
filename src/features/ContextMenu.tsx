import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useDismiss } from './Menu';

/** Kept clear of the window edge so the last item is never half off-screen. */
const VIEWPORT_MARGIN = 8;

/**
 * A menu placed at a point rather than under a button.
 *
 * Rendered into `document.body` on purpose. The stage sits inside
 * `.stage-surface`, which carries a `transform: scale()` — and a transformed
 * ancestor becomes the containing block for `position: fixed`, so anything
 * drawn inside the stage would be measured from the surface's origin *and*
 * scaled by the current zoom. The portal is what keeps this menu the same size
 * at 25% and at 200%.
 *
 * It shares `MenuItem`, `.menu-popup` and the dismissal behaviour with the
 * toolbar's {@link Menu}; only the placement differs.
 */
export function ContextMenu({
  at,
  onClose,
  children,
}: {
  at: { x: number; y: number };
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, true, onClose);

  // Measured after layout: the menu's size depends on the items in it, and the
  // items depend on what was clicked.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
    element.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(at.x, maxLeft))}px`;
    element.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(at.y, maxTop))}px`;
  }, [at.x, at.y]);

  return createPortal(
    <div
      ref={ref}
      className="menu-popup floating"
      style={{ left: at.x, top: at.y }}
      onClick={onClose}
      onContextMenu={useCallback((event: React.MouseEvent) => event.preventDefault(), [])}
    >
      {children}
    </div>,
    document.body,
  );
}
