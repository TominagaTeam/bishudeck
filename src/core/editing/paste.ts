/**
 * Cleans up markup that arrived in a text box from outside the editor.
 *
 * Pasting into a `contenteditable` inserts whatever the source application put
 * on the clipboard — Word and Google Docs both hand over `class="mso-*"` and
 * `<span style="font-size:99px">` — and none of it belongs in someone else's
 * deck: it lands in the slide's markup, survives into the exported HTML, and
 * fights the deck's own CSS (docs/issues.md #12).
 *
 * A `paste` listener would be the obvious place for this, but the edit frame
 * runs with scripting disabled and WebKit will not fire listeners attached to
 * such a document (ADR-0002; the same wall that keeps ⌘B out of the command
 * history). Mutation records do cross the boundary, so the cleanup happens just
 * after the nodes land rather than just before.
 *
 * What survives is emphasis, not typography. Bold, italic, underline, links and
 * list structure carry meaning the user chose; size, family, colour and
 * spacing are the *source document's* design, and keeping them is what breaks
 * the deck's. Elements are never unwrapped — dropping a `<div>` would reflow
 * what the user pasted, and the first rule here is not to mangle content.
 *
 * ## Telling a paste from the browser's own editing
 *
 * Mutation records say *what appeared*, never *why*, and pressing Enter makes
 * nodes appear too. Chrome splits a line by cloning the run the caret sits in,
 * so ending a 48px line produces `<div><span style="font-size:48px"><br></span>
 * </div>` — the right answer, arrived at without asking us. Handing that to the
 * cleaner as if it were a paste stripped the size back off a fifth of a second
 * later, and the next character came out at the box's default. Colour and
 * highlight went the same way; `<b>` survived only because emphasis is kept
 * anyway. That was the whole of "フォントサイズ機能がうまく追従していません".
 *
 * The line drawn here is by *value*: a declaration survives if the box's own
 * contents already declare exactly it. Everything the browser mints while
 * editing is a copy of a run that is already in the box, so it always passes;
 * `font-size:99px` from Word does not, because nothing in the box says 99px.
 * A paste whose typography happens to match what is already there keeps it,
 * which is the deliberate cost — the text renders identically to its
 * neighbours either way, so there is nothing to see and nothing to export that
 * was not already being exported.
 *
 * Simpler rules were tried against the real browser and do not hold up:
 *
 * - *"skip while the editor's own commands run"* (`isFormatting`, which is
 *   still the gate for that case) covers only nodes **we** mint. Enter and
 *   typing mint nodes with no flag up at all.
 * - *"keep what the added node's ancestors already declare"* fails on the very
 *   case that started this: the 48px lives on the previous line's `<span>`, a
 *   sibling of the new line, not on any ancestor of it.
 * - *"a bare `<span style>` is the browser's, a classed one is Word's"* fails
 *   the other way — Google Docs pastes bare spans, and dropping their size is
 *   the behaviour issues #12 asked for.
 *
 * Attributes are *not* softened by any of this, and must not be: Chrome clones
 * the run whole, `data-hse-uid` included, so both halves of a split line come
 * out wearing the same uid (measured). Stripping every `data-*` off anything
 * that appears is what keeps a uid addressing one element (invariant 6).
 */

/** Declarations worth carrying over: the ones that say emphasis, not looks. */
function isKeptDeclaration(property: string): boolean {
  return (
    property === 'font-weight' ||
    property === 'font-style' ||
    property.startsWith('text-decoration')
  );
}

/**
 * Attributes with meaning rather than presentation. Everything else goes,
 * including every `data-*`: a fragment copied from the editor itself carries
 * `data-hse-uid`, and a duplicated uid addresses two elements at once.
 */
const KEPT_ATTRIBUTES = new Set([
  'href',
  'src',
  'srcset',
  'alt',
  'title',
  'colspan',
  'rowspan',
  'start',
  'reversed',
]);

/** Things that would run, restyle the deck, or make no sense inside a slide. */
const DROPPED_ELEMENTS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'BASE', 'TITLE', 'IFRAME']);

/** What a caller that knows of nothing already in the box passes. */
const NOTHING_CARRIED: ReadonlySet<string> = new Set<string>();

/**
 * Cleans a node that has just been inserted, along with everything under it.
 *
 * `carried` is the set of `property:value` declarations the box already had
 * (see {@link createInsertionCleaner}, which is what builds it). Left out, the
 * node is treated as arriving into an empty box: nothing matches, so every
 * presentational declaration goes.
 */
