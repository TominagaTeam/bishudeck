import { useId } from 'react';

/**
 * A labelled row, shared by every inspector panel and the text tools.
 *
 * The row is a `div`, not a `label`. A `label` with no `for` adopts the first
 * labelable element under it — and `button` is one — so wrapping the row meant
 * every dead pixel in it (the words, the rest of the 56px column, the slack
 * beside a fixed-width box) forwarded its click into the row's first control:
 * 左 on 行揃え, the colour picker on 文字色, the number box on 角丸. Measured
 * with a real mouse in Chromium, `isTrusted` and all (issues #28).
 *
 * A row that holds a single control still wants the label, so `children` may be
 * a function: it is handed an id to put on that control, and the label cell
 * becomes a `<label for>` tied to it. That keeps click-to-focus where it earns
 * its keep — the label column — and out of the slack beside the control.
 */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode | ((id: string) => React.ReactNode);
}) {
  const id = useId();

  // A function is how a row says "one control lives here, and here is where its
  // id goes". Nothing else can tell the two kinds apart — by this point the
  // children are opaque nodes.
  if (typeof children === 'function') {
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <div className="field-control">{children(id)}</div>
      </div>
    );
  }

  return (
    <div className="field">
      <span id={id}>{label}</span>
      {/* Buttons, or several controls: there is no one control for a `for` to
          point at, so the row names the set. Without this the label text is
          just words beside a group with nothing tying them together. */}
      <div className="field-control" role="group" aria-labelledby={id}>
        {children}
      </div>
    </div>
  );
}
