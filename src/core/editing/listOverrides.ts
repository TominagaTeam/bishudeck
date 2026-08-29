/**
 * Overrides that reach inside a list.
 *
 * An element-scope edit is written as an inline override on the selected
 * element, and the selection can never *be* a list inside a box:
 * `chooseSelectionTarget` treats `<ul>`, `<ol>` and `<li>` as transparent
 * (stage/selectionHeuristics.ts), so a click on a bulleted line always climbs to
 * the text box that owns it. The declaration therefore lands outside the list
 * and reaches the lines only by inheritance — and a deck that names its own
 * lists beats an inherited value outright, because the cascade asks "is anything
 * declared on this element" before it ever asks whose declaration is stronger.
 * Being inline does not help: the box is not the element the rule matched.
 *
 * Two kinds of override lose that way, and they lose differently.
 *
 * **Alignment** (issues #27) loses three ways at once, measured on the sample
 * deck: the `<ul>` keeps its own `padding-left`, so the centre it centres on
 * sits half of that to the right (15.59px at 1.2em); `list-style-position:
 * outside` puts the marker outside the line's content box, so the words move
 * and the bullet stays; and `ul, ol, li { text-align: left }` pins the text to
 * the left edge (-303px). Alignment is therefore written onto every list node,
 * unconditionally — "align this" is an instruction about lines, so there is no
 * case where a line should be left out.
 *
 * **Everything else inherited** (issues #31) loses only the third way, and only
 * where the deck actually says something. `ul { font-size: 26px }` on the sample
 * deck left the lines at 26px while the box went to 60px — and on a box whose
 * whole content is a list, that is a size control that does nothing at all. But
 * a deck that says nothing about its lists needs no help, so these are pushed
 * down *only where inheritance is measured to be blocked*: writing them
 * everywhere would grow the exported HTML with overrides that change nothing.
 *
 * Both stay addressed by uid — `reindex()` stamps every element, lists included
 * — so nothing here holds a DOM reference across a command, and an override
 * stays an override (ADR-0004): no deck stylesheet is rewritten.
 *
 * **Fitting the list into its box** is a third thing, and it is not about the
 * cascade at all. Measured in Chromium at font-size 28px inside the 520x90 box
 * the text tool inserts (`shapes.ts`), a two-line bullet list leaves that box
 * two ways at once, and the two have separate causes:
 *
 * - *down*, because the UA sheet gives `<ul>` a `margin-block` of 1em — 28px
 *   above and 28px below — so a list is 56px taller than its lines before a
 *   word is counted, and a deck with no reset overflowed by 64px;
 * - *left*, because a marker positioned `outside` is painted in the list's own
 *   `padding-inline-start`. A deck whose reset says `* { margin: 0; padding: 0 }`
 *   leaves no gutter for it to stand in, and the bullets land at a negative x —
 *   outside the box entirely, over whatever sits to its left.
 *
 * That is why `padding` and `margin` are written here at all, against the note
 * on {@link INHERITED_PROPERTIES} telling the brush never to push them down.
 * The two rules never meet, because they answer different questions. The brush
 * asks "does this declaration reach the line", and there a box property that
 * differs from its box is simply how boxes work, not a blockage. This asks "is
 * the list inside its box", which no amount of inheritance answers either way.
 * The triggers differ too: nothing here fires on a property the user picked, or
 * on a deck's existing list. It fires once, on the lists a single press of the
 * bullet button has just built.
 */

import { SetInlineStyleGroupCommand, writeInlineStyle } from '../commands/element';
import { execute, getActiveStage } from '../commands/engine';

/** The nodes between the edited element and the words on the line. */
const LIST_SELECTOR = 'ul, ol, li';

/**
 * The list roots on their own.
 *
 * Indent and vertical margin belong to the list, not to the item: UA styles put
 * both on `<ul>` / `<ol>` and give `<li>` neither. It is the same split
 * {@link listAlignmentStyle} makes for `padding-left`, and for the same reason
 * — flattening the item as well would collapse the steps of a nested list.
 */
