/**
 * Deciding what a click selects.
 *
 * A raw hit test lands on the deepest node, which is almost never what someone
 * means: clicking a word inside a heading should select the heading, the way a
 * click selects a shape rather than a glyph in a slide tool. Inline-level
 * elements are therefore transparent to selection, and the first block-level
 * ancestor wins.
 *
 * The other half of the rule is what a click *cannot* select. In a slide tool
 * the slide is the canvas, not an object on it: clicking bare canvas deselects
 * and starts a rubber band. The slide root is therefore never a target, and
 * neither is anything that merely spans the slide — clicking the padding around
 * someone's layout, or the full-bleed gradient an AI deck lays under it, should
 * not hand back a "shape" the size of the whole slide with resize and rotate
 * handles on it.
 */

import { SLIDE_ROOT_ATTRIBUTE } from '../core/document/compose';
import { pictureOf } from '../core/editing/crop';
import { BLANK_ATTRIBUTE } from './placeholder';

const INLINE_DISPLAYS = new Set(['inline', 'inline-block', 'inline-flex', 'ruby', 'contents']);

/**
 * What a list is built from. These are the *shape of a text box's content*
 * rather than objects on the slide, so selection sees through them the way it
 * sees through a `<b>`.
 *
 * Two things go wrong when they are read as objects. The slide grows two extra
 * selectable boxes for something the user thinks of as one block of text — and
 * worse, a double-click lands the editing host on the `<li>`, which puts the
 * `<ul>` *outside* the element being edited, where the same 箇条書き button can
 * no longer take it off: `execCommand` only unwraps a list it finds inside the
 * editing host. A list you can apply but not remove is the bug this rule fixes.
 */
const LIST_TAGS = new Set(['UL', 'OL', 'LI']);

/**
 * How close to a slide edge still counts as reaching it, as a fraction of the
 * slide. Measured per side rather than by area so the rule does not depend on
 * the deck's aspect ratio: a wrapper inset by a few pixels is the slide's own
 * surface, while a band across the top — flush left, right and top, but far
 * from the bottom — is an object on it.
 */
const SLIDE_EDGE_SLACK = 0.04;

/**
 * Replaced elements: content in their own right rather than containers. They
 * are objects however they are laid out, which is why they stop the climb —
 * an `<img>` is `display:inline` by default, so without this a click on a
 * picture selects the paragraph around it — and why size never disqualifies
 * them from selection. They are also the elements there is no point entering
 * text editing on.
 */
const REPLACED_TAGS = new Set([
  'IMG',
  'PICTURE',
  'SVG',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'INPUT',
]);

/** The element a click selects, or `null` when the click means "empty space". */
export function chooseSelectionTarget(hit: Element): Element | null {
  let current = frameOf(hit) ?? hit;

  while (!isSlideRoot(current) && !isReplaced(current)) {
    const parent = current.parentElement;
    // Never climb into the slide itself: the step after this one would refuse
    // it as canvas, and a click on real content would come back as a click on
    // nothing. One short of the slide is the outermost object there is.
    if (!parent || parent.tagName === 'BODY' || isSlideRoot(parent)) break;

    if (!isTransparent(current)) break;

    current = parent;
  }

  if (isSlideRoot(current) || isBackdrop(current)) return null;
  return current;
}

/**
 * Whether a click landed on scenery rather than on an object.
 *
 * Anything stretched to the slide's own extent is scenery, whether it is the
 * wrapper an AI deck puts its layout in or the empty `<div>` it paints the
 * background gradient on. What saves an element from the rule is carrying
 * something of its own — a photo, a video, its own words — because that is
 * what the user placed and means to grab, however big it ended up. Reaching a
 * backdrop deliberately is still possible through the breadcrumb.
 *
 * Emptiness used to be the exemption instead, which had it backwards: the
 * childless full-bleed `<div>` it protected is the single most common way a
 * generated deck draws its background, so every click on blank slide came back
 * holding the whole slide.
 */
