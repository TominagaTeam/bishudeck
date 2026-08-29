/**
 * One foldable block of the inspector.
 *
 * `<details>` rather than a button and a conditional render: the open state,
 * the keyboard handling and the exposed `aria-expanded` all come with it, and
 * `PaneDivider` is the standing example of how much hand-written aria the
 * alternative costs.
 *
 * **The fold is driven from outside, and only a real click moves it.** The
 * summary's click is cancelled and the state comes back through `onToggle`,
 * rather than listening to the element's own `toggle` event. `toggle` fires
 * whenever the attribute changes — including when React sets it because the
 * selection moved to an element of another kind — and the store behind this
 * only wants the panels the *user* touched (see `panelsFor`). Listening to
 * `toggle` would file an override every time someone clicked a different box,
 * and the per-kind defaults would be gone within a few clicks.
 *
 * Cancelling costs nothing for the keyboard: Enter and Space on a summary are
 * delivered as clicks.
 */

/** Whether this panel is open, and how to say it should not be. Passed down
 *  from the inspector as one value because a panel that received only `open`
 *  would be a fold nobody could work. */
export interface Fold {
  open: boolean;
  onToggle(open: boolean): void;
}

/** What a disabled panel stands in as: shut, unworkable, and saying why.
 *  There is no `Fold` — the whole point is that this one does not move. */
export function DisabledPanel({
  title,
  reason,
}: {
  title: string;
  /** Shown on hover and read out by `aria-description`: the pane is the one
   *  place that can say what would make this panel live again, and a summary
   *  with no explanation reads as a bug rather than as a state. */
  reason: string;
}) {
  return (
    <details className="panel disabled" open={false}>
      {/*
        Focusable on purpose, and `aria-disabled` rather than removed from the
        tab order. A control taken out of the tab order is one a screen-reader
        user has no way of discovering, which would undo for them exactly what
        drawing the panel does for everyone else — the point is that the panel
        is *there*.

        The click is cancelled and nothing is reported: `onToggle` is what files
        an override in `hse.inspectorPanels`, so a summary that answered here
        would let a dark panel rewrite what the *live* column opens with.
      */}
      <summary aria-disabled="true" title={reason} aria-description={reason} onClick={(e) => e.preventDefault()}>
        {title}
      </summary>
      {/*
        No body. The panel cannot be opened, so its contents would be a set of
        controls nobody can reach — and building them is not free: 文字書式
        seeds its draft fields from the element on mount, and 画像 subscribes to
        the crop session. A summary is the whole of what a dark panel is.
      */}
    </details>
  );
}

export function CollapsiblePanel({
  title,
  fold,
  attributes,
  containerRef,
  children,
}: {
  title: string;
  fold: Fold;
  /** Extra attributes for the container. `data-hse-text-tools` is the only one
   *  so far, and it goes here rather than on the controls inside because the
   *  marker for "a click here must not end the text session" belongs to the
   *  region of host UI (inspector/decisions.md #4). */
  attributes?: Record<string, string>;
  /** The container, for a panel that needs to put *itself* on screen — 文字書式
   *  scrolls to itself when a session opens (`Inspector`).
   *
   *  A named prop rather than the panel being asked to find its own element
   *  from the document: two panels carry `data-hse-text-tools` in no build, but
   *  a query would still be the pane reaching past React to name a node by a
   *  marker that exists for an entirely different reason (what a click inside
   *  must not end). The ref says what it is for. */
  containerRef?: React.Ref<HTMLDetailsElement>;
  children: React.ReactNode;
}) {
  return (
    <details className="panel" ref={containerRef} open={fold.open} {...attributes}>
      <summary
        onClick={(e) => {
          e.preventDefault();
          fold.onToggle(!fold.open);
        }}
      >
        {title}
      </summary>
      <div className="panel-body">{children}</div>
    </details>
  );
}
