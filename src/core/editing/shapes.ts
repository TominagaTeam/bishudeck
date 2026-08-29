/**
 * Markup for the things a slide tool inserts.
 *
 * Everything is plain HTML with inline styles and no editor-specific classes,
 * so an inserted shape is indistinguishable from one the deck's author wrote
 * and survives export into any browser.
 */

import { DEFAULT_FONT_STACK } from '../../shared/fonts';

export type ShapeKind = 'rectangle' | 'ellipse' | 'triangle' | 'line' | 'arrow';

const ACCENT = '#3884ff';

export interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Drops new elements near the middle of the slide, where the eye already is. */
export function defaultPlacement(
  slideWidth: number,
  slideHeight: number,
  width: number,
  height: number,
): Placement {
  return {
    left: Math.round((slideWidth - width) / 2),
    top: Math.round((slideHeight - height) / 2),
    width,
    height,
  };
}

/** The text a new box is set in, and what one line of it comes to. */
const TEXT_BOX_FONT_PX = 28;
const TEXT_BOX_LINE_HEIGHT = 1.5;

/**
 * What a new text box is worth before anything is typed into it.
 *
 * The height is **one line**, and it is a floor rather than a size: the box is
 * given `min-height` and no `height`, so the browser sizes it to what is in it
 * and a Return makes it taller as the line lands. Nothing has to watch the
 * typing for that — which matters, because the stage frame runs no scripts and
 * the host cannot see a keystroke inside it (ADR-0002). The height that used to
 * be written here was a flat 90px, and it stayed 90px however many lines were
 * put in it.
 *
 * The floor is what keeps the empty box findable. With no height at all an
 * empty one is zero pixels tall — the prompt painted over it is a pseudo-element
 * out of flow (stage/placeholder.ts) and adds nothing to the box — so the
 * selection frame and the handles would be drawn on a line with no thickness,
 * and there would be nothing to grab.
 */
export const TEXT_BOX_SIZE = {
  width: 520,
  height: Math.round(TEXT_BOX_FONT_PX * TEXT_BOX_LINE_HEIGHT),
};

/**
 * A new text box starts empty: no word the editor picked may be left behind in
 * someone's deck, which is what happened while the box was inserted holding
 * 「テキストを入力」 as real text.
 *
 * An empty box is invisible, so three things stand in for its contents, and
 * none of them is markup. It lands *selected* rather than open for typing, so
 * the handles are what say "there is a box here" and moving it is the first
 * thing that can be done with it; the stage paints a placeholder over it while
 * it is merely selected as well as while it is being typed into
 * (stage/placeholder.ts); and if it is still empty when it is let go of — the
 * selection moves elsewhere, the slide changes, a text session on it ends, the
 * deck's shape is about to change — the insertion is taken back
 * (core/editing/textBox.ts).
 *
 * It carries the editor's default family explicitly rather than inheriting the
 * deck's: it is inserted on top of someone else's layout, and inheriting
 * whatever the slide root happens to set produces surprises more often than it
 * produces a match.
 */
export function textBoxHtml(place: Placement): string {
  return (
    `<div style="${anchor(place)}width:${place.width}px;min-height:${place.height}px;` +
    `font-family:${DEFAULT_FONT_STACK};font-size:${TEXT_BOX_FONT_PX}px;` +
    `line-height:${TEXT_BOX_LINE_HEIGHT};color:#14161a;"></div>`
  );
}

export function shapeHtml(kind: ShapeKind, place: Placement): string {
  switch (kind) {
    case 'rectangle':
      return `<div style="${position(place)}background:${ACCENT};border-radius:8px;"></div>`;
    case 'ellipse':
      return `<div style="${position(place)}background:${ACCENT};border-radius:50%;"></div>`;
    case 'triangle':
      return (
        `<div style="${position(place)}background:${ACCENT};` +
        `clip-path:polygon(50% 0%, 100% 100%, 0% 100%);"></div>`
      );
    case 'line':
      return svgWrapper(
        place,
        `<line x1="0" y1="${place.height / 2}" x2="${place.width}" y2="${place.height / 2}" ` +
          `stroke="${ACCENT}" stroke-width="4" stroke-linecap="round" />`,
      );
    case 'arrow':
      return svgWrapper(
        place,
        `<defs><marker id="hse-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" ` +
          `orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="${ACCENT}" /></marker></defs>` +
          `<line x1="0" y1="${place.height / 2}" x2="${place.width - 12}" y2="${place.height / 2}" ` +
          `stroke="${ACCENT}" stroke-width="4" stroke-linecap="round" ` +
          `marker-end="url(#hse-arrow)" />`,
      );
  }
}

export function imageHtml(src: string, place: Placement): string {
  return (
    `<img src="${escapeAttribute(src)}" alt="" ` +
    `style="${position(place)}object-fit:contain;" />`
  );
}

function svgWrapper(place: Placement, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${place.width} ${place.height}" ` +
    `style="${position(place)}overflow:visible;">${body}</svg>`
  );
}

function position(place: Placement): string {
  return `${anchor(place)}width:${place.width}px;height:${place.height}px;`;
}

/** Where a thing sits, without saying how big it is. */
function anchor(place: Placement): string {
  return `position:absolute;left:${place.left}px;top:${place.top}px;`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