const LIST_ROOT_SELECTOR = 'ul, ol';

/**
 * The gutter a marker gets when it has none, over and above what it measured.
 *
 * A marker sits flush against the words without it, and a number that only just
 * fits reads as one that did not: measured on the user's own deck, a 76px
 * heading numbered `1.` needed 89.02px and the 1.2em guessed for it gave 91.2px
 * — inside the box by 2.18px, and against the border in the screenshot that
 * reported it as still overflowing. This is also the room a second digit needs
 * when a list that starts at `1.` reaches `10.`.
 */
const MARKER_BREATHING_ROOM_EM = 0.3;

/**
 * The gutter for a marker whose width could not be measured.
 *
 * The number the sample deck's own `ul { padding-left: 1.2em }` picked, and
 * close to what a one-digit decimal actually measures (1.17em at 76px). Written
 * in em rather than the UA's flat 40px because the box this runs inside is 28px
 * text today and whatever the user types tomorrow.
 */
const FALLBACK_MARKER_GUTTER_EM = 1.2;

/**
 * The properties that reach a line by inheritance alone, and so can be stopped
 * by a rule naming the list.
 *
 * This is the inherited half of `PAINTABLE_PROPERTIES` (core/editing/format.ts)
 * — `TEXT_PROPERTIES` minus the alignment, which has a branch of its own below.
 * It is spelled out here rather than imported because `format.ts` imports *this*
 * module; `format.test.ts` holds the two lists together, so a property added to
 * the brush cannot go missing from here in silence.
 *
 * The box half must never join it. `background-color` and `padding` do not
 * inherit, so a `<li>` differing from its box is the normal state of affairs,
 * not a blockage — pushing them down would paint every line's own background.
 */
export const INHERITED_PROPERTIES = new Set([
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
]);

/**
 * The alignment a computed value stands for, or null when nobody chose one.
 *
 * An element no rule has aligned computes to `start`, which is none of the ones
 * the buttons offer. Reading it as `left` would make the list-creation path
 * write an override nobody asked for, on every deck that uses a bullet.
 *
 * `justify` is still a chosen alignment even though no button writes one any
 * more (issues #39): it reaches here from a deck that justifies its own text,
 * through `carryAlignmentIntoLists` reading the computed value.
 */
export function chosenAlign(computed: string): string | null {
  const value = computed.trim();
  return value === '' || value === 'start' ? null : value;
}

/**
 * What one list node gets for a given alignment.
 *
 * Centre and right pull the marker in as well. A bullet positioned `outside`
 * hangs off the line's content box, so on its own `text-align` moves the words
 * and leaves the bullet against the left margin — measured, and plain in the
 * screenshots. `left` and `justify` both start their lines at the left edge,
 * where an outside marker already belongs, so they clear the override instead
 * of declaring the default over whatever the deck chose.
 *
 * `justify` stays a case here after its button went away (issues #39). Nothing
 * in the panel writes one now, but a deck that justifies its own text hands one
 * to `carryAlignmentIntoLists` the moment a line there is bulleted.
 */
export function listAlignmentStyle(align: string, tag: string): Record<string, string> {
  const pullsMarkerIn = align === 'center' || align === 'right';
  const style: Record<string, string> = {
    'text-align': align,
    // Declared on the item too, not just the list. It inherits, so the list
    // alone would do — except against a deck that names `li` directly, which is
    // the same way an inherited `text-align` loses.
    'list-style-position': pullsMarkerIn ? 'inside' : '',
  };
  // The indent belongs to the list, not the item: UA styles give `<ul>` a
  // `padding-left` and `<li>` none. Flattening the item as well would collapse
  // the steps of a nested list.
  if (tag !== 'LI') style['padding-left'] = pullsMarkerIn ? '0' : '';
  return style;
}

