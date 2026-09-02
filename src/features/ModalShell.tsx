import { useEffect, type ReactNode } from 'react';

/**
 * The two ways out that every modal in this app shares: Escape, and a click on
 * the dark area around it.
 *
 * They used to be written per dialog, so only two of the four had them and the
 * other two could not be dismissed at all. A modal that
 * closes one way in one place and another way elsewhere costs the user a guess
 * every time, so the behaviour lives here and the dialogs supply only what
 * "never mind" means for them.
 */
export function ModalShell({
  onDismiss,
  className,
  children,
}: {
  /** What Escape and a backdrop click mean here — always the harmless answer. */
  onDismiss(): void;
  /** Modifier for the inner box, e.g. `narrow`. */
  className?: string;
  children: ReactNode;
}) {
  // Capture phase: the stage reads Escape as "step the selection outward", and
  // it must not also do that on the way down. One Escape, one meaning.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onDismiss();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onDismiss]);

  return (
    <div
      className="modal-backdrop"
      // Only a press that both starts and lands on the backdrop itself counts.
      // Using the event target guards against a drag that began inside the
      // dialog — selecting text in a field and releasing outside it — being
      // read as "close this".
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className={className ? `modal ${className}` : 'modal'}>{children}</div>
    </div>
  );
}
