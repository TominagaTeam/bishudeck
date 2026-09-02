import { useCallback, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { t } from '../shared/i18n';
import { PRESET_COLORS, SWATCH_COLUMNS, nextSwatchIndex } from './colorPalette';
import { CaretIcon } from './icons';
import { useDismiss } from './Menu';
import { sameColor } from './styleValues';

interface ColorPickerProps {
  /** What the left button will write, and what the glyph's bar shows. */
  color: string;
  /** Draws the glyph. Takes the colour so the bar under it is the live value. */
  icon: (props: { color: string }) => ReactElement;
  applyLabel: string;
  paletteLabel: string;
  /** Greyed out and unworkable, for a scope this colour cannot reach — the
   *  highlighter outside a text session, which has no element-wide meaning.
   *  The palette is shut with it: a popup that
   *  outlived the button that opened it would be a menu whose picks go
   *  nowhere. */
  disabled?: boolean;
  onPick(color: string): void;
}

/**
 * A split button: apply on the left, choose on the right.
 *
 * A single `<input type="color">` could only ever act on *change*, so the one
 * thing a colour is most often wanted for — putting the same colour on another
 * run of words — had no gesture at all: the value was already what the user
 * wanted, so nothing fired. Splitting it gives the repeat
 * its own button and moves the choosing into a palette that opens in place.
 *
 * The palette is a plain child, not a portal. Three separate mechanisms read
 * the real DOM to decide what this popup belongs to — whether the text session
 * survives a click on it (`data-hse-text-tools`, stage/EditStage.tsx), whether
 * an outside click should close it (`useDismiss`), and whether it scrolls with
 * the pane. All three are right for free while it stays inside the button; a
 * portal would break all three at once.
 */
export function ColorPicker({
  color,
  icon: Icon,
  applyLabel,
  paletteLabel,
  disabled = false,
  onPick,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useDismiss(
    rootRef,
    open,
    useCallback(() => setOpen(false), []),
  );

  /**
   * Always the argument, never `color`.
   *
   * The handler was made a render ago with whatever was loaded then, so reading
   * the draft here would apply the colour the user replaced rather than the one
   * they just pressed.
   */
  const pick = (next: string) => {
    onPick(next);
    setOpen(false);
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const swatches = Array.from(gridRef.current?.querySelectorAll('button') ?? []);
    const current = swatches.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const next = nextSwatchIndex(current, event.key, swatches.length);
    // Null is both "not an arrow" and "already at the edge", and the event has
    // to stay the browser's in either case — Tab still has to leave the grid.
    if (next === null) return;
    event.preventDefault();
    swatches[next].focus();
  };

  return (
    <div className="color-picker" ref={rootRef}>
      {/* Nothing but the glyph goes in here: the name is carried by `title` and
          `aria-label`, so the button stays as narrow as the icon. */}
      <button
        className="color-apply"
        title={applyLabel}
        aria-label={applyLabel}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(color)}
      >
        <Icon color={color} />
      </button>
      {/* The caret does not apply anything, but the swatch the user presses
          next does — and losing the frame's selection on the way there would
          leave that press with nothing to act on. */}
      <button
        className="color-open"
        title={paletteLabel}
        aria-label={paletteLabel}
        aria-haspopup="true"
        aria-expanded={open && !disabled}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        <CaretIcon />
      </button>
      {/* `!disabled` as well as `open`: the state survives a trip out of the
          session (the store is not reset by it), so a palette left open when the
          caret went grey would otherwise still be sitting there. */}
      {open && !disabled && (
        <div className="color-popup">
          <div
            className="color-grid"
            ref={gridRef}
            style={{ gridTemplateColumns: `repeat(${SWATCH_COLUMNS}, minmax(0, 1fr))` }}
            onKeyDown={onGridKeyDown}
          >
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset}
                className="color-swatch"
                style={{ background: preset }}
                /* A hex code is the name here. Translating it would take the
                   one thing the value says, like a typeface's name. */
                title={preset}
                aria-current={sameColor(preset, color)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(preset)}
              />
            ))}
          </div>
          {/* The way out of the table. A deck is free to use any colour, and
              the OS dialog is still the only place to mix one. */}
          <label className="color-more">
            {t('text.colorMore')}
            <input
              type="color"
              value={color}
              onMouseDown={(e) => e.preventDefault()}
              onChange={(e) => pick(e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
