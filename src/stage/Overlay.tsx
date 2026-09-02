import { boundsOf, type OrientedBox } from './geometry';
import { cursorForHandle } from './handleCursor';
import { formatMeasure, type GestureMeasure } from './measure';
import type { Handle } from './interactions';
import type { Guide } from './snapping';

interface OverlayProps {
  /** The selected element's box. One at a time; there is no multi-selection. */
  selection: OrientedBox | null;
  hover: OrientedBox | null;
  /** Element the breadcrumb is pointing at; a preview of what a crumb selects. */
  focus: OrientedBox | null;
  guides: Guide[];
  /** Live gesture readout, drawn as a badge beside the selection. */
  measure: GestureMeasure | null;
  scale: number;
  /** Stage size in design pixels; the shields need to know where it ends. */
  stageWidth: number;
  stageHeight: number;
  editing: boolean;
  onHandleDown(handle: Handle, event: React.PointerEvent): void;
  /** A press on the selection frame's own edge; moves what is selected. */
  onFrameDown(event: React.PointerEvent): void;
  onRotateDown(event: React.PointerEvent): void;
  onShieldDown(event: React.PointerEvent): void;
  /** Pointer over the text being edited; the host draws the selection itself. */
  onTextDown(event: React.PointerEvent): void;
  onTextMove(event: React.PointerEvent): void;
  onTextUp(event: React.PointerEvent): void;
  /** Handles sit outside the interaction layer, so their right-clicks come here. */
  onContextMenu(event: React.MouseEvent): void;
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * How far outside the element the selection frame steps while its text is being
 * edited, in screen pixels.
 *
 * Everywhere else the frame sits on the element's boundary exactly, and with
 * `box-sizing: border-box` its line is painted just *inside* that boundary —
 * which is also where the caret stands. On a box with nothing typed into it the
 * two are the same pixels in the same blue: the caret takes the editor's accent
 * while the element is blank (placeholder.ts), because an empty box offers no
 * proof that the deck's own colour would be readable. So the caret was there
 * and could not be seen.
 *
 * Moving the frame out is enough to part them, and it costs nothing else: the
 * fill still stops at the element's edge (the line is an outline, the border
 * stays in place and turns transparent), the shields are still cut to the
 * element itself, and none of this exists anywhere but the host window
 * (invariant 15). Handles are not drawn during a session, so nothing has to
 * follow the frame outwards.
 */
const EDIT_FRAME_GAP = 3;

/**
 * Selection chrome, drawn in the host window rather than inside the stage.
 *
 * Nothing the editor draws may reach the exported HTML, so none of it is
 * allowed to exist in the stage document. The overlay shares the stage's scaled
 * coordinate space, so element rects can be used as-is; line widths divide by
 * the scale to stay one screen pixel wide at any zoom.
 */
export function Overlay({
  selection,
  hover,
  focus,
  guides,
  measure,
  scale,
  stageWidth,
  stageHeight,
  editing,
  onHandleDown,
  onFrameDown,
  onRotateDown,
  onShieldDown,
  onTextDown,
  onTextMove,
  onTextUp,
  onContextMenu,
}: OverlayProps) {
  const hairline = 1 / scale;

  return (
    <div className="stage-overlay" onContextMenu={onContextMenu}>
      {editing && selection && (
        <Shields
          box={selection}
          stageWidth={stageWidth}
          stageHeight={stageHeight}
          onShieldDown={onShieldDown}
          onTextDown={onTextDown}
          onTextMove={onTextMove}
          onTextUp={onTextUp}
        />
      )}
      {guides.map((guide, index) => (
        <div
          key={`guide-${index}`}
          className={`overlay-guide ${guide.orientation}`}
          style={
            guide.orientation === 'vertical'
              ? {
                  left: guide.position,
                  top: guide.from,
                  height: guide.to - guide.from,
                  width: hairline,
                }
              : {
                  top: guide.position,
                  left: guide.from,
                  width: guide.to - guide.from,
                  height: hairline,
                }
          }
        />
      ))}

      {hover && !editing && (
        <div className="overlay-hover" style={{ ...frame(hover), borderWidth: hairline }} />
      )}

      {focus && (
        <div className="overlay-focus" style={{ ...frame(focus), borderWidth: hairline * 2 }} />
      )}

      {selection && (
        <div
          className={editing ? 'overlay-selection editing' : 'overlay-selection'}
          style={{
            ...frame(selection),
            borderWidth: hairline * 2,
            ...(editing
              ? { outlineWidth: hairline * 2, outlineOffset: hairline * EDIT_FRAME_GAP }
              : null),
          }}
        >
          {!editing && (
            <>
              {/* Before the handles, so a corner still resizes: later siblings
                  win the hit test where the two overlap. */}
              <MoveGrips hairline={hairline} onPointerDown={onFrameDown} />
              <Handles
                hairline={hairline}
                rotation={selection.rotation}
                onHandleDown={onHandleDown}
              />
              <RotateHandle hairline={hairline} onPointerDown={onRotateDown} />
            </>
          )}
        </div>
      )}

      {measure && <Badge measure={measure} hairline={hairline} stageHeight={stageHeight} />}
    </div>
  );
}

/**
 * The figure a gesture is currently producing, parked under the selection.
 *
 * It sits outside the rotated selection frame so the text stays upright, and
 * flips above the element rather than falling off the bottom of the stage.
 */