export function sanitizeInsertedNode(node: Node, carried: ReadonlySet<string> = NOTHING_CARRIED): void {
  if (node.nodeType !== 1) return;
  const element = node as Element;

  if (DROPPED_ELEMENTS.has(element.tagName)) {
    element.remove();
    return;
  }

  scrub(element, carried);
  // Collected first: removing as we iterate a live list skips siblings.
  for (const descendant of Array.from(element.querySelectorAll('*'))) {
    if (DROPPED_ELEMENTS.has(descendant.tagName)) descendant.remove();
    else scrub(descendant, carried);
  }
}

function scrub(element: Element, carried: ReadonlySet<string>): void {
  for (const name of element.getAttributeNames()) {
    if (name === 'style') {
      scrubStyle(element, carried);
      continue;
    }
    if (!KEPT_ATTRIBUTES.has(name)) element.removeAttribute(name);
  }
}

function scrubStyle(element: Element, carried: ReadonlySet<string>): void {
  const style = (element as HTMLElement).style;
  if (!style) return;

  // Read the property names first for the same reason as above: the declaration
  // list is live, and removing from it while walking it skips entries.
  for (const property of Array.from(style)) {
    if (isKeptDeclaration(property)) continue;
    if (carried.has(declaration(style, property))) continue;
    style.removeProperty(property);
  }
  // An empty `style=""` is litter in the exported HTML.
  if (element.getAttribute('style')?.trim() === '') element.removeAttribute('style');
}

/**
 * One inline declaration, as the string both sides of the comparison are built
 * from. Serialising through `CSSStyleDeclaration` on both sides is what makes
 * `color:red` and `color:rgb(255,0,0)` compare equal, and what expands a
 * shorthand into the longhands `removeProperty` would actually take out.
 */
function declaration(style: CSSStyleDeclaration, property: string): string {
  return `${property}:${style.getPropertyValue(property)}`;
}

function declarationsOf(element: Element): string[] {
  const style = (element as HTMLElement).style;
  if (!style) return [];
  return Array.from(style, (property) => declaration(style, property));
}

/**
 * The stateful half: what one text box has already got, so that what turns up
 * in it can be judged against it.
 *
 * The judgement cannot be made from the tree alone, because by the time a
 * mutation record is delivered the new nodes are *in* the tree and look exactly
 * like the old ones. So elements are remembered by identity as they are seen,
 * and only the remembered ones are asked what they declare.
 *
 * Identity rather than a running set of declaration strings, for two measured
 * reasons. Chrome re-parents the untouched half of a split line and reports it
 * as an addition, so "was it added in this batch?" would disown the very run
 * the new line was copied from. And re-sizing a run the session already wrote
 * changes an attribute rather than a node, which this observer is not watching
 * (deliberately — see the `syncBlankMark` note at the call site), so a set
 * frozen at the end of the last batch would still be holding the old size.
 * Reading live off remembered elements gets both right.
 *
 * The root's own `style` is left out. Its declarations are the box's placement,
 * which nothing inside it should ever repeat — a text box copied out of the
 * editor and pasted back in would otherwise be handed `position:absolute` — and
 * its typography is inherited by everything under it anyway, so a browser split
 * has no reason to restate it and no way to lose it.
 */
export interface InsertionCleaner {
  /** Cleans what this batch of records brought in from outside. */
  clean(records: readonly MutationRecord[]): void;
  /**
   * Takes this batch as the editor's own doing — nothing to clean, but what it
   * minted counts from now on as markup the box has.
   */
  accept(): void;
}

export function createInsertionCleaner(root: Element): InsertionCleaner {
  const known = new WeakSet<Element>();

  function remember(): void {
    for (const element of root.querySelectorAll('*')) known.add(element);
  }

  remember();

  return {
    clean(records) {
      const carried = carriedDeclarations(root, known, records);
      for (const record of records) {
        for (const added of record.addedNodes) sanitizeInsertedNode(added, carried);
      }
      remember();
    },
    accept() {
      remember();
    },
  };
}

/**
 * Everything the box declared going into this batch: what is still in it and
 * was already known, plus what this batch took out.
 *
 * The removed half matters when the change replaced what it read from — select
 * a whole 48px line and press Enter and the run carrying the size leaves in the
 * same breath as the empty one carrying it arrives.
 */
function carriedDeclarations(
  root: Element,
  known: WeakSet<Element>,
  records: readonly MutationRecord[],
): Set<string> {
  const carried = new Set<string>();

  const collect = (element: Element): void => {
    if (!known.has(element)) return;
    for (const declared of declarationsOf(element)) carried.add(declared);
  };

  for (const element of root.querySelectorAll('*')) collect(element);
  for (const record of records) {
    for (const removed of record.removedNodes) {
      if (removed.nodeType !== 1) continue;
      const element = removed as Element;
      collect(element);
      for (const descendant of element.querySelectorAll('*')) collect(descendant);
    }
  }

  return carried;
}
