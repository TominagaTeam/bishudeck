/**
 * Everything that makes an empty element open for typing look like one: the
 * mark that says it is empty, the line its caret stands on while that is true,
 * and the rules that paint the prompt over it.
 *
 * The prompt 「テキストを入力」 is painted by a pseudo-element, so whatever it
 * is painted on has to be expressible as a selector — and no selector can ask
 * whether an element holds text. `:empty` is close but not it: the lone `<br>`
 * a browser mints when the last character goes makes an element un-empty, and
 * the rule that used to cover that case, `:has(> br:only-child)`, counts child
 * *elements* only. `<h1>見出し<br>2 行目</h1>` has exactly one of those, all of
 * it `<br>`, so the prompt was painted over text the user had written — on any
 * tag, whenever a single `<br>` was the only element inside (issues #46).
 *
 * So the question is answered in script, where the text nodes are in plain
 * sight, and the answer is left on the element for the CSS to select on. The
 * attribute is `data-hse-` prefixed, which is what serialization strips on the
 * way out (bridge.ts), so nothing here can reach the saved document either.
 */

import { isBlank } from '../core/editing/textBox';

/**
 * Present while an element the prompt may be painted on holds nothing a reader
 * would see.
 *
 * Two elements can ever carry it, and the stage decides both: the one a text
 * session is open on, and the text box that was just inserted and is sitting
 * there selected. It used to be only the first, and the CSS below could lean on
 * `[contenteditable="true"]` to keep the prompt off a deck's own empty `<div>`s.
 * The second case has no attribute to lean on — a selected box is not marked in
 * the DOM at all — so that guard came down here, where the answer is a uid
 * comparison rather than a selector (`isUntouchedTextBox`, EditStage). Which is
 * the same move #78 made for "is it empty": what a selector may ask is not
 * enough, so script answers and leaves the answer on the element.
 */
export const BLANK_ATTRIBUTE = 'data-hse-blank';

/**
 * Marks the line break a session put in, so it can be told apart from one the
 * deck wrote or the browser minted. Only a break carrying this may be taken
 * back out again.
 */
export const CARET_LINE_ATTRIBUTE = 'data-hse-caret-line';

/**
 * The editor's own blue, spelled the way `caret-color` wants it. The same
 * colour as `::selection` on the stage and as the shapes the toolbar inserts
 * (`#3884ff`, core/editing/shapes.ts) — the caret is editor chrome, so it is
 * the one place in the frame that may look like the app rather than the deck.
 */
const CARET_COLOR = 'rgb(56, 132, 255)';

/**
 * The smallest an empty box may draw itself while the editor is holding it
 * open, in the frame's own pixels.
 *
 * An element with nothing in it is not merely invisible, it has no *area*:
 * measured across the real deck (samples/local/claude-code-basics.html), 122 of
 * its 262 text elements went to zero width the moment their text was taken out
 * — 99 of them `<span>`s sized by their content inside a flex row. A box with
 * no area cannot be clicked: `elementFromPoint` at its centre answers with the
 * ancestor behind it, so the click that should have selected the box selected
 * the panel around it, and the frame the editor drew was a line with nothing to
 * grab (issues #104).
 *
 * Small enough to be a floor rather than a shape: 24 x 16 is a little under one
 * line of body text, so a box that already has room keeps its own size, and the
 * deck's own layout is not pushed around by a box that briefly has none. It is
 * a rule in the stage's injected stylesheet, so it applies to what is on screen
 * and never to the markup — nothing is written on the element, and nothing here
 * can reach a saved or exported document.
 */
const BLANK_MIN_WIDTH = 24;
const BLANK_MIN_HEIGHT = 16;

/**
 * Brings the mark in step with what is in the element right now.
 *
 * Called as the session opens and again on every mutation inside it, so the
 * prompt appears the moment the last character is deleted and goes the moment
 * one is typed.
 */
export function syncBlankMark(element: Element): void {
  if (isBlank(element)) element.setAttribute(BLANK_ATTRIBUTE, '');
  else element.removeAttribute(BLANK_ATTRIBUTE);
}

/** Takes the mark off. The caller has decided the element may no longer show
 *  the prompt — the session ended, or the box stopped being the pending one. */
export function clearBlankMark(element: Element): void {
  element.removeAttribute(BLANK_ATTRIBUTE);
}

/**
 * Gives an element with nothing in it a line for its caret to stand on.
 *
 * An empty element has no line box, and a caret with no line box is not
 * painted. Measured in Chromium against the real arrangement — a
 * `sandbox="allow-same-origin"` frame carrying the rules below — an empty
 * `contenteditable` had the focus by every test that can be made from the host
 * (`document.hasFocus()`, `activeElement`, a collapsed range at `(div, 0)`
 * reported inside the element) and still showed nothing blinking. One `<br>`
 * inside it brought the caret back, and nothing else tried did: moving the
 * prompt out of flow, on its own, changed nothing.
 *
 * It is scaffolding, not something the user wrote, and it leaves in two ways.
 * The browser takes it out itself on the first keystroke — after
 * `execCommand('insertText', 'あいう')` the element held `あいう` and nothing
 * else — and `dropCaretLine` takes it back for the user who typed nothing at
 * all. Until one of those runs it is a real node in the document, and the
 * `data-hse-` prefix only takes the *mark* off on the way out, not the break
 * itself, which is why the drop side has to run before a session's markup is
 * measured or serialized.
 *
 * Nothing about "empty" moves: `isBlank` reads `textContent`, so an element
 * holding only this still counts as blank. The prompt keeps showing over it,
 * and an inserted box that was never typed into is still taken back
 * (core/editing/textBox.ts).
 *
 * A break that is already there is left as it is, and left unmarked. It gives
 * the caret the same line, and a deck that wrote `<h1><br></h1>` itself must
 * get that `<h1>` back unchanged.
 */
