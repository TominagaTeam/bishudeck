/**
 * Rebuilding the editing host when a list command cannot land in it.
 *
 * `execCommand`'s two list commands build and unbuild lists *inside* the
 * editing host, and three shapes of host defeat that — all three measured in
 * Chromium against the real markup of `samples/generic-deck.html`, none of them
 * inferred:
 *
 * - **the host is the list.** A deck's own bulleted block *is* the text box:
 *   selection sees through `<li>` and `<ul>` and stops one short of the slide
 *   root (stage/selectionHeuristics.ts), so `<ul>` is what gets
 *   `contenteditable`. `execCommand` then reports success and changes nothing —
 *   a list cannot unwrap itself — which leaves 箇条書き and 番号 both dead on
 *   exactly the boxes that already are lists.
 *   `queryCommandState` still answers "yes, a list", so the button lights up
 *   under a press that does nothing.
 * - **the host is a `<span>`.** Blink refuses outright — `execCommand` returns
 *   `false` and the markup is untouched — at every `display` tried (inline,
 *   block, inline-block, flex). The same phrasing-level `<strong>`, `<em>`,
 *   `<b>`, `<a>` and `<label>` all take a list happily, so this is a rule about
 *   the tag rather than about inline-ness. A `<span>` becomes the host whenever
 *   a deck gives one a block-level display, or when one sits directly under the
 *   slide root with nothing between.
 * - **the host is a `<p>`.** Here the command succeeds and produces
 *   `<p><ul>…</ul></p>`, which is nesting the HTML parser does not accept:
 *   parsed back it becomes `<p></p><ul>…</ul><p></p>`. The box empties, the list
 *   leaves it and an empty paragraph appears, so the markup is not a fixed point
 *   across a round trip — invariant 2 ②.
 *
 * All three are answered the same way: hand the command a host that *can* hold
 * the result by rebuilding the host element itself, keeping its uid so nothing
 * that points at the box loses it (invariant 6).
 *
 * ## Why the host is rebuilt rather than lifted
 *
 * The other route measured was to leave the markup alone and move the editing
 * host one level *up*, onto the slide root, where `execCommand` can see the
 * whole list and unwrap it. It works for the tag change (`<ul>` → `<ol>` comes
 * out clean) and fails for everything else: unwrapping leaves an empty `<ul>`
 * behind, wraps each line in a `<span>` carrying the size it had inside the
 * list, and drops the line breaks. Worse, a caret sitting on one line splits
 * the list in three, so the one box the user selected becomes three — and the
 * editor addresses a box by the element it is (invariant 6), so a box that
 * multiplies under a button press has nowhere to put its uid.
 *
 * ## What a tag change takes with it
 *
 * A deck styles its text through the tag as often as through a class —
 * `p { font-size: 24px }`, `ul { font-size: 26px; line-height: 2 }` on the
 * sample deck — and the rebuilt element no longer matches those rules. The
 * cascade cannot be asked "which of my declarations came from the tag", so the
 * answer here is to *measure*: the computed value of a handful of text
 * properties is read before the swap and again after it, and only what actually
 * changed is written back as an inline override, and no deck stylesheet is
 * touched. A box whose look survives the swap gets nothing written on it.
 *
 * Only text properties travel. The box properties a list carries — the marker
 * gutter, the UA's vertical margin — are the list's own and *should* go when
 * the list does; carrying `padding-left` out of an unwrapped `<ul>` would leave
 * the lines indented under a bullet that is no longer there.
 */

import { writeInlineStyle } from '../commands/element';

/** The two tags a list command can be asking for. */
const LIST_TAG_FOR: Record<string, string> = {
  insertUnorderedList: 'UL',
  insertOrderedList: 'OL',
};

/**
 * What an unlisted line is wrapped in, and what a host that cannot hold a list
 * becomes.
 *
 * `<div>` rather than `<p>`, on both counts. It is what the browser itself
 * reaches for in a `contenteditable` — every line after the first arrives as a
 * `<div>` (core/editing/paragraphs.ts) — so the markup this leaves matches the
 * markup typing leaves, and it is the one block-level tag a deck almost never
 * styles by name.
 */
const PLAIN_BLOCK = 'DIV';

/**
 * Hosts a list command cannot be run inside, and what each becomes.
 *
 * `<p>` is here for the round trip rather than for the command: the list *is*
 * built inside it, and only re-parsing shows the damage. `<span>` is here
 * because Blink will not build one at all.
 */
