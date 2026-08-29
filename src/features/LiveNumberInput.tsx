import { useCallback, useEffect, useRef, useState } from 'react';

import { parseNumberDraft } from './styleValues';

/**
 * A number field that commits the way a slide tool's does: what is *typed* is a
 * draft that lands on Enter or when focus leaves, and what is *stepped* — the
 * ▲▼ buttons and the ↑↓ keys — lands the moment it is pressed.
 *
 * **This reverses the decision the component was built on.** It used to apply
 * on every keystroke, and the 位置とサイズ fields were moved onto it from a
 * delayed-commit `NumberField` that was then deleted (inspector/decisions.md
 * #25 / #48). Three objections were recorded then, and each has an answer now:
 *
 *  - *"a size cannot be decided without watching the slide change."* The
 *    stepper is what watching is for, and it is immediate: holding ▲ walks the
 *    element up a pixel at a time with the slide redrawing under it. Typing is
 *    for a number the user already knows, and that number wants to arrive once
 *    — typing `100` used to drag the element through 1, then 10, clamping to
 *    the field's floor on the way (`8` for a font size), and a run of 200px
 *    text flashed at 8px twice before landing.
 *  - *"the退避 was only needed because blur is a click on another box."* It is
 *    needed again, and it is not this component's to hold: a click on the
 *    canvas ends the text session in a capture-phase `pointerdown` and only
 *    then fires this field's `blur`, by which time the range the number was
 *    typed for is gone. `flushOn` is the hook for that — the caller hands over
 *    whatever announces the loss (`onBeforeSessionEnd`, core/editing/
 *    richText.ts) and this applies the draft while the range is still alive.
 *  - *"two flavours of number field."* There is still one. Every number in the
 *    inspector — 文字サイズ, 余白, 角丸, 枠線の太さ, 位置とサイズ — is this
 *    component, so all of them changed together and none of them is the
 *    exception. 枠線の太さ keeps its slider beside it and 文字サイズ has the
 *    stepper, so the two that are genuinely judged by eye still are.
 *
 * **How a step is told apart from a keystroke.** Not by sniffing the event's
 * constructor, and not by measuring where in the box the pointer went down: the
 * platform already draws the line, in `change`. Measured in Chrome against the
 * running app — a ▲/↑ press fires `input` (a plain `Event`, no `inputType`)
 * *and* `change`, together, at once; typing a digit fires `input` alone (an
 * `InputEvent`, `inputType: "insertText"`) and holds `change` back until Enter
 * or blur. So `change` is exactly "the user is done with this number", which is
 * the whole commit rule in one listener. It is attached by hand rather than
 * through React, which folds `change` into `onChange` and gives no way to ask
 * which of the two arrived.
 *
 * The draft exists so the box can be empty mid-edit. An empty or unparseable
 * one applies nothing (`parseNumberDraft`, issues #10) and puts the field back
 * in step with the element.
 *
 * It lives in its own file because both `Inspector` and `TextFormatControls`
 * use it and the first imports the second — the same cycle `Field` and
 * `styleValues` were pulled out to avoid (inspector/decisions.md #7 / #20).
 */