function Badge({
  measure,
  hairline,
  stageHeight,
}: {
  measure: GestureMeasure;
  hairline: number;
  stageHeight: number;
}) {
  const bounds = boundsOf(measure.box);
  const gap = hairline * 10;
  const height = hairline * 20;
  const below = bounds.bottom + gap;
  const flip = below + height > stageHeight;

  return (
    <div
      className="overlay-badge"
      style={{
        left: (bounds.left + bounds.right) / 2,
        top: flip ? bounds.top - gap - height : below,
        height,
        fontSize: hairline * 12,
        lineHeight: `${height}px`,
        padding: `0 ${hairline * 7}px`,
        borderRadius: hairline * 4,
      }}
    >
      {formatMeasure(measure)}
    </div>
  );
}

/**
 * The whole stage while text is being edited, in two parts: four strips around
 * the element that end the session, and one pane over the element that selects
 * its text.
 *
 * While text is being edited the interaction layer is off, so clicks over the
 * stage land in the frame document — where WebKit runs no listeners at all
 * (the document's scripting is disabled). Any exit that involves clicking the
 * stage therefore has to be made of host elements — and since the 完了 badge
 * was dropped, they are the exit that works on every engine.
 *
 * There used to be a hole here so that caret and drag-selection could reach the
 * text natively. It is covered now: a press that lands inside an existing range
 * makes the browser drag the range instead of starting a new selection, and a
 * scripting-disabled frame gives the host no way to refuse. The
 * pane takes the press instead and the selection is drawn from the host
 * (textSelection.ts).
 */
function Shields({
  box,
  stageWidth,
  stageHeight,
  onShieldDown,
  onTextDown,
  onTextMove,
  onTextUp,
}: {
  box: OrientedBox;
  stageWidth: number;
  stageHeight: number;
  onShieldDown(event: React.PointerEvent): void;
  onTextDown(event: React.PointerEvent): void;
  onTextMove(event: React.PointerEvent): void;
  onTextUp(event: React.PointerEvent): void;
}) {
  const bounds = boundsOf(box);
  const top = Math.max(0, bounds.top);
  const bottom = Math.min(stageHeight, bounds.bottom);
  const left = Math.max(0, bounds.left);
  const right = Math.min(stageWidth, bounds.right);

  const strips: React.CSSProperties[] = [
    { left: 0, top: 0, width: stageWidth, height: top },
    { left: 0, top: bottom, width: stageWidth, height: Math.max(0, stageHeight - bottom) },
    { left: 0, top, width: left, height: Math.max(0, bottom - top) },
    { left: right, top, width: Math.max(0, stageWidth - right), height: Math.max(0, bottom - top) },
  ];

  return (
    <>
      {strips.map((style, index) => (
        <div key={`shield-${index}`} className="overlay-shield" style={style} onPointerDown={onShieldDown} />
      ))}
      <div
        className="overlay-text-shield"
        style={{
          left,
          top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        }}
        onPointerDown={onTextDown}
        onPointerMove={onTextMove}
        onPointerUp={onTextUp}
        onPointerCancel={onTextUp}
      />
    </>
  );
}

/**
 * The selection frame's four edges, as something to take hold of.
 *
 * A click selects whatever the pointer lands on, and there are elements no
 * pointer can land on: clipped away by an ancestor's `overflow`, refusing the
 * pointer, or simply covered. Alt+click and the context menu can *select* one
 * of those (bridge.ts), and once selected the inspector, the arrow keys and
 * ⇧⌘] all reach it — but a drag did not, because a press over it goes on
 * naming the thing in front.
 *
 * The frame is the way in, for the same reason the resize handles already are:
 * it is host chrome drawn over the stage (invariant 15), so it is reachable
 * whatever the element underneath it is doing. Being able to resize an element
 * you cannot move was the odd half of that.
 *
 * Edges rather than the whole frame. Filling it in would mean a press anywhere
 * inside the selection moves it, and then the small thing standing *on* a
 * selected panel could never be clicked — the selection would eat every press
 * in its own area. The edge is the part that is unambiguously the frame's.
 */
function MoveGrips({
  hairline,
  onPointerDown,
}: {
  hairline: number;
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  // Wide enough to hit without aiming, narrow enough that it stays read as the
  // frame's line rather than as a band around the element.
  const thickness = hairline * 7;
  return (
    <>
      {(['n', 'e', 's', 'w'] as const).map((edge) => (
        <span
          key={edge}
          className={`overlay-grip grip-${edge}`}
          style={edge === 'n' || edge === 's' ? { height: thickness } : { width: thickness }}
          onPointerDown={(event) => {
            event.stopPropagation();
            onPointerDown(event);
          }}
        />
      ))}
    </>
  );
}

function Handles({
  hairline,
  rotation,
  onHandleDown,
}: {
  hairline: number;
  /** The selection's angle; the cursor has to follow it (see handleCursor.ts). */
  rotation: number;
  onHandleDown: (handle: Handle, event: React.PointerEvent) => void;
}) {
  const size = hairline * 9;
  return (
    <>
      {HANDLES.map((handle) => (
        <span
          key={handle}
          className={`overlay-handle handle-${handle}`}
          style={{
            width: size,
            height: size,
            borderWidth: hairline,
            cursor: cursorForHandle(handle, rotation),
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            onHandleDown(handle, event);
          }}
        />
      ))}
    </>
  );
}

function RotateHandle({
  hairline,
  onPointerDown,
}: {
  hairline: number;
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  const size = hairline * 11;
  return (
    <span
      className="overlay-rotate"
      style={{ width: size, height: size, borderWidth: hairline, top: -hairline * 26 }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown(event);
      }}
    />
  );
}

function frame(box: OrientedBox): React.CSSProperties {
  return {
    left: box.cx - box.width / 2,
    top: box.cy - box.height / 2,
    width: box.width,
    height: box.height,
    transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
  };
}