/**
 * Which of these declarations a list node would not receive on its own.
 *
 * Asked by putting the answer on the page and looking. The new values go onto
 * the element for the length of the measurement, and each list node inside is
 * compared with the element itself: what matches is inheriting and needs
 * nothing, what differs has a rule of its own in the way.
 *
 * Guessing instead — "the node already matches the box, so inheritance must be
 * flowing" — reads the same on a deck whose rule happens to name the value the
 * box has right now, and then silently stops working the moment the box moves
 * off it. Measuring against the *new* state has no such blind spot.
 *
 * Both sides of every comparison come from `getComputedStyle`, which is what
 * makes the comparison meaningful: the inspector hands over `#ff0000` while the
 * frame answers `rgb(255, 0, 0)`, and comparing those two directly would call
 * every colour blocked and write an override onto every list on every deck.
 *
 * **The fix goes on as it is found**, in document order, so the next node down
 * is measured against a list that has already been repaired. A deck that names
 * only its `<ul>` therefore gets one override, not one per line: the items were
 * never blocked themselves, they were reading a blocked ancestor. A deck that
 * names `<li>` too still gets both, because then the item really is in the way.
 *
 * Everything written here is put back before returning, the element included.
 * None of it is ever committed — `StageBridge` serialises on an explicit
 * `commit()` and watches nothing — so no version of the slide contains it.
 */
function blockedProperties(
  element: Element,
  properties: Record<string, string>,
  nodes: Element[],
): Map<Element, Record<string, string>> {
  const view = element.ownerDocument.defaultView;
  const blocked = new Map<Element, Record<string, string>>();
  // An empty value means "stop overriding this", which has nothing to push.
  const names = Object.keys(properties).filter(
    (name) => INHERITED_PROPERTIES.has(name) && properties[name] !== '',
  );
  if (!view || names.length === 0 || nodes.length === 0) return blocked;
  // Against the stage document's own constructor: elements live in the iframe,
  // so this window's `HTMLElement` would never match (commands/element.ts).
  if (!(element instanceof view.HTMLElement)) return blocked;

  const undo = new Map<HTMLElement, Record<string, string>>();
  const put = (node: HTMLElement, values: Record<string, string>) => {
    undo.set(node, Object.fromEntries(
      Object.keys(values).map((name) => [name, node.style.getPropertyValue(name)]),
    ));
    writeInlineStyle(node, values);
  };

  put(element, Object.fromEntries(names.map((name) => [name, properties[name]])));
  const goal = view.getComputedStyle(element);
  const wanted = Object.fromEntries(names.map((name) => [name, goal.getPropertyValue(name)]));

  for (const node of nodes) {
    if (!(node instanceof view.HTMLElement)) continue;
    const computed = view.getComputedStyle(node);
    const missing = Object.entries(wanted).filter(
      ([name, value]) => computed.getPropertyValue(name) !== value,
    );
    if (missing.length === 0) continue;

    const fix = Object.fromEntries(missing);
    blocked.set(node, fix);
    put(node, fix);
  }

  for (const [node, values] of undo) writeInlineStyle(node, values);
  return blocked;
}

/**
 * An override set spread across the element it was meant for and the list nodes
 * inside it: uid -> what to write on it.
 *
 * The alignment travels down whole; everything else inherited travels down only
 * as far as it is actually stopped. See the note at the top of this file for
 * why the two are not the same rule.
 *
 * Returns just `{ [uid]: properties }` when there is no list, which is exactly
 * what a plain `SetInlineStyleCommand` would have written.
 */
export function listTargets(uid: string, properties: Record<string, string>): Record<string, Record<string, string>> {
  const stage = getActiveStage();
  const element = stage?.resolve(uid);
  const targets: Record<string, Record<string, string>> = { [uid]: properties };
  if (!stage || !element) return targets;

  const nodes = Array.from(element.querySelectorAll(LIST_SELECTOR));
  if (nodes.length === 0) return targets;

  const align = chosenAlign(properties['text-align'] ?? '');
  const blocked = blockedProperties(element, properties, nodes);
  if (!align && blocked.size === 0) return targets;

  // Nothing can be addressed without a uid, and the lists `execCommand` mints
  // only get one when the session commits. One pass over the slide costs less
  // than reasoning about which orders of operations have already stamped them.
  stage.reindex();

  for (const node of nodes) {
    const nodeUid = stage.uidOf(node);
    if (!nodeUid) continue;
    const spread = {
      ...(align ? listAlignmentStyle(align, node.tagName) : {}),
      ...(blocked.get(node) ?? {}),
    };
    if (Object.keys(spread).length > 0) targets[nodeUid] = spread;
  }
  return targets;
}