export function LiveNumberInput({
  id,
  value,
  min,
  max,
  whole = true,
  className,
  flushOn,
  onApply,
}: {
  /** Set when the row ties its label to this box (`Field`, issues #28). */
  id?: string;
  /**
   * `null` when the selection has no single number to show — a range covering
   * two font sizes. The box goes empty rather than picking one of them, which
   * is what every other slide tool does with a mixed run: naming one would
   * invite the user to leave it alone believing the whole selection has it.
   */
  value: number | null;
  /** Left out where every number is a legitimate one: X, Y and 回転. */
  min?: number;
  max?: number;
  /**
   * Whether only whole units make sense. True for the ones measured in whole
   * pixels (余白・角丸・枠線の太さ・文字サイズ); false for the geometry fields,
   * which show what was *measured* — `round()` keeps two decimals — so
   * quantising a typed 22.5° to 23° would refuse a value the field displays.
   */
  whole?: boolean;
  className?: string;
  /**
   * Registers a last call for the draft, and hands back the way to cancel it.
   *
   * For the one field whose number is aimed at something that can disappear
   * out from under it: 文字サイズ writes to the range inside a text session,
   * and the click that takes focus off this box is often the same click that
   * closes that session. Fields writing to an element need none of this — an
   * element is still there when `blur` arrives.
   */
  flushOn?(flush: () => void): () => void;
  onApply(value: number): void;
}) {
  const [draft, setDraft] = useState(() => text(value));
  const input = useRef<HTMLInputElement>(null);
  /**
   * The typed text waiting to be applied, or null when nothing is.
   *
   * A ref, not the state above, for two reasons that both come down to timing.
   * The `change` listener is a plain DOM one and runs in the same task as the
   * `input` that preceded it, before React has re-rendered — so it has to read
   * what was typed from somewhere written synchronously. And "is the user
   * mid-edit" is the question the incoming `value` is filtered on below, which
   * must not itself cause a render.
   */
  const typed = useRef<string | null>(null);
  /** What `commit` reads. It is stable, so it cannot close over the props. */
  const latest = useRef({ value, min, max, whole, onApply });
  latest.current = { value, min, max, whole, onApply };

  const commit = useCallback(() => {
    const pending = typed.current;
    typed.current = null;
    // Nothing typed since the last commit. All three routes in — `change`,
    // Enter, blur — can fire over the same edit, so they have to be idempotent
    // or one number would land as two undo steps.
    if (pending === null) return;

    const { value, min, max, whole, onApply } = latest.current;
    const parsed = parseNumberDraft(pending);
    if (parsed === null) {
      setDraft(text(value));
      return;
    }

    const rounded = whole ? Math.round(parsed) : parsed;
    const bounded = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, rounded));
    // Shown before it is applied, so a clamped number does not sit in the box
    // as a figure the element does not have. Where the element answers with
    // something else again — a content-box element told `width: 150px` reports
    // its padding back on top — that answer arrives as a new `value` and the
    // effect below takes it, because the draft is no longer pending.
    setDraft(text(bounded));

    const held = document.activeElement === input.current;
    onApply(bounded);
    // Applying to a *text range* focuses the frame on its way through
    // `prepareSelection` (core/editing/richText.ts), which would send the next
    // keystroke into the slide instead of into this box. Only taken back when
    // this box had it to begin with: `blur` and the session's last call both
    // commit from somewhere else, and stealing focus there would drag the user
    // back into a field they had just left.
    if (held && document.activeElement !== input.current) input.current?.focus();
  }, []);

  // Only while nothing is pending. The field follows the element — and, for
  // 文字サイズ, the caret — but a value arriving mid-edit would eat the digit
  // being typed. Committing clears the pending draft, so a field that has been
  // Entered goes back to following without waiting for focus to leave.
  useEffect(() => {
    if (typed.current === null) setDraft(text(value));
  }, [value]);

  // `change` is the platform's own "done with this number": immediate for the
  // stepper, held back until Enter or blur for typing. See the note above.
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    node.addEventListener('change', commit);
    return () => node.removeEventListener('change', commit);
  }, [commit]);

  useEffect(() => flushOn?.(commit), [flushOn, commit]);

  return (
    <input
      ref={input}
      id={id}
      className={className}
      type="number"
      min={min}
      max={max}
      step="1"
      value={draft}
      onChange={(e) => {
        typed.current = e.target.value;
        setDraft(e.target.value);
      }}
      // Both are belt to `change`'s braces. Enter and blur normally fire
      // `change` themselves, but only when the text differs from what the
      // engine last committed — and this component rewrites the box's text on
      // every commit, so which of the two the engine is comparing against is
      // its business, not something to depend on. `commit` returning early on
      // an empty draft is what makes the overlap free.
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

/** The text for a value, with the empty box standing for "no single number". */
function text(value: number | null): string {
  return value === null ? '' : String(value);
}