export function openCaretLine(element: Element): void {
  if (!isBlank(element) || element.querySelector('br') !== null) return;
  const line = element.ownerDocument.createElement('br');
  line.setAttribute(CARET_LINE_ATTRIBUTE, '');
  element.appendChild(line);
}

/**
 * Takes back what `openCaretLine` put in.
 *
 * Only while the element is still blank. Once there are words in it the break
 * is no longer only ours: the caret opens the session standing *before* it, so
 * everything typed lands in front, and a browser is free to keep the same node
 * as the trailing break of the line — or, after a Return, as the break that
 * makes the empty line the user asked for. Removing it then would delete a line
 * the user wrote. Leaving it costs nothing: a trailing `<br>` at the end of a
 * block generates no line box of its own, which is why `<p>段落<br></p>` is a
 * shape decks write and the blank test already has to allow for.
 */
export function dropCaretLine(element: Element): void {
  if (!isBlank(element)) return;
  for (const line of Array.from(element.querySelectorAll(`br[${CARET_LINE_ATTRIBUTE}]`))) {
    line.remove();
  }
}

/**
 * How an element open for typing with nothing in it is painted — the prompt,
 * and the caret standing beside it — for the stage's injected stylesheet
 * (EditStage's `injectEditorStyles`). The rules live here because they are the
 * other half of the mark: what a selector may ask is what decided the mark's
 * shape in the first place, and splitting the two would put the reasoning a
 * file away from the rule it explains.
 *
 * `content` arrives already written as a CSS string literal — the interface
 * text is the caller's business (i18n), quoting it for CSS is `cssString`'s.
 *
 * **The prompt selector asks for the mark and nothing else.** It used to ask
 * for `[contenteditable="true"]` as well, which was doing real work: it kept
 * the prompt off the empty `<div>`s AI decks are full of, for free. But a text
 * box that has just been inserted is only *selected* — the session comes later,
 * if at all — and it is exactly the element that most needs saying "there is a
 * box here", because an empty box is invisible. So the guard moved into script
 * (`BLANK_ATTRIBUTE`), which is where it can be a uid comparison instead of a
 * selector, and the CSS was left with the one question it can answer.
 *
 * **`caret-color` keeps the `[contenteditable="true"]` half.** A box that is
 * merely selected has no caret in it to colour, so the declaration would only
 * be a rule the browser has to match and then do nothing with. Keeping it
 * narrow also keeps it honest about when it applies.
 *
 * **The prompt is out of flow.** In flow it is a real inline box at the start
 * of the line, and the caret — which stands at offset 0 of the element, after
 * that box — was painted at the far end of it: `テキストを入力|`, which reads
 * as if the editor had typed those words for you and left the caret after them.
 * Out of flow the two share the start of the line, `|テキストを入力`, and the
 * caret is the first thing on it.
 *
 * **With every offset left `auto`.** An absolutely positioned box with no
 * `top` / `left` keeps its static position — where it would have sat in the
 * line — so the prompt still respects the element's padding and still follows
 * its `text-align`, exactly as it did in flow. Writing `top: 0; left: 0`
 * instead would pin it to the padding box's corner and put the prompt where the
 * text is not going to appear.
 *
 * **And so no containing block is needed.** The static position is used
 * whatever the nearest positioned ancestor happens to be; the containing block
 * would only decide percentages and clipping, and there are neither here.
 * `position: relative` on the element itself — the usual way to claim that
 * containing block — is deliberately *not* here: this selector also matches the
 * element the user has just emptied in the middle of a session, so a deck that
 * positions a heading absolutely from its own stylesheet would see that heading
 * jump to its static position the moment the last character went, and jump back
 * on the next keystroke. The rule is more specific than most deck rules, so it
 * would win. Nothing is gained in exchange.
 *
 * **The box is given a floor to stand on.** The prompt is painted out of flow
 * and the caret has no width, so neither of them gives an emptied box any area
 * of its own — and an element with no area cannot be clicked, which is what
 * took a box the user had just emptied out of reach altogether (see
 * {@link BLANK_MIN_WIDTH}). It is a minimum rather than a size: a box that
 * still has room is left exactly as the deck laid it out.
 *
 * **The caret gets a colour of its own, but only here.** By default it follows
 * `color`, and where the user has text that is the right answer — the caret
 * matches the words it is inserting, on a background the deck has already
 * proved those words readable against. An empty element offers no such proof:
 * an inserted box carries `color: #14161a` whatever it was dropped onto, so on
 * a dark deck the one thing telling the user where the box is was painted
 * near-black on near-black. Full opacity, not the 0.35 of `::selection`: a hairline
 * on a stage scaled to half size is what we are trying to rescue, not soften.
 */
export function placeholderRules(content: string): string {
  return `
    [${BLANK_ATTRIBUTE}] {
      min-width: ${BLANK_MIN_WIDTH}px;
      min-height: ${BLANK_MIN_HEIGHT}px;
    }
    [${BLANK_ATTRIBUTE}]::before {
      content: ${content};
      position: absolute;
      opacity: 0.4;
      pointer-events: none;
    }
    [contenteditable="true"][${BLANK_ATTRIBUTE}] {
      caret-color: ${CARET_COLOR};
    }
  `;
}
