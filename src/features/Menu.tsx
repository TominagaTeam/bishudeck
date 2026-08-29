import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { shortcutHint, type ShortcutId } from '../shared/shortcuts';
import { ChevronIcon } from './icons';

interface MenuProps {
  label: string;
  /** Drawn before the label, like the ribbon groups it stands in for. */
  icon?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}

/**
 * Closes a popup on an outside click or Escape.
 *
 * Shared with the stage's context menu, which has no trigger button of its own
 * but has to dismiss exactly the same way.
 */
export function useDismiss(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, active, onDismiss]);
}

/** A toolbar drop-down that closes on outside click or Escape. */
export function Menu({ label, icon, disabled, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useDismiss(rootRef, open, useCallback(() => setOpen(false), []));

  return (
    <div className="menu" ref={rootRef}>
      <button
        className={open ? 'active' : ''}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {label}
        <ChevronIcon />
      </button>
      {open && (
        <div className="menu-popup" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The hint takes a shortcut *id*, not a spelling: the glyphs used to be typed
 * in by hand here and in the context menu, which meant Windows was shown ⌘ and
 * a rebound key was shown the old one. `shared/shortcuts` answers both.
 */
export function MenuItem({
  label,
  shortcut,
  disabled,
  onSelect,
  onPreview,
}: {
  label: string;
  shortcut?: ShortcutId;
  disabled?: boolean;
  onSelect(): void;
  /**
   * Fired while the row is being pointed at or focused, for items whose label
   * cannot say on its own which thing it means — `div.card` in a deck full of
   * wrappers. The breadcrumb answers the same problem the same way, and for
   * the same reason: show it rather than make them pick to find out.
   */
  onPreview?(on: boolean): void;
}) {
  return (
    <button
      className="menu-item"
      disabled={disabled}
      onClick={onSelect}
      onPointerEnter={onPreview && (() => onPreview(true))}
      onPointerLeave={onPreview && (() => onPreview(false))}
      onFocus={onPreview && (() => onPreview(true))}
      onBlur={onPreview && (() => onPreview(false))}
    >
      <span>{label}</span>
      {shortcut && <kbd>{shortcutHint(shortcut)}</kbd>}
    </button>
  );
}

/** A heading over a run of items. Says nothing and does nothing on its own. */
export function MenuLabel({ text }: { text: string }) {
  return <p className="menu-label">{text}</p>;
}

export function MenuSeparator() {
  return <div className="menu-separator" />;
}
