import type { ReactNode } from 'react';

interface StageSurfaceProps {
  designWidth: number;
  designHeight: number;
  scale: number;
  children: ReactNode;
}

/**
 * The scaled slide surface, wrapped in a box that occupies its *scaled* size.
 *
 * Scaling alone is not enough: a transform does not change layout size, so the
 * surface would still claim its full design width and, being wider than the
 * canvas, get pinned to the left edge instead of centred. The wrapper carries
 * the post-scale dimensions so ordinary centring works, and the surface scales
 * from its top-left corner to stay aligned inside it.
 */
export function StageSurface({ designWidth, designHeight, scale, children }: StageSurfaceProps) {
  return (
    <div className="stage-viewport" style={{ width: designWidth * scale, height: designHeight * scale }}>
      <div
        className="stage-surface"
        style={{
          width: designWidth,
          height: designHeight,
          transform: `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
