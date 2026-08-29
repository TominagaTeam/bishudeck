/**
 * The only thing in the editor that touches the stage iframe's DOM.
 *
 * Keeping this behind one interface means commands, tools and plugins address
 * elements by uid and never hold live DOM nodes, which is what lets them stay
 * correct across undo, redo and slide reloads.
 */

import { SLIDE_ROOT_ATTRIBUTE, STAGE_CLASS_ATTRIBUTE } from '../core/document/compose';
import { CROPPING_ATTRIBUTE } from '../core/editing/crop';
import { UID_ATTRIBUTE, newElementUid } from '../shared/ids';
import { BLANK_ATTRIBUTE, CARET_LINE_ATTRIBUTE } from './placeholder';

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Everything the editor writes onto a slide element to *run a session* on it —
 * scaffolding, in the sense EditStage's `startTextEditing` already uses the
 * word: put on as a session opens, taken off as it closes, never a description
 * of anything the user wrote.
 *
 * **The list is kept here because this is the file that has to take them off
 * again.** They are declared where they are used — the two prompt marks with
 * the rules that paint them (placeholder.ts), the crop mark with the session
 * that sets it (core/editing/crop.ts) — and re-declaring the names here would
 * mean a fourth place to forget. What is genuinely one decision, and so lives
 * in one place, is *which* of them count as scaffolding.
 *
 * That question is asked at two doors, and answered the same way at both:
 * anything markup gets copied through has to leave the scaffolding behind, or
 * the copy arrives wearing a session that is not running.
 *
 * - {@link StageBridge.slideMarkup} — an undo snapshot. This is what let a
 *   deleted-then-restored text box come back still carrying `data-hse-blank`,
 *   with no session and no pending box to explain it: the prompt 「テキストを
 *   入力」 painted over an empty box that nothing would ever take it off again
 *   (the CSS stopped asking for `contenteditable` when a merely *selected* box
 *   had to show the prompt too, so the mark alone now paints it).
 * - `cloneInPlace` (core/editing/actions.ts) — ⌘D and Alt-drag. Same symptom
 *   on the copy, which is not even the pending box.
 *
 * **Only session state belongs here.** `data-hse-crop-origin` and
 * `data-hse-crop-owned` look similar and are deliberately absent: they record
 * what an element looked like *before* a crop, which is what 「元の画像に戻す」
 * restores from, and dropping them from a snapshot would lose that across an
 * undo (core/editing/crop.ts). Same for `data-hse-uid` and
 * `data-hse-slide-root`, which are addresses rather than state — see the table
 * on {@link StageBridge.slideMarkup}.
 *
 * `contenteditable` and `spellcheck` are stripped even from a deck that wrote
 * them itself. That is not new — serialization has always taken them off
 * (invariant 2: a saved document must not be editable in the reader's browser)
 * — and a deck that ships `contenteditable` has bigger problems on this stage.
 */
const SCAFFOLD_ATTRIBUTES = [
  'contenteditable',
  'spellcheck',
  BLANK_ATTRIBUTE,
  CARET_LINE_ATTRIBUTE,
  CROPPING_ATTRIBUTE,
];

/**
 * Attributes that must be gone from a saved document: the scaffolding above,
 * plus the two addresses the editor works by. Only serialization takes that
 * second pair off — every other place markup is copied through needs them to
 * survive, which is the whole of the difference between the two doors.
 */
const EDITOR_ATTRIBUTES = [UID_ATTRIBUTE, SLIDE_ROOT_ATTRIBUTE, ...SCAFFOLD_ATTRIBUTES];

export class StageBridge {
  #doc: Document;
  #onCommit: () => void;
  #index = new Map<string, Element>();

  constructor(doc: Document, onCommit: () => void) {
    this.#doc = doc;
    this.#onCommit = onCommit;
    this.reindex();
  }

  get document(): Document {
    return this.#doc;
  }

  /** Stamps a uid on every element and rebuilds the lookup table. */
  reindex(): void {
    this.#index.clear();
    for (const element of Array.from(this.#doc.body.querySelectorAll('*'))) {
      let uid = element.getAttribute(UID_ATTRIBUTE);
      if (!uid || this.#index.has(uid)) {
        uid = newElementUid();
        element.setAttribute(UID_ATTRIBUTE, uid);
      }
      this.#index.set(uid, element);
    }
  }

  /** Serializes the stage and pushes it into the document store. */
  commit(): void {
    this.#onCommit();
  }

  resolve(uid: string): Element | null {
    const cached = this.#index.get(uid);
    if (cached?.isConnected) return cached;
    const found = this.#doc.body.querySelector(`[${UID_ATTRIBUTE}="${CSS.escape(uid)}"]`);
    if (found) this.#index.set(uid, found);
    return found;
  }

  uidOf(element: Element): string | null {
    return element.getAttribute(UID_ATTRIBUTE);
  }

  /** Element under a point given in the iframe's own coordinate space. */
  elementAt(x: number, y: number): Element | null {
    return this.#doc.elementFromPoint(x, y);
  }

  /**
   * Everything of the slide's whose box holds that point, front to back as far
   * as that can be known: what a pointer can reach first, in paint order, then
   * what it cannot.
   *
   * `elementFromPoint` answers with the topmost element only, which is why an
   * element moved behind an opaque one became unreachable
   * ([issues](../../docs/issues.md) #102). But hit testing is the wrong
   * question to ask twice, because it is not only occlusion that takes an
   * element out of it. Measured on slide 12 of the deck used for checking, an
   * element dragged out of a card that carries `overflow:hidden` sits at
   * (706, 162)–(1214, 258) with the pointer dead in the middle of it, and:
   *
   * | asked | answer |
   * |---|---|
   * | `elementFromPoint` | the panel behind it |
   * | `elementsFromPoint` | six elements, **the moved one not among them** |
   * | box contains the point | **found** |
   *
   * Clipping removes an element from hit testing, not just from painting, and
   * so does `pointer-events:none`. Neither is a reason the editor cannot
   * address the object — the user put it there and can see the selection frame
   * drawn around it — so the tail of the pile is measured geometrically
   * instead, and everything reachable is kept in front of it.
   *
   * Document order reversed for that tail: a later sibling paints over an
   * earlier one and a child over its parent, so reversing puts the front
   * first. It ignores `z-index`, which is why it is only the *tail* — where
   * hit testing works it has already given the true order.
   */
  elementsAt(x: number, y: number): Element[] {
    const reachable = this.#doc.elementsFromPoint(x, y).filter((el) => this.isInsideSlide(el));
    const seen = new Set(reachable);
    const unreachable: Element[] = [];

    for (const element of this.editableElements()) {
      if (seen.has(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      // Hidden by the deck rather than lost by the user: `visibility:hidden`
      // still has a box, and offering what a deck deliberately does not show
      // is not the same favour as handing back what someone just dragged out
      // of sight. `display:none` needs no test — it has no box to hold a point.
      const view = element.ownerDocument.defaultView;
      if (view && view.getComputedStyle(element).visibility === 'hidden') continue;
      unreachable.push(element);
    }

    return [...reachable, ...unreachable.reverse()];
  }

  rectOf(uid: string): ElementRect | null {
    const element = this.resolve(uid);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }

  /** Roots of the slide itself, excluding the surrounding shell. */
  slideRoots(): Element[] {
    return Array.from(this.#doc.body.querySelectorAll(`[${SLIDE_ROOT_ATTRIBUTE}]`));
  }

  /**
   * The slide as it stands in the stage, addresses and all, ready to be handed
   * back to {@link replaceSlideContent} — an undo snapshot.
   *
   * It used to be `outerHTML` and nothing else, on the grounds that a snapshot
   * is not an export and so needs no cleaning. Two of the three kinds of thing
   * the editor writes want exactly that; the third does not:
   *
   * | what | {@link serializeSlide} | here |
   * |---|---|---|
   * | addresses (`data-hse-uid`, `data-hse-slide-root`) | dropped | **kept** — restoring markup that has lost its uids loses every selection and every element the history still points at (invariant 6) |
   * | the deck's own state parked out of the way (`data-hse-crop-origin`, the stage's added classes) | put back / dropped | **kept** — it is what an undo has to restore |
   * | session scaffolding ({@link SCAFFOLD_ATTRIBUTES}) | dropped | **dropped** — a session that is no longer running |
   *
   * The third row is the fix: nothing takes the session's marks off an element
   * that arrives back through an undo, because the code that would (EditStage's
   * `stopTextEditing`, `useCropSession.stop`) only ever runs for the session it
   * is itself holding. A restored `data-hse-blank` therefore painted 「テキスト
   * を入力」 over an empty box for as long as the slide stayed open.
   *
   * Cloning to strip, rather than stripping in place and putting things back:
   * this runs twice per structural edit, and an exception thrown halfway
   * through an in-place version would leave a live session's element without
   * the attributes that are running it. `outerHTML` already walks the whole
   * tree, so the extra clone is the same order of work.
   */
  slideMarkup(): string {
    return this.slideRoots()
      .map((root) => {
        const clone = root.cloneNode(true) as Element;
        this.stripScaffolding(clone);
        return clone.outerHTML;
      })
      .join('\n');
  }

  /**
   * Takes {@link SCAFFOLD_ATTRIBUTES} off an element and everything under it,
   * leaving addresses, styles, classes and the deck's own attributes alone.
   *
   * The other half of {@link slideMarkup}'s job, exposed because the second
   * door markup is copied through — `cloneInPlace` in core/editing/actions.ts —
   * has to answer the same question and must not keep a second list to answer
   * it with. A method rather than an exported function so that caller reaches
   * it through the bridge it is already holding: it imports this module for the
   * type alone today, and making that a value import would close a cycle
   * (bridge → crop → actions → bridge) around module-level `const`s.
   *
   * A caret line's `<br>` stays; only its mark comes off, exactly as
   * serialization treats it. By then the break is a node in the document like
   * any other, and taking it out of a copy would be an edit to that copy —
   * deciding for the user that the empty line was ours (placeholder.ts).
   */
  stripScaffolding(root: Element): void {
    for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
      for (const name of SCAFFOLD_ATTRIBUTES) element.removeAttribute(name);
    }
  }

  /** Swaps the slide's markup wholesale, keeping the surrounding shell intact. */
  replaceSlideContent(html: string): void {
    const roots = this.slideRoots();
    const parent = roots[0]?.parentElement;
    if (!parent) return;

    const template = this.#doc.createElement('template');
    template.innerHTML = html;
    parent.insertBefore(template.content, roots[0]);
    for (const root of roots) root.remove();

    this.reindex();
  }

  /**
   * Whether an element belongs to the slide rather than the shell around it.
   * Deck furniture such as a fixed header is rendered for fidelity but is not
   * part of the slide, so it must not be selectable.
   */
  isInsideSlide(element: Element): boolean {
    return this.slideRoots().some((root) => root === element || root.contains(element));
  }

  /** Elements that can be selected and moved: the slide's own content. */
  editableElements(): Element[] {
    const roots = this.slideRoots();
    return roots.flatMap((root) => Array.from(root.querySelectorAll('*')));
  }

  /**
   * Serializes the slide back to a fragment, undoing every annotation the editor
   * added. What comes out must be loadable by any browser with no trace of the
   * editor in it (docs/adr/0001-html-as-source-of-truth.md).
   */
  serializeSlide(): string {
    return this.slideRoots()
      .map((root) => {
        const clone = root.cloneNode(true) as Element;
        for (const element of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
          cleanElement(element);
        }
        return clone.outerHTML;
      })
      .join('\n');
  }
}

function cleanElement(element: Element): void {
  // Classes the stage added to make a lone slide visible are not the author's.
  const staged = element.getAttribute(STAGE_CLASS_ATTRIBUTE);
  if (staged) {
    element.classList.remove(...staged.split(/\s+/).filter(Boolean));
    if (element.getAttribute('class') === '') element.removeAttribute('class');
  }

  for (const name of EDITOR_ATTRIBUTES) element.removeAttribute(name);

  for (const attr of Array.from(element.attributes)) {
    if (!attr.name.startsWith('data-hse-')) continue;
    // Put back what compose() parked out of the way to make the slide inert.
    const original = attr.name.slice('data-hse-'.length);
    if (original === 'type' || /^on/i.test(original)) {
      element.setAttribute(original, attr.value);
    }
    element.removeAttribute(attr.name);
  }

  if (element.tagName === 'SCRIPT' && element.getAttribute('type') === 'application/hse-disabled') {
    element.removeAttribute('type');
  }
}