function isBackdrop(element: Element): boolean {
  if (isSelfContained(element)) return false;

  const root = element.closest(`[${SLIDE_ROOT_ATTRIBUTE}]`);
  if (!root || root === element) return true;

  const slide = root.getBoundingClientRect();
  if (slide.width <= 0 || slide.height <= 0) return false;

  const box = element.getBoundingClientRect();
  const slackX = slide.width * SLIDE_EDGE_SLACK;
  const slackY = slide.height * SLIDE_EDGE_SLACK;
  return (
    box.left - slide.left <= slackX &&
    box.top - slide.top <= slackY &&
    slide.right - box.right <= slackX &&
    slide.bottom - box.bottom <= slackY
  );
}

/**
 * The crop frame a picture is the content of.
 *
 * A cropped picture is deliberately bigger than the box it shows through, so
 * selecting the picture hands back the *uncropped* rectangle: handles and a
 * selection frame drawn out where the trimmed-away part would be, and a drag
 * that slides the photo inside its frame instead of moving the object. The
 * frame is the object on the slide (features/image-crop/design.md); the picture
 * is what it holds.
 */
function frameOf(element: Element): Element | null {
  const parent = element.parentElement;
  return parent && pictureOf(parent) === element ? parent : null;
}

/**
 * Whether an element carries content instead of just holding other elements.
 * A crop frame counts: it is a picture, however it is written. So does a box the
 * editor is holding open with nothing in it ({@link isKnownTextBox}).
 */
function isSelfContained(element: Element): boolean {
  return (
    isReplaced(element) ||
    pictureOf(element) !== null ||
    hasOwnText(element) ||
    isKnownTextBox(element)
  );
}

/**
 * Whether the editor already knows this element to be text, even though there
 * is nothing in it at the moment.
 *
 * `hasOwnText` asks whether an element holds words *now*, which is the right
 * question to ask of a deck's own markup — a slide is full of empty `<div>`s
 * used as panels, rules and spacers, and widening the rule to let every one of
 * them be edited is the thing that was rejected twice (decisions #52, #75). It
 * is the wrong question to ask of a box the user has just emptied: deleting the
 * last character turned it back into one of those `<div>`s, so the click that
 * should have selected it climbed to the panel behind it, and none of the three
 * doors into a session would open for it again (issues #104).
 *
 * The mark answers instead, and it can, because only the stage ever writes it:
 * it goes on the box a session is open on, on the box just inserted, and on the
 * box a session left empty (placeholder.ts). Nothing the deck brought with it
 * carries the mark, so the empty `<div>`s stay background. It is `data-hse-`
 * prefixed, so it is gone from anything saved or exported (bridge.ts).
 */
function isKnownTextBox(element: Element): boolean {
  return element.hasAttribute(BLANK_ATTRIBUTE);
}

export function isReplaced(element: Element): boolean {
  return REPLACED_TAGS.has(element.tagName.toUpperCase());
}

/**
 * Whether an element carries words of its own, counting through inline children.
 *
 * The climb above already treats inline elements as transparent, and this has to
 * agree with it, because character formatting is applied with `execCommand` and
 * always wraps what it touches: bolding a heading turns `<h1>text</h1>` into
 * `<h1><b>text</b></h1>`, and picking a size or a font wraps it in a `<span>`.
 * A rule that only looked at direct child text nodes declared the heading
 * textless the moment it was styled — which closed every way back into editing
 * it, and demoted a full-bleed one to backdrop so it could not even be selected.
 *
 * Other block-level children are not followed. That is the half of the rule that
 * keeps a wrapper around a paragraph from posing as a text box: a click on the
 * words lands on the paragraph, so the paragraph is what should offer to be
 * edited. A list is the exception ({@link LIST_TAGS}) — it is how a text box's
 * own words are arranged, not something else standing inside it.
 */
function hasOwnText(element: Element): boolean {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return true;
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const child = node as Element;
    if (!isReplaced(child) && isTransparent(child) && hasOwnText(child)) return true;
  }
  return false;
}

/**
 * Whether selection sees through an element to what contains it: inline boxes,
 * and the tags a list is made of.
 */
function isTransparent(element: Element): boolean {
  if (LIST_TAGS.has(element.tagName)) return true;
  const view = element.ownerDocument.defaultView;
  const display = view ? view.getComputedStyle(element).display : 'block';
  return INLINE_DISPLAYS.has(display);
}

