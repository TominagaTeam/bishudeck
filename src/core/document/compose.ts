/**
 * Rebuilding a complete HTML document from a slide plus the deck's shared
 * resources. This is the single place where slide HTML becomes something a
 * browser can render, for both stage modes and for export.
 */

import { bundledFontStylesheetUrl } from '../../shared/bundledFonts';
import { SLIDE_SLOT, type SharedResources, type Slide } from './model';

export type ComposeMode = 'preview' | 'edit' | 'export';

export interface ComposeOptions {
  /**
   * `preview` runs the deck's scripts as authored. `edit` renders identical
   * CSS but with every script neutralized, because a document that rewrites
   * itself cannot also be edited by hand (docs/adr/0002-edit-preview-separation.md).
   */
  mode: ComposeMode;
  /** Origin that `assets/...` references resolve against. */
  baseUrl?: string;
  /**
   * Where this slide sits in the deck, for previewing one slide of a scripted
   * deck. Decks routinely decide what to run from their own slide index — a
   * canvas loop that only starts on slide 4, say — and a slide rendered alone
   * would be slide 1 as far as that script is concerned. See
   * {@link scaffoldDeckPosition}.
   */
  deckPosition?: { index: number; total: number };
}

/** Attribute the editor adds to disabled scripts so they can be restored. */
const DISABLED_SCRIPT_TYPE = 'application/hse-disabled';

/**
 * Marks the outermost elements that came from the slide itself, so the edit
 * stage can serialize the slide back out without dragging the shell along.
 */
export const SLIDE_ROOT_ATTRIBUTE = 'data-hse-slide-root';

/** Records which class the stage added, so only that one is removed on save. */
export const STAGE_CLASS_ATTRIBUTE = 'data-hse-stage-class';

/** Marks the one real slide among the placeholders of a scripted preview. */
export const PREVIEW_TARGET_ATTRIBUTE = 'data-hse-preview-target';

/** Marks an empty stand-in for a slide that is not being previewed. */
export const PLACEHOLDER_ATTRIBUTE = 'data-hse-placeholder';

/**
 * Marks something the editor put into the shared shell rather than something
 * the deck's author wrote, naming what it is.
 *
 * An exported file may carry the editor's own scaffolding as long as it does
 * not break the file (docs/rules/development.md §4, invariant 2) — and the
 * stage CSS is load-bearing for a deck whose runtime is gone, so it has to be carried. What
 * the rule does forbid is scaffolding that piles up, and this is how it does
 * not: on the way back in, the importer drops everything wearing this mark and
 * the next compose writes it fresh, so a deck opened and saved a hundred times
 * holds exactly one copy.
 */
export const INJECTED_ATTRIBUTE = 'data-hse-injected';

/** The `<style>` that keeps a deck-stage deck from painting before it upgrades. */
export const DECK_GUARD_CSS = 'deck-stage:not(:defined){visibility:hidden}';

/** How long the deck gets to react to the injected navigation. */
const NAVIGATION_SETTLE_MS = 250;

export function composeSlideDocument(
  shared: SharedResources,
  slide: Slide,
  options: ComposeOptions,
): string {
  return composeDocument(shared, [slide], options);
}

/**
 * Builds one document containing several slides, each in its own copy of the
 * shell. Used by export and print paths; the stage always passes a single slide.
 */