/** Aligns an element and any list inside it, as one undo step. */
export function alignElement(uid: string, align: string): void {
  execute(new SetInlineStyleGroupCommand(listTargets(uid, { 'text-align': align })));
}

/**
 * Gives a freshly built list the alignment the box around it already had.
 *
 * Both orders have to land in the same place: aligning a box and then bulleting
 * it should look like bulleting it and then aligning it. `execCommand` builds
 * the `<ul>` with no alignment of its own, so without this the first order comes
 * out unaligned — the bug reported from one direction only.
 *
 * Writes to the DOM rather than running a command, because the caller is inside
 * `withUndo`: the markup difference this makes is picked up by the
 * `commitTextSession` that follows it, and stays one undo step.
 */
export function carryAlignmentIntoLists(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView;
  if (!view) return;

  const align = chosenAlign(view.getComputedStyle(element).textAlign);
  if (!align) return;

  for (const node of Array.from(element.querySelectorAll(LIST_SELECTOR))) {
    if (node instanceof view.HTMLElement) {
      writeInlineStyle(node, listAlignmentStyle(align, node.tagName));
    }
  }
}

/**
 * A computed length in pixels, or null when the value is not one.
 *
 * Both target WebViews resolve padding, margin, border width and font-size to
 * `px` on a computed style, so anything else — a keyword, or the empty string
 * jsdom hands back for a property it never computed — is a measurement that did
 * not happen. Null therefore means *unknown*, and every branch below treats an
 * unknown as a reason to write nothing: an override sized from a number nobody
 * measured is worse than a list left exactly as the deck had it.
 *
 * `features/styleValues.ts` has the same three lines for the inspector's number
 * fields. It stays copied rather than shared because the dependency direction
 * runs `features → core` and never back (basic-design/05-directory.md).
 */