/**
 * One level out, for Escape. Stops before the slide root: stepping "out of" the
 * outermost object means having nothing selected, not selecting the slide.
 */
export function stepOutward(element: Element): Element | null {
  if (isSlideRoot(element)) return null;
  const parent = element.parentElement;
  if (!parent || parent.tagName === 'BODY' || isSlideRoot(parent)) return null;
  return parent;
}

/**
 * The next selectable sibling in either direction, for Tab / Shift+Tab.
 *
 * Walks the element's own generation rather than the whole slide, so tabbing
 * stays inside the group the selection is already in — the same thing clicking
 * around at one level does. Siblings the click rules would refuse (a backdrop,
 * a wrapper with nothing of its own) are skipped rather than selected, and the
 * ends wrap so the key always does something.
 */
export function siblingStep(element: Element, direction: 1 | -1): Element | null {
  const parent = element.parentElement;
  if (!parent) return null;

  const siblings = Array.from(parent.children);
  const start = siblings.indexOf(element);
  if (start < 0) return null;

  for (let offset = 1; offset < siblings.length; offset += 1) {
    const index = (((start + direction * offset) % siblings.length) + siblings.length) % siblings.length;
    const candidate = siblings[index];
    // Only stop where a click would have landed on the sibling itself; anything
    // else would select something the pointer can never reach.
    if (candidate && chooseSelectionTarget(candidate) === candidate) return candidate;
  }
  return null;
}

/**
 * What a click at one point could mean, front to back.
 *
 * The click rules answer for one element; this asks them of every element the
 * point lands in, so that something buried under an opaque shape is still
 * *named* even though no click will ever land on it (issues #102). Hit testing
 * does not care what covers what, so the whole pile comes back from
 * `elementsAt`; the front of it is what a plain click already selects.
 *
 * Several hits collapse onto the same target — a word, its `<b>`, and the
 * heading around them are one entry — so duplicates are dropped rather than
 * counted, or stepping through the stack would stall on the same element.
 * Ancestors are left in: they are under the pointer and they do paint behind,
 * which is the same thing being asked. Reaching them by another route
 * (Escape, the breadcrumb) does not make this route wrong.
 */
export function selectionStack(hits: Element[]): Element[] {
  const stack: Element[] = [];
  for (const hit of hits) {
    const target = chooseSelectionTarget(hit);
    if (!target || stack.includes(target)) continue;
    stack.push(target);
  }
  return stack;
}

/**
 * One step further back in the stack, wrapping at the bottom.
 *
 * Wrapping for the same reason {@link siblingStep} wraps: the gesture always
 * does something, and a pile of two is stepped through by repeating it. An
 * element that is not in the stack at all — nothing selected, or a selection
 * made somewhere else — starts at the front, so the first press behaves like
 * the plain click it is otherwise indistinguishable from.
 */
export function stackStep(stack: Element[], current: Element | null): Element | null {
  if (stack.length === 0) return null;
  const at = current ? stack.indexOf(current) : -1;
  return stack[(at + 1) % stack.length] ?? null;
}

/**
 * Outermost object first, clicked element last. Feeds the breadcrumb.
 *
 * The slide root is left out. The breadcrumb's entries are selectable, so
 * listing the slide there would hand back through one door exactly what every
 * other rule in this file exists to keep shut: the whole slide, wearing resize
 * and rotate handles.
 */
export function ancestryOf(element: Element): Element[] {
  const chain: Element[] = [];
  let current: Element | null = element;
  while (current && current.tagName !== 'BODY' && !isSlideRoot(current)) {
    chain.unshift(current);
    current = current.parentElement;
  }
  return chain;
}

export function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${element.id}`;
  const className = typeof element.className === 'string' ? element.className.trim() : '';
  const first = className.split(/\s+/).filter(Boolean)[0];
  return first ? `${tag}.${first}` : tag;
}

/** Whether an element is worth entering text-edit mode on. */
export function isTextEditable(element: Element): boolean {
  return !isReplaced(element) && (hasOwnText(element) || isKnownTextBox(element));
}

function isSlideRoot(element: Element): boolean {
  return element.hasAttribute(SLIDE_ROOT_ATTRIBUTE);
}
