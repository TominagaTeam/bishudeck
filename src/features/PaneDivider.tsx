import { useRef, useState } from 'react';

import { PANES, useUiStore, type PaneId } from '../app/uiStore';
import { t } from '../shared/i18n';

/**
 * The seam between the canvas and a pane beside it.
 *
 * Resizing and hiding are the same intention at two amplitudes, so they share
 * one control: drag the seam to size the pane, click the chevron sitting on it
 * to put the pane away. The chevron stays visible while the pane is hidden —
 * once the pane has no edge of its own, it is the only thing left to aim at.
 *
 * Both seams are this component. Everything that differs between the left and
 * right pane is a lookup in `PANES`, so the two can never drift apart.
 */
export function PaneDivider({ pane }: { pane: PaneId }) {
  const spec = PANES[pane];
  const { width, collapsed } = useUiStore((s) => s.panes[pane]);
  const setWidth = useUiStore((s) => s.setPaneWidth);
  const toggle = useUiStore((s) => s.togglePane);

  const dragging = useRef(false);
  const [active, setActive] = useState(false);

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed) return;
    // Without this the press also starts a text selection, and a selection that
    // begins next to a `draggable` element makes the browser start *that*
    // element's HTML5 drag instead. The resulting `pointercancel` took the
    // capture away again, so the left seam moved a dozen pixels and stopped
    // while the right one — with no draggable neighbour — worked fine.
    //
    // `user-select: none` on `.pane-divider` suppresses the same `selectstart`
    // on its own; measured, either alone is enough. Both are kept because they
    // fail differently: the rule also stops the seam from highlighting text
    // under a slow drag, and this line survives a stylesheet that loses it.
    event.preventDefault();
    dragging.current = true;
    setActive(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    // Measured against the workspace rather than the window so the divider does
    // not have to know what sits on the far side of it. A pane's width is its
    // distance from the edge it is pinned to, whichever edge that is.
    const host = event.currentTarget.parentElement;
    if (!host) return;
    const box = host.getBoundingClientRect();
    setWidth(pane, spec.side === 'left' ? event.clientX - box.left : box.right - event.clientX);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const paneName = t(spec.nameKey);
  const label = collapsed ? t('pane.show', { pane: paneName }) : t('pane.hide', { pane: paneName });

  return (
    <div
      className={`pane-divider ${spec.side}${collapsed ? ' collapsed' : ''}${active ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('pane.width', { pane: paneName })}
      aria-valuenow={collapsed ? 0 : width}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      onPointerDown={beginDrag}
      onPointerMove={drag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => toggle(pane)}
    >
      <button
        className="pane-toggle"
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={!collapsed}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => toggle(pane)}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden focusable="false">
          <path
            d="M10 3.5 5.5 8l4.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