function pixels(value: string): number | null {
  if (!value.trim().endsWith('px')) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * What one list computes to, as far as fitting inside a box is concerned.
 *
 * Strings out of `getComputedStyle` rather than the element itself, because
 * none of this can be measured under the test runner: jsdom answers every rect
 * with 0 and computes no cascade, so a branch that read the DOM here could only
 * ever be checked by hand. Splitting the decision from the measurement leaves
 * the part that is easy to get wrong — which declaration for which computed
 * value — testable, and leaves {@link fitListsIntoBox} with nothing but the
 * reading and the writing.
 *
 * The physical properties are read, not the logical ones the UA sheet actually
 * declares (`padding-inline-start`, `margin-block`). In a horizontal LTR deck
 * the two resolve to the same computed number, and reading the same property
 * that gets written is what keeps the check honest — "is what I am about to
 * declare already there". A deck in `direction: rtl` would be measured on the
 * side the marker does not hang off; nothing here has been measured against one,
 * and pretending otherwise would be guessing.
 */
export interface ListMetrics {
  paddingLeft: string;
  listStylePosition: string;
  fontSize: string;
  marginTop: string;
  marginBottom: string;
  /**
   * How far the widest marker in this list reaches to the left of the words,
   * in layout pixels, or null where it could not be measured.
   *
   * Guessed at first, and the guess was the bug: `1.2em` is the width of a
   * bullet, and a number is wider — wider again at `10.` than at `1.`, and
   * wider again in a bold 76px heading. {@link measureMarkerAdvance} asks the
   * page instead.
   */
  markerAdvance: number | null;
}

/**
 * The declarations that put one freshly built list inside its box.
 *
 * Two independent findings, so two independent branches — the three decks
 * measured in Chromium hit them in three different combinations. With no reset
 * at all, the UA's `margin-block: 1em` alone put the list 64px past the bottom
 * of the 90px box, while its 40px indent held the marker safely inside. The
 * sample deck's `* { margin: 0 }` with `ul { padding-left: 1.2em }` had neither
 * a margin to flatten nor a marker to rescue, and still overflowed 14px on the
 * lines alone — which is {@link boxGrowthStyle}'s job, not this one's. The
 * reset that says `* { margin: 0; padding: 0 }` fitted vertically and painted
 * its bullets at a negative x, outside the box entirely.
 *
 * **The gutter is skipped for a marker positioned `inside`**, because there the
 * marker is part of the line rather than something hanging off it, and no
 * padding is needed to hold it. That is also what keeps this from fighting
 * {@link listAlignmentStyle}: centre and right already write
 * `list-style-position: inside` *and* `padding-left: 0`, on purpose, and an
 * indent added here would push their centred lines back off-centre.
 *
 * **The margins are flattened on both sides at once.** The UA writes them as
 * one `margin-block`, a one-sided flatten still leaves the box short by the
 * other side, and there is no case where a list wants 28px above and nothing
 * below. When both are already 0 nothing is written at all: the deck has
 * answered, and a `margin: 0` restating it would only grow the export.
 */
export function listFitStyle(metrics: ListMetrics): Record<string, string> {
  const style: Record<string, string> = {};

  const gutter = pixels(metrics.paddingLeft);
  const em = pixels(metrics.fontSize);
  if (metrics.listStylePosition.trim() !== 'inside' && gutter !== null && em !== null && em > 0) {
    // What the marker actually needs, plus room to not sit on the words. The
    // fallback only stands in where nothing could be measured — a list with no
    // items, or a document that answered with zeroes.
    const wanted =
      metrics.markerAdvance !== null && metrics.markerAdvance > 0
        ? metrics.markerAdvance / em + MARKER_BREATHING_ROOM_EM
        : FALLBACK_MARKER_GUTTER_EM;
    // Rounded up, so the arithmetic can never land a hundredth short of what
    // was measured, and expressed in em so that changing the size later moves
    // the gutter with the marker rather than leaving it behind.
    const needed = Math.ceil(wanted * 100) / 100;
    if (gutter < needed * em) style['padding-left'] = `${needed}em`;
  }

  const above = pixels(metrics.marginTop) ?? 0;
  const below = pixels(metrics.marginBottom) ?? 0;
  if (above !== 0 || below !== 0) {
    style['margin-top'] = '0';
    style['margin-bottom'] = '0';
  }

  return style;
}

/**
 * What a box measures, when the question is whether its content still fits.
 *
 * `offsetHeight` rather than a bounding rect, because the stage is scaled by a
 * CSS transform for the zoom: a rect comes back in screen pixels, and writing
 * one of those into `height` would resize the box by the zoom factor — 50%
 * zoom would halve it. `offsetHeight` is layout pixels, which is the unit
 * `height` is read back in.
 */
export interface BoxMetrics {
  /** The border box. */
  offsetHeight: number;
  /** The padding box: what there is room for. */
  clientHeight: number;
  /** The content, including whatever hangs out of the box. */
  scrollHeight: number;
  boxSizing: string;
  paddingTop: string;
  paddingBottom: string;
  borderTopWidth: string;
  borderBottomWidth: string;
}

/**
 * The height that would hold the content, or nothing when it already fits.
 *
 * `scrollHeight` counts the overflow even where nothing scrolls — an
 * `overflow: visible` box reports the content it is spilling — so the two
 * numbers disagreeing is exactly "there is more here than the box was given".
 *
 * The arithmetic goes through the border box and back rather than using
 * `scrollHeight` as the answer directly, because `height` means different
 * things on either side of `box-sizing`: under `border-box` it includes the
 * padding and border that `scrollHeight` does not, and under `content-box` it
 * excludes the padding that `scrollHeight` does. Handing `scrollHeight` straight
 * to `height` is right in neither case and looks right in both until a deck puts
 * padding on the box.
 *
 * Nothing is written when the box already fits, which is also what keeps this
 * off every element that sizes itself: a box with no height of its own grows
 * with its content, so its two measurements match and it is left alone.
 */
export function boxGrowthStyle(box: BoxMetrics): Record<string, string> {
  const overflow = box.scrollHeight - box.clientHeight;
  if (!(overflow > 0)) return {};

  const grown = box.offsetHeight + overflow;
  const edges =
    (pixels(box.paddingTop) ?? 0) +
    (pixels(box.paddingBottom) ?? 0) +
    (pixels(box.borderTopWidth) ?? 0) +
    (pixels(box.borderBottomWidth) ?? 0);
  const height = box.boxSizing === 'border-box' ? grown : grown - edges;
  if (!(height > 0)) return {};

  // Layout is fractional and this declaration is not: rounding down leaves the
  // last line a sub-pixel short and the box still overflowing, which is the
  // same bug one pixel smaller.
  return { height: `${Math.ceil(height)}px` };
}

/**
 * The lists an element holds right now, to be handed back after a list command.
 *
 * `execCommand` says nothing about what it built — the return value is a bare
 * success flag, and the `<ul>` it mints carries no uid until the session commits
 * — so comparing before with after is the only way to tell the list the button
 * just made from the one the deck's author wrote.
 *
 * Treating "every list inside the box" as the target instead would have been
 * one line and no snapshot, and it would have repainted the author's own lists
 * the first time anyone bulleted a line in the same box: an indent they did not
 * choose, appearing in a deck they had not edited. The cost of the safer half
 * of that trade is a list left untouched when `execCommand` merges the new
 * items into a neighbouring list rather than building one — the deck's look is
 * preserved, which is the side to fall on.
 */
export function listsIn(element: HTMLElement): Set<Element> {
  return new Set(element.querySelectorAll(LIST_ROOT_SELECTOR));
}

/**
 * Puts the lists this command has just built inside the box that holds them.
 *
 * **Runs after `carryAlignmentIntoLists`, and the order is not free.** That one
 * clears `padding-left` on its way back to `left` or `justify`
 * (`listAlignmentStyle` returns the empty string, which `writeInlineStyle`
 * removes), so a gutter written first would be taken straight back out again on
 * any box somebody had explicitly set to left. Running afterwards also means the
 * `list-style-position: inside` the centre and right branches write is already
 * in the computed style this reads, so those two skip the gutter by the same
 * test that skips it for a deck's own `inside`, rather than by a special case.
 *
 * Writes to the DOM rather than running a command, the way
 * `carryAlignmentIntoLists` does: the caller is inside `withUndo`, so the
 * markup difference is picked up by the `commitTextSession` that follows and
 * bulleting stays one undo step (decisions.md #73).
 *
 * **The height is the exception, and it is a known asymmetry.** It lands on the
 * box's own `style` attribute, while the step the session records is the box's
 * `innerHTML` (`SetInnerHtmlCommand`) — which does not carry it. Undoing the
 * bullet takes the list back and leaves the box tall. The alternative was to
 * push the height as a `SetInlineStyleCommand` of its own, and that is the
 * option decisions.md #73 already turned down for the alignment: it costs a
 * second undo step, so one press of the button would need two presses of undo.
 * A box left taller than it needs to be is visible and harmless; a bullet that
 * takes two undos to remove is the operation losing its shape.
 *
 * The height is decided from where the box stands after the list was built, not
 * from how much the list added, so a deck box that was *already* clipping its
 * own text grows too. Measuring the difference would mean carrying a second
 * snapshot through `execCommand` for a case where the box is visibly broken
 * either way, and the growth only ever happens on a box the user is at that
 * moment editing.
 */
/**
 * How far the widest marker in a list reaches to the left of its words.
 *
 * There is no way to ask a marker how wide it is — `::marker` has no box the
 * DOM will hand over, and `getComputedStyle(li, '::marker')` answers about type
 * and colour, never geometry. But the two `list-style-position` values place
 * the same marker differently, and the difference *is* its advance: `outside`
 * hangs it off the line, so the words begin at the item's content edge, while
 * `inside` puts it on the line, so the words begin after it. Flipping the list
 * from one to the other and measuring where the words moved to answers the
 * question the marker will not.
 *
 * The words are found with a `Range` over each item's contents rather than the
 * item's own rect, because the item's rect is the content box either way — it
 * is the *text* that moves.
 *
 * The widest item wins, which is what makes `10.` fit as well as `1.` on a list
 * that reaches ten. Items added later, by pressing Return inside the list, are
 * not measured again; the next press of the button is what re-measures.
 *
 * Everything is put back before returning, including the case where nothing
 * could be measured. Nothing here is ever committed — `StageBridge` serializes
 * on an explicit `commit()` and watches nothing — so no version of the slide
 * contains the flipped value.
 */
export function measureMarkerAdvance(list: HTMLElement): number | null {
  const doc = list.ownerDocument;
  const items = Array.from(list.children).filter((node) => node.tagName === 'LI');
  if (items.length === 0) return null;

  const textLeft = (item: Element): number | null => {
    const range = doc.createRange();
    range.selectNodeContents(item);
    // jsdom has `Range` but not the geometry on it, and the test runner is
    // jsdom. Unmeasurable is a real answer here — the caller falls back to a
    // guess for it — so it is reported rather than thrown, the same way
    // `caretRangeAt` reports an engine without `caretRangeFromPoint`.
    if (typeof range.getBoundingClientRect !== 'function') return null;
    const rect = range.getBoundingClientRect();
    // An item with nothing in it reports an empty rect at the origin, which is
    // not a position and must not be subtracted from one.
    if (rect.width === 0 && rect.height === 0 && rect.left === 0) return null;
    return rect.left - item.getBoundingClientRect().left;
  };

  const restore = list.style.getPropertyValue('list-style-position');
  const outside = items.map(textLeft);
  list.style.setProperty('list-style-position', 'inside');
  const inside = items.map(textLeft);
  if (restore === '') list.style.removeProperty('list-style-position');
  else list.style.setProperty('list-style-position', restore);

  let widest = 0;
  for (let i = 0; i < items.length; i += 1) {
    const before = outside[i];
    const after = inside[i];
    if (before === null || after === null) continue;
    widest = Math.max(widest, after - before);
  }
  return widest > 0 ? widest : null;
}

export function fitListsIntoBox(element: HTMLElement, existing: ReadonlySet<Element>): void {
  const view = element.ownerDocument.defaultView;
  if (!view) return;

  const born = Array.from(element.querySelectorAll(LIST_ROOT_SELECTOR)).filter(
    (node) => !existing.has(node),
  );
  // Nothing was built, so nothing here is ours to move. This is also the path
  // the second press takes — the same button turns a list back into lines — and
  // the press that removes content must not be the one that grows the box.
  if (born.length === 0) return;

  for (const list of born) {
    // The stage document's own constructor, as everywhere else in this file:
    // these elements live in the iframe, so this window's `HTMLElement` would
    // never match.
    if (!(list instanceof view.HTMLElement)) continue;
    const computed = view.getComputedStyle(list);
    writeInlineStyle(
      list,
      listFitStyle({
        paddingLeft: computed.paddingLeft,
        listStylePosition: computed.listStylePosition,
        fontSize: computed.fontSize,
        marginTop: computed.marginTop,
        marginBottom: computed.marginBottom,
        markerAdvance: measureMarkerAdvance(list),
      }),
    );
  }

  // Measured only now. The declarations above are what decide how much is still
  // hanging out of the box, and a height taken before them would be sized to
  // margins that are about to go — 56px too tall, for good.
  const box = view.getComputedStyle(element);
  writeInlineStyle(
    element,
    boxGrowthStyle({
      offsetHeight: element.offsetHeight,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      boxSizing: box.boxSizing,
      paddingTop: box.paddingTop,
      paddingBottom: box.paddingBottom,
      borderTopWidth: box.borderTopWidth,
      borderBottomWidth: box.borderBottomWidth,
    }),
  );
}
