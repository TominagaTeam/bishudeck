import type { ReactNode } from 'react';

/**
 * Toolbar glyphs.
 *
 * They are drawn inline rather than pulled from an icon font so the chrome has
 * no runtime dependency and every glyph inherits `currentColor` — a disabled or
 * hovered button tints its icon without a second rule. All of them are stroked
 * on the same 16-unit grid at the same weight, which is what keeps a row of
 * them looking like one set.
 *
 * The bar under the two colour glyphs is the one thing here that is not
 * `currentColor`: it *is* the value the button will apply, and a bar drawn in
 * the button's own text colour would say the same thing whatever was loaded.
 */
function Glyph({ children, fill }: { children: ReactNode; fill?: boolean }) {
  return (
    <svg
      className="glyph"
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden
      focusable="false"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const ImportIcon = () => (
  <Glyph>
    <path d="M8 2v7.5M5.2 6.8 8 9.6l2.8-2.8" />
    <path d="M2.8 11.2v1.6c0 .6.4 1 1 1h8.4c.6 0 1-.4 1-1v-1.6" />
  </Glyph>
);

export const ExportIcon = () => (
  <Glyph>
    <path d="M8 9.6V2.1M5.2 4.9 8 2.1l2.8 2.8" />
    <path d="M2.8 11.2v1.6c0 .6.4 1 1 1h8.4c.6 0 1-.4 1-1v-1.6" />
  </Glyph>
);

export const UndoIcon = () => (
  <Glyph>
    <path d="M3.4 6.6h6.1a3.2 3.2 0 0 1 0 6.4H6.8" />
    <path d="M6 3.9 3.3 6.6 6 9.3" />
  </Glyph>
);

export const RedoIcon = () => (
  <Glyph>
    <path d="M12.6 6.6H6.5a3.2 3.2 0 0 0 0 6.4h2.7" />
    <path d="M10 3.9l2.7 2.7L10 9.3" />
  </Glyph>
);

export const SlideIcon = () => (
  <Glyph>
    <rect x="2.2" y="3.4" width="11.6" height="9.2" rx="1.4" />
    <path d="M4.8 6.6h6.4M4.8 9.4h3.8" />
  </Glyph>
);

export const InsertIcon = () => (
  <Glyph>
    <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2" />
    <path d="M8 5.2v5.6M5.2 8h5.6" />
  </Glyph>
);

export const AlignIcon = () => (
  <Glyph>
    <path d="M2.6 2.6v10.8" />
    <path d="M5.4 5.2h7.4M5.4 10.8h4.6" />
  </Glyph>
);

export const EditIcon = () => (
  <Glyph>
    <path d="M10.6 2.6 13.4 5.4 6 12.8l-3.4.6.6-3.4z" />
    <path d="M9.2 4 12 6.8" />
  </Glyph>
);

export const PreviewIcon = () => (
  <Glyph>
    <path d="M1.6 8S4 4.4 8 4.4 14.4 8 14.4 8 12 11.6 8 11.6 1.6 8 1.6 8z" />
    <circle cx="8" cy="8" r="1.7" />
  </Glyph>
);

export const PlayIcon = () => (
  <Glyph fill>
    <path d="M5.4 3.4 12.6 8l-7.2 4.6z" />
  </Glyph>
);

export const ChevronIcon = () => (
  <Glyph>
    <path d="M4.6 6.6 8 10l3.4-3.4" />
  </Glyph>
);

export const HelpIcon = () => (
  <Glyph>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.3 6.2a1.8 1.8 0 1 1 2 2v1.1" />
    <path d="M8.3 11.4h.01" />
  </Glyph>
);

/**
 * The loaded colour, drawn twice.
 *
 * A bar the colour of the panel behind it would vanish, so a hairline in the
 * button's own text colour rides on top and keeps the edges. Both rects carry
 * their own `fill` and `stroke`: an element's own presentation attributes beat
 * what it would otherwise inherit from the `<svg>`, which is how these escape
 * `currentColor` without `Glyph` having to know about them.
 */
function ColorBar({ color }: { color: string }) {
  return (
    <>
      <rect x="2.4" y="12.2" width="11.2" height="2.6" rx="0.6" fill={color} stroke="none" />
      <rect
        x="2.4"
        y="12.2"
        width="11.2"
        height="2.6"
        rx="0.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        opacity="0.35"
      />
    </>
  );
}

export const TextColorIcon = ({ color }: { color: string }) => (
  <Glyph>
    <path d="M3.4 11.4 8 2.6l4.6 8.8" />
    <path d="M5.5 8.4h5" />
    <ColorBar color={color} />
  </Glyph>
);

export const HighlightIcon = ({ color }: { color: string }) => (
  <Glyph>
    <path d="M9.6 2.6 13.4 6.4 7.6 11.4H4V8.4z" />
    <path d="M7.2 4.8 11.2 8.8" />
    <ColorBar color={color} />
  </Glyph>
);

/**
 * 塗り: a box with its inside hatched, over the bar that says with what.
 *
 * The hatching is what tells it from {@link BorderColorIcon}, which is the same
 * box with nothing in it — the two sit in the same pane, one panel apart, and a
 * difference of outline weight alone would not carry at 15px.
 */
export const FillIcon = ({ color }: { color: string }) => (
  <Glyph>
    <rect x="3" y="3" width="10" height="7.4" rx="1" />
    <path d="M4.4 8.8 8 5.2M6.9 10.4l4-4" />
    <ColorBar color={color} />
  </Glyph>
);

/** 枠線の色: the box's outline alone, over the bar that colours it. */
export const BorderColorIcon = ({ color }: { color: string }) => (
  <Glyph>
    <rect x="3" y="3" width="10" height="7.4" rx="1" />
    <ColorBar color={color} />
  </Glyph>
);

/** The caret half of a split button. Smaller than `ChevronIcon`, which sits in
 *  toolbar buttons that have room for it. */
export const CaretIcon = () => (
  <Glyph>
    <path d="M5.6 6.8 8 9.2l2.4-2.4" />
  </Glyph>
);
