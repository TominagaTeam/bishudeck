/**
 * Smart guides.
 *
 * While something is being dragged its edges and centre are compared against
 * the same lines on every other element, plus the slide's own edges and middle.
 * When one is within a few pixels the move is nudged onto it exactly and a
 * guide is drawn, which is what makes aligning by hand feel precise.
 */

import type { Bounds } from './geometry';

/** In stage pixels. Generous enough to catch, tight enough not to fight. */
const THRESHOLD = 6;

export interface Guide {
  orientation: 'vertical' | 'horizontal';
  /** Stage coordinate of the line. */
  position: number;
  /** Extent along the line, so the guide only spans the elements it relates. */
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

/**
 * Which of the moving box's own lines are allowed to attract.
 *
 * A move offers all six, because the whole box travels. A resize only offers
 * the edge under the pointer: dragging the east handle must not let the west
 * edge find a guide and slide the box sideways. Omitting an axis keeps all
 * three of its lines, so the existing callers are unaffected; an empty array
 * offers none of them, which is how a Shift-locked move keeps its still axis
 * out of the search.
 */
export interface SnapEdges {
  x?: ('left' | 'center' | 'right')[];
  y?: ('top' | 'middle' | 'bottom')[];
}

interface Candidate {
  position: number;
  from: number;
  to: number;
}

/**
 * @param moving   Bounds of the dragged selection at its unsnapped position.
 * @param others   Bounds of everything it can align to.
 * @param slide    The slide's own bounds, so edges and centre also attract.
 * @param edges    Which of `moving`'s own lines may attract; all six by default.
 */
export function snapToGuides(
  moving: Bounds,
  others: Bounds[],
  slide: Bounds,
  edges?: SnapEdges,
): SnapResult {
  const verticals: Candidate[] = [];
  const horizontals: Candidate[] = [];

  for (const other of [...others, slide]) {
    for (const position of [other.left, (other.left + other.right) / 2, other.right]) {
      verticals.push({ position, from: other.top, to: other.bottom });
    }
    for (const position of [other.top, (other.top + other.bottom) / 2, other.bottom]) {
      horizontals.push({ position, from: other.left, to: other.right });
    }
  }

  const movingX = pick(
    {
      left: moving.left,
      center: (moving.left + moving.right) / 2,
      right: moving.right,
    },
    edges?.x,
  );
  const movingY = pick(
    {
      top: moving.top,
      middle: (moving.top + moving.bottom) / 2,
      bottom: moving.bottom,
    },
    edges?.y,
  );

  const x = bestSnap(movingX, verticals);
  const y = bestSnap(movingY, horizontals);

  const guides: Guide[] = [];
  if (x) {
    guides.push({
      orientation: 'vertical',
      position: x.candidate.position,
      from: Math.min(x.candidate.from, moving.top),
      to: Math.max(x.candidate.to, moving.bottom),
    });
  }
  if (y) {
    guides.push({
      orientation: 'horizontal',
      position: y.candidate.position,
      from: Math.min(y.candidate.from, moving.left),
      to: Math.max(y.candidate.to, moving.right),
    });
  }

  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, guides };
}

/** The named lines of one axis, or all of them when the caller did not choose. */
function pick<K extends string>(lines: Record<K, number>, wanted?: K[]): number[] {
  const names = wanted ?? (Object.keys(lines) as K[]);
  return names.map((name) => lines[name]);
}

function bestSnap(
  edges: number[],
  candidates: Candidate[],
): { delta: number; candidate: Candidate } | null {
  let best: { delta: number; candidate: Candidate } | null = null;

  for (const edge of edges) {
    for (const candidate of candidates) {
      const delta = candidate.position - edge;
      if (Math.abs(delta) > THRESHOLD) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, candidate };
    }
  }
  return best;
}

export function shiftBounds(bounds: Bounds, dx: number, dy: number): Bounds {
  return {
    left: bounds.left + dx,
    top: bounds.top + dy,
    right: bounds.right + dx,
    bottom: bounds.bottom + dy,
  };
}