const REHOSTED_TAGS = new Set(['SPAN', 'P']);

/**
 * What has to happen before (or instead of) the browser's own list command.
 *
 * - `direct` — the host can hold a list; run the command as it stands.
 * - `rehost` — rebuild the host as a `<div>`, then run the command in it.
 * - `retagList` — the host *is* a list and the other kind was asked for; swap
 *   the tag, keeping the items.
 * - `unwrapList` — the host is a list and its own kind was asked for, which is
 *   the press that means "take this off".
 */
export type ListPlan = 'direct' | 'rehost' | 'retagList' | 'unwrapList';

export function planListCommand(tag: string, command: string): ListPlan {
  const host = tag.toUpperCase();
  const wanted = LIST_TAG_FOR[command];
  if (!wanted) return 'direct';
  if (host === 'UL' || host === 'OL') return host === wanted ? 'unwrapList' : 'retagList';
  return REHOSTED_TAGS.has(host) ? 'rehost' : 'direct';
}

/**
 * Carries out a plan and hands back the element the session continues on.
 *
 * The three rebuilding plans are gathered here rather than branched at the call
 * site so that the caller has one thing to do — swap the host, then carry on
 * exactly as it would have — and so that "what a plan means" cannot drift from
 * {@link planListCommand}, which is the only place that decides it.
 */
export function rebuildListHost(plan: ListPlan, host: HTMLElement, command: string): HTMLElement {
  switch (plan) {
    case 'unwrapList':
      return unwrapList(host);
    case 'retagList':
      return retagElement(host, LIST_TAG_FOR[command] ?? PLAIN_BLOCK);
    case 'rehost':
      return retagElement(host, PLAIN_BLOCK);
    default:
      return host;
  }
}

/**
 * The text properties measured either side of a tag change.
 *
 * Deliberately not {@link INHERITED_PROPERTIES} from listOverrides.ts, though
 * the two overlap: that set answers "does this declaration reach the line
 * through inheritance", and is kept small because it is pushed down onto every
 * list node. This one answers "did the tag carry this", is written once onto
 * one element, and so can afford to cover the properties a deck actually puts
 * on `p`, `ul` and `span` selectors — the ones a heading or a bulleted block
 * looks different by.
 */
const CARRIED_PROPERTIES = [
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'line-height',
  'text-align',
  'text-decoration-line',
];

/** The computed value of each carried property, for comparing across a swap. */
function carriedValues(element: HTMLElement): Record<string, string> {
  const view = element.ownerDocument.defaultView;
  if (!view) return {};
  const computed = view.getComputedStyle(element);
  const values: Record<string, string> = {};
  for (const property of CARRIED_PROPERTIES) {
    values[property] = computed.getPropertyValue(property);
  }
  return values;
}

/**
 * The declarations that stopped applying when the tag changed.
 *
 * Split out from the measuring so the decision is testable: jsdom resolves
 * almost nothing through `getComputedStyle`, so a test written against the
 * reader would be testing jsdom's cascade rather than this rule (the same line
 * `foldFontValues` draws in richText.ts).
 *
 * An empty `before` value is never carried. A property the engine could not
 * resolve says nothing about what the tag was doing, and writing the empty
 * string back would put `font-size: ;` into the slide's markup.
 */
export function lostDeclarations(
  before: Record<string, string>,
  after: Record<string, string>,
): Record<string, string> {
  const lost: Record<string, string> = {};
  for (const [property, value] of Object.entries(before)) {
    if (value && after[property] !== value) lost[property] = value;
  }
  return lost;
}

/**
 * Replaces `element` with one of `tag`, keeping everything that identifies it.
 *
 * The children are *moved*, not cloned, so a `Range` the caller is holding
 * stays valid: its boundary nodes are the same text nodes, now under a
 * different parent. Only a range whose own container was the replaced element
 * dies, which is why {@link rangeSurvives} exists for callers to ask.
 *
 * Every attribute travels, uid included — the box the user selected is still
 * the same box, and an address that changed under a formatting command would
 * lose the selection, the open text session and every history step pointing at
 * it (invariant 6).
 */