export function composeDocument(
  shared: SharedResources,
  slides: Slide[],
  options: ComposeOptions,
): string {
  const doc = document.implementation.createHTMLDocument('');

  applyAttributes(doc.documentElement, shared.htmlAttrs);
  applyAttributes(doc.body, shared.bodyAttrs);

  doc.head.innerHTML = shared.headHtml;
  stripBaseTags(doc.head);
  linkBundledFonts(doc, options);
  if (options.baseUrl) {
    const base = doc.createElement('base');
    base.setAttribute('href', `${options.baseUrl.replace(/\/$/, '')}/`);
    doc.head.prepend(base);
  }

  // The shell is the deck's body with its slides lifted out, so putting them
  // all back into the one slot reconstructs the original document exactly —
  // including wrappers like `.deck` that must not be repeated per slide.
  const onStage = options.mode !== 'export';
  const scaffold = scaffoldDeckPosition(shared, slides, options);
  const content = slides
    .map((slide) =>
      prepareSlide(slide.html, {
        markRoot: options.mode === 'edit',
        markTarget: scaffold !== null,
        // Only a slide shown by itself needs the deck's active-slide classes;
        // an export keeps whichever slide the deck itself marked as active.
        addClasses: onStage ? shared.stageClasses : [],
      }),
    )
    .join('\n');
  doc.body.innerHTML = fillShell(
    shared.slideShell,
    scaffold ? scaffold.before + content + scaffold.after : content,
  );

  if (scaffold) {
    doc.body.insertAdjacentHTML('beforeend', navigationBootstrap(scaffold.index, shared.stageClasses));
  }

  if (options.mode === 'export') {
    restoreDeckRuntime(doc, shared.deckRuntime);
  }

  if (options.mode === 'edit') {
    neutralizeScripts(doc);
  }

  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

/**
 * Points the document at the typefaces that ship with the app, so the default
 * font is a face that is actually there rather than the first name in a chain
 * of hopes (shared/bundledFonts.ts).
 *
 * **Stage only.** An export is a file that leaves this machine, and a
 * `slides://` stylesheet means nothing anywhere else — the exported deck keeps
 * naming the family in its `font-family` and falls through the stack the way it
 * always has (docs/rules/development.md §4, invariant 2 and the last one).
 *
 * It goes in ahead of the deck's own head, which is the order that lets a deck
 * declaring its own `@font-face` for the same family win: later declarations
 * take precedence, and a deck's own webfont is not ours to override.
 */
function linkBundledFonts(doc: Document, options: ComposeOptions): void {
  if (options.mode === 'export') return;
  const href = bundledFontStylesheetUrl(options.baseUrl ?? '');
  if (!href) return;

  const link = doc.createElement('link');
  // Marked as the editor's own, so a file that somehow carried one back in
  // loses it on import rather than accumulating a second copy.
  link.setAttribute(INJECTED_ATTRIBUTE, 'bundled-fonts');
  link.rel = 'stylesheet';
  link.href = href;
  doc.head.prepend(link);
}

/**
 * Puts a `<deck-stage>` deck's own presentation runtime back into the exported
 * file, so it opens the way it did before it was ever imported: one slide on
 * screen, a thumbnail rail, arrow keys and page keys paging through it.
 *
 * Two details make it land intact.
 *
 * `</script>` appears inside the runtime's own usage comment, and a script
 * element ends at the first one of those no matter where it sits in the
 * source. Escaping the slash means nothing to JavaScript — `<\/script` and
 * `</script` are the same characters to it — and everything to the HTML
 * parser that has to read this file back.
 *
 * The visibility guard is the rule the component's own documentation asks for.
 * It is marked as the editor's own ({@link INJECTED_ATTRIBUTE}) so that reading
 * the file back drops it instead of stacking a second copy on top.
 * Until the script has run and defined the element, the deck-stage CSS the
 * importer supplied is in charge and lays every slide out in flow; without the
 * guard a big deck paints that way first and then collapses to a single slide
 * in front of the reader. It is scoped to `:not(:defined)`, so it stops
 * applying the moment the element is registered — and it is only ever written
 * here, where a script that will register it is going out in the same file.
 */
function restoreDeckRuntime(doc: Document, source: string | undefined): void {
  if (!source) return;

  const guard = doc.createElement('style');
  guard.setAttribute(INJECTED_ATTRIBUTE, 'deck-guard');
  guard.textContent = DECK_GUARD_CSS;
  doc.head.append(guard);

  const script = doc.createElement('script');
  script.textContent = source.replace(/<\/script/gi, '<\\/script');
  doc.body.append(script);
}

/**
 * Empty stand-ins for the deck's other slides, so a slide previewed on its own
 * still sits at its real index.
 *
 * A deck's own script is the authority on what a slide does — this one turns a
 * canvas loop on only while its index is 4 — and a lone slide would be index 0
 * to it. Rather than emulate any of that, the preview reproduces the shape of
 * the deck (placeholders + the real slide) and then asks the deck to navigate
 * to the slide with its own keyboard controls. If the deck does not respond,
 * the injected scaffolding removes itself and the preview falls back to the
 * single-slide rendering, so a deck that never had navigation is unaffected.
 */
function scaffoldDeckPosition(
  shared: SharedResources,
  slides: Slide[],
  options: ComposeOptions,
): { index: number; before: string; after: string } | null {
  const position = options.deckPosition;
  if (options.mode !== 'preview' || !position || slides.length !== 1) return null;
  if (position.total < 2 || position.index < 0 || position.index >= position.total) return null;
  // Nothing to navigate: a deck with no scripts shows the slide it is given.
  if (!hasScripts(shared)) return null;

  const stub = placeholderFor(slides[0].html);
  if (!stub) return null;

  return {
    index: position.index,
    before: stub.repeat(position.index),
    after: stub.repeat(position.total - position.index - 1),
  };
}

function hasScripts(shared: SharedResources): boolean {
  return /<script[\s>]/i.test(shared.headHtml) || /<script[\s>]/i.test(shared.slideShell);
}

/**
 * A copy of the slide's outermost element with its content dropped: the deck's
 * `querySelectorAll('.slide')` has to find it, its own data attributes have to
 * read sensibly, and it must never show up on screen.
 */
function placeholderFor(slideHtml: string): string | null {
  const holder = document.implementation.createHTMLDocument('').createElement('div');
  holder.innerHTML = slideHtml;
  const root = holder.firstElementChild;
  if (!root) return null;

  const stub = root.ownerDocument.createElement(root.tagName.toLowerCase());
  for (const attr of Array.from(root.attributes)) {
    // An id would be duplicated, and editor attributes belong to the real slide.
    if (attr.name === 'id' || attr.name.startsWith('data-hse-')) continue;
    stub.setAttribute(attr.name, attr.value);
  }
  stub.setAttribute(PLACEHOLDER_ATTRIBUTE, '');
  stub.setAttribute('aria-hidden', 'true');
  // Inline, so the deck's own stylesheet cannot bring a placeholder on screen.
  stub.setAttribute('style', 'display:none !important');
  return `${stub.outerHTML}\n`;
}

/**
 * Drives the deck to the previewed slide through its own controls, and undoes
 * the scaffolding if it did not get there.
 */
function navigationBootstrap(index: number, stageClasses: string[]): string {
  const script = `(function () {
  var target = document.querySelector('[${PREVIEW_TARGET_ATTRIBUTE}]');
  if (!target) return;

  // Dispatched on the document, not the window: a bubbling event reaches
  // listeners on both, while a window-targeted one would miss half of them.
  // Sending it twice would advance the deck twice per step.
  function press() {
    for (var i = 0; i < ${index}; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39,
        bubbles: true, cancelable: true,
      }));
    }
  }

  function shown() {
    var style = getComputedStyle(target);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) < 0.05) return false;
    var rect = target.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function settle() {
    if (shown()) return;
    document.querySelectorAll('[${PLACEHOLDER_ATTRIBUTE}]').forEach(function (stub) {
      stub.remove();
    });
    ${JSON.stringify(stageClasses)}.forEach(function (name) { target.classList.add(name); });
  }

  function start() {
    press();
    setTimeout(settle, ${NAVIGATION_SETTLE_MS});
  }

  // After load, so decks whose scripts are modules or deferred have their
  // listeners in place before the first key arrives.
  if (document.readyState === 'complete') start();
  else addEventListener('load', start);
})();`;
  return `<script>${script}</script>`;
}

/** Substitutes slide markup for the slot comment left by the importer. */
export function fillShell(shell: string, slideHtml: string): string {
  const slot = `<!--${SLIDE_SLOT}-->`;
  return shell.includes(slot) ? shell.replace(slot, slideHtml) : slideHtml;
}

/**
 * Annotates a slide's outermost elements for rendering. Both the root marker
 * and the stage classes are stripped again on the way out, so the stored slide
 * keeps exactly the markup that was authored.
 */
function prepareSlide(
  slideHtml: string,
  {
    markRoot,
    markTarget,
    addClasses,
  }: { markRoot: boolean; markTarget: boolean; addClasses: string[] },
): string {
  if (!markRoot && !markTarget && addClasses.length === 0) return slideHtml;

  const holder = document.implementation.createHTMLDocument('').createElement('div');
  holder.innerHTML = slideHtml;
  for (const child of Array.from(holder.children)) {
    if (markRoot) child.setAttribute(SLIDE_ROOT_ATTRIBUTE, '');
    if (markTarget) child.setAttribute(PREVIEW_TARGET_ATTRIBUTE, '');

    // Recorded so serialization can tell an added class from an authored one
    // and remove only what the stage put there.
    const added = addClasses.filter((name) => !child.classList.contains(name));
    if (added.length > 0) {
      child.classList.add(...added);
      child.setAttribute(STAGE_CLASS_ATTRIBUTE, added.join(' '));
    }
  }
  return holder.innerHTML;
}

function applyAttributes(element: Element, serialized: string): void {
  if (!serialized.trim()) return;
  // Round-tripping through the parser avoids hand-rolling attribute parsing,
  // including quoting and entity rules.
  const holder = document.implementation.createHTMLDocument('').createElement('div');
  holder.innerHTML = `<i ${serialized}></i>`;
  const parsed = holder.firstElementChild;
  if (!parsed) return;
  for (const attr of Array.from(parsed.attributes)) {
    element.setAttribute(attr.name, attr.value);
  }
}

export function serializeAttributes(element: Element): string {
  return Array.from(element.attributes)
    .map((attr) => `${attr.name}="${escapeAttribute(attr.value)}"`)
    .join(' ');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function stripBaseTags(head: HTMLHeadElement): void {
  head.querySelectorAll('base').forEach((el) => el.remove());
}

/**
 * Disables scripts without deleting them, so the original markup can always be
 * restored on save. Inline event handlers go too: they are scripts that happen
 * to live in attributes.
 */
function neutralizeScripts(doc: Document): void {
  doc.querySelectorAll('script').forEach((script) => {
    const original = script.getAttribute('type');
    if (original !== null) script.setAttribute('data-hse-type', original);
    script.setAttribute('type', DISABLED_SCRIPT_TYPE);
  });

  doc.querySelectorAll('*').forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      if (/^on/i.test(attr.name)) {
        element.setAttribute(`data-hse-${attr.name}`, attr.value);
        element.removeAttribute(attr.name);
      }
    }
  });
}
