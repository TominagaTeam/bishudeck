import { PICTURE_GRIP, type CropGrip } from './cropGesture';
import type { OrientedBox } from './geometry';
import type { Handle } from './interactions';

/** Corners first: the four that change two edges at once are the common grab. */
const CROP_HANDLES: Handle[] = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'];

interface CropOverlayProps {
  /** The visible crop, in stage coordinates. */
  frame: OrientedBox;
  /** The whole picture, including whatever the frame is currently cutting off. */
  picture: OrientedBox;
  scale: number;
  onGripDown(grip: CropGrip, event: React.PointerEvent): void;
}

/**
 * Crop chrome: the picture's full extent, the part of it being cut away, and
 * the handles that move the frame's edges.
 *
 * The cut-away part is drawn here rather than by un-clipping the frame in the
 * stage. It could be un-clipped — the stage stylesheet already does that for
 * `data-hse-cropping` — but the *dimming* may not be: a translucent panel laid
 * over a slide is editor chrome, and none of it is allowed to exist inside the
 * document that gets exported (invariant 15). So the stage shows the picture
 * and the host shades it.
 *
 * Everything sits in two containers that carry the frame's rotation, so the
 * strips and handles can be laid out in plain unrotated arithmetic inside them.
 */
export function CropOverlay({ frame, picture, scale, onGripDown }: CropOverlayProps) {
  const hairline = 1 / scale;

  // The frame, in the picture's own coordinates: that is what the four shaded
  // strips are the complement of.
  const inner = frameWithinPicture(frame, picture);
  const strips: React.CSSProperties[] = [
    { left: 0, top: 0, width: picture.width, height: Math.max(0, inner.top) },
    {
      left: 0,
      top: inner.top + inner.height,
      width: picture.width,
      height: Math.max(0, picture.height - inner.top - inner.height),
    },
    { left: 0, top: inner.top, width: Math.max(0, inner.left), height: inner.height },
    {
      left: inner.left + inner.width,
      top: inner.top,
      width: Math.max(0, picture.width - inner.left - inner.width),
      height: inner.height,
    },
  ];

  return (
    <>
      <div className="overlay-crop-picture" style={{ ...place(picture), borderWidth: hairline }}>
        {strips.map((style, index) => (
          <div key={`crop-dim-${index}`} className="overlay-crop-dim" style={style} />
        ))}
      </div>

      <div className="overlay-crop-frame" style={{ ...place(frame), borderWidth: hairline * 2 }}>
        {/* Dragging anywhere inside the frame slides the picture behind it,
            which is how a crop is aimed once its edges are where you want them. */}
        <div
          className="overlay-crop-grip"
          onPointerDown={(event) => {
            event.stopPropagation();
            onGripDown(PICTURE_GRIP, event);
          }}
        />
        {CROP_HANDLES.map((handle) => (
          <span
            key={handle}
            className={`overlay-crop-handle handle-${handle}`}
            style={handleSize(handle, hairline)}
            onPointerDown={(event) => {
              event.stopPropagation();
              onGripDown(handle, event);
            }}
          />
        ))}
      </div>
    </>
  );
}

/**
 * PowerPoint's crop handles are brackets on the corners and bars on the edges,
 * not the square dots a resize uses — the shape is what says "this trims rather
 * than scales" before anything has been dragged.
 *
 * The per-side widths are written here rather than in the stylesheet because a
 * bracket is "two sides of four", and the two that get drawn depend on the
 * corner. A rule could not set them: the shared size has to be inline, and an
 * inline `border-width` beats any plain stylesheet rule trying to zero the
 * other two sides.
 */
function handleSize(handle: Handle, hairline: number): React.CSSProperties {
  const thickness = hairline * 4;
  const length = hairline * 18;

  if (handle.length === 2) {
    return {
      width: length,
      height: length,
      background: 'none',
      borderTopWidth: handle.startsWith('n') ? thickness : 0,
      borderBottomWidth: handle.startsWith('s') ? thickness : 0,
      borderLeftWidth: handle.endsWith('w') ? thickness : 0,
      borderRightWidth: handle.endsWith('e') ? thickness : 0,
    };
  }

  const vertical = handle === 'n' || handle === 's';
  return {
    width: vertical ? length : thickness,
    height: vertical ? thickness : length,
    borderWidth: 0,
  };
}

/** The frame expressed in the picture's coordinates, both being unrotated there. */
function frameWithinPicture(frame: OrientedBox, picture: OrientedBox): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const rad = (picture.rotation * Math.PI) / 180;
  const dx = frame.cx - picture.cx;
  const dy = frame.cy - picture.cy;
  // Undo the shared rotation to get the offset along the picture's own axes.
  const localX = dx * Math.cos(-rad) - dy * Math.sin(-rad);
  const localY = dx * Math.sin(-rad) + dy * Math.cos(-rad);
  return {
    left: picture.width / 2 + localX - frame.width / 2,
    top: picture.height / 2 + localY - frame.height / 2,
    width: frame.width,
    height: frame.height,
  };
}

function place(box: OrientedBox): React.CSSProperties {
  return {
    left: box.cx - box.width / 2,
    top: box.cy - box.height / 2,
    width: box.width,
    height: box.height,
    transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
  };
}