export function retagElement(element: HTMLElement, tag: string): HTMLElement {
  const replacement = element.ownerDocument.createElement(tag);
  for (const attribute of Array.from(element.attributes)) {
    replacement.setAttribute(attribute.name, attribute.value);
  }
  replacement.append(...Array.from(element.childNodes));

  // Measured while the old element is still in the document: a detached element
  // computes to nothing, so the "before" reading has to be taken first.
  const before = carriedValues(element);
  element.replaceWith(replacement);
  writeInlineStyle(replacement, lostDeclarations(before, carriedValues(replacement)));
  return replacement;
}

/**
 * The inline declarations that only mean something while the element is a list.
 *
 * These are the ones a press of 箇条書き writes on its way *in* — the gutter a
 * marker needs, the UA margin flattened out from under it, the marker placement
 * an aligned list needs (core/editing/listOverrides.ts) — and every one of them
 * describes a box built around a marker. Carried through an unwrap they leave
 * the lines indented under a bullet that is no longer there: measured at
 * `padding-left: 1.2em` = 31.2px still sitting on the box after the list came
 * off, which reads as a stray indent nobody asked for.
 *
 * Dropped whoever wrote them. The editor cannot tell its own `padding-left`
 * from one a deck put inline — that is the same wall {@link dropPreservationSpans}
 * meets in richText.ts — and here the answer is easier to defend than there:
 * taking a list off is a change of structure, and box properties that exist to
 * hold a marker have nothing left to hold. `text-align` is deliberately absent;
 * an alignment is a statement about lines and outlives the list.
 */
const MARKER_BOX_PROPERTIES = [
  'padding-left',
  'padding-inline-start',
  'margin-top',
  'margin-bottom',
  'list-style',
  'list-style-type',
  'list-style-position',
];

/**
 * Turns a list back into plain lines.
 *
 * The items go first and the list second, and the order matters: an item
 * rebuilt while its list is still a list computes the same before and after
 * (it inherits the list's size either way), so nothing is written onto the
 * lines and the one override lands on the box — where the deck's own rule was
 * reaching them from. Doing the list first would leave `display: list-item`
 * items sitting in a `<div>`, still wearing markers.
 */
export function unwrapList(list: HTMLElement): HTMLElement {
  for (const item of Array.from(list.children)) {
    if (item.tagName === 'LI') dropMarkerBox(retagElement(item as HTMLElement, PLAIN_BLOCK));
  }
  return dropMarkerBox(retagElement(list, PLAIN_BLOCK));
}

/** Takes the marker's box off, and the `style` attribute with it if nothing is left. */
function dropMarkerBox(element: HTMLElement): HTMLElement {
  for (const property of MARKER_BOX_PROPERTIES) element.style.removeProperty(property);
  // An empty `style=""` is markup the editor put in the slide and nothing reads
  // — invariant 2 ① asks that what stays be invisible, and this one is not.
  if (element.getAttribute('style')?.trim() === '') element.removeAttribute('style');
  return element;
}

/**
 * Where a range started and ended, as plain values.
 *
 * A `Range` cannot be carried across a rebuild, and cloning it does not help:
 * ranges are live, and taking a node out of its parent moves every boundary
 * inside that node *up to the parent* (measured in jsdom, and it is what the
 * DOM standard's removing steps say). So the moment the children are moved into
 * the replacement, a range that pointed at a word points at the box instead,
 * and once the old element goes it points at the slide root — still valid,
 * still connected, and around the wrong thing.
 *
 * The nodes themselves come through untouched, which is what this holds on to.
 */
export interface RangeAnchors {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
}

export function anchorsOf(range: Range): RangeAnchors {
  return {
    startContainer: range.startContainer,
    startOffset: range.startOffset,
    endContainer: range.endContainer,
    endOffset: range.endOffset,
  };
}

/**
 * Whether anchors taken before a rebuild can be put back into it.
 *
 * Text nodes only. Their offsets are character positions in text this never
 * touches, so they stay meaningful however the tree above them was rearranged.
 * An offset into an *element* is an index among its children, which a rebuild
 * is free to change — restoring one could land anywhere, or throw. Those fall
 * back to selecting the new host, which is what the press meant anyway.
 */
export function anchorsRestorableIn(anchors: RangeAnchors, rebuilt: HTMLElement): boolean {
  return [anchors.startContainer, anchors.endContainer].every(
    (node) => node.nodeType === Node.TEXT_NODE && node.isConnected && rebuilt.contains(node),
  );
}
