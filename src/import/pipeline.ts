/**
 * HTML -> Project.
 *
 * Parsing runs through the browser's own DOMParser, so the structure the editor
 * sees is by definition the structure the renderer will see. Documents parsed
 * this way are inert: no script in the imported file runs during import.
 */

import { newSlideId } from '../shared/ids';
import {
  DECK_GUARD_CSS,
  INJECTED_ATTRIBUTE,
  serializeAttributes,
} from '../core/document/compose';
import {
  DEFAULT_DESIGN_HEIGHT,
  DEFAULT_DESIGN_WIDTH,
  PROJECT_VERSION,
  SLIDE_SLOT,
  type Project,
  type SharedResources,
  type Slide,
} from '../core/document/model';
import { deckStageDetector } from './detectors/deckStage';
import { impressDetector, revealDetector, swiperDetector } from './detectors/frameworks';
import { fullpageDetector, genericPatternDetector, singlePageDetector } from './detectors/generic';
import type { DetectionResult, SlideDetector } from './types';
import { t } from '../shared/i18n';

export const DETECTORS: SlideDetector[] = [
  revealDetector,
  deckStageDetector,
  impressDetector,
  swiperDetector,
  genericPatternDetector,
  fullpageDetector,
  singlePageDetector,
];

export type Candidate = DetectionResult & { detectorId: string; slideCount: number };

export interface ImportAnalysis {
  /** Highest-confidence candidate; the one the UI preselects. */
  best: Candidate | null;
  /**
   * Every candidate, best first, so the user can override the guess. No
   * confidence threshold sits alongside this: the split is confirmed however
   * sure the guess looks, because a wrong split is the one import failure that
   * is expensive to undo by hand (see importHtml in src/app/actions.ts).
   */
  candidates: Candidate[];
  title: string;
}

export function analyzeHtml(html: string): ImportAnalysis {
  const doc = parse(html);
  const candidates: Candidate[] = [];

  for (const detector of DETECTORS) {
    let found: DetectionResult | null = null;
    try {
      found = detector.detect(doc);
    } catch (cause) {
      console.warn(`[import] detector "${detector.id}" threw`, cause);
    }
    if (!found || found.slides.length === 0) continue;
    candidates.push({ ...found, detectorId: detector.id, slideCount: found.slides.length });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0] ?? null;

  return {
    best,
    candidates,
    title: doc.title.trim() || 'Untitled',
  };
}

/**
 * Re-parses and applies the chosen detector. Working from the original string
 * rather than a shared Document means the user can flip between candidates in
 * the import dialog without earlier attempts having mutated anything.
 */
export function buildProject(html: string, detectorId: string, title?: string): Project {
  const doc = parse(html);
  const detector = DETECTORS.find((d) => d.id === detectorId);
  const detection = detector?.detect(doc) ?? singlePageDetector.detect(doc);

  if (!detection || detection.slides.length === 0) {
    throw new Error(t('error.noSlidesDetected'));
  }

  const slides: Slide[] = detection.slides.map((element) => ({
    id: newSlideId(),
    html: element === doc.body ? element.innerHTML : element.outerHTML,
  }));

  const shared = extractShared(doc, detection);
  const now = new Date().toISOString();

  return {
    version: PROJECT_VERSION,
    meta: {
      title: title ?? doc.title.trim() ?? 'Untitled',
      createdAt: now,
      updatedAt: now,
    },
    shared,
    slides,
    assets: [],
  };
}

/**
 * Carves the document into "everything a slide needs around it" and leaves a
 * slot where the slide goes. Removing the slides in place, rather than
 * reconstructing the wrappers, keeps sibling furniture (fixed headers, reveal's
 * controls, background layers) exactly as authored.
 */
function extractShared(doc: Document, detection: DetectionResult): SharedResources {
  const stageClasses = detectStageClasses(detection.slides);
  const deckRuntime = liftDeckRuntime(doc);
  dropEditorScaffolding(doc, detection.runtimeCss);
  const slot = doc.createComment(SLIDE_SLOT);
  const [first, ...rest] = detection.slides;

  if (first === doc.body) {
    doc.body.replaceChildren(slot);
  } else {
    first.replaceWith(slot);
    for (const element of rest) {
      // The indentation that sat in front of a slide goes with it. Left
      // behind, it is whitespace the shell now holds *and* whitespace compose
      // writes between the slides it puts back — so the file gains a newline
      // every time it is opened and saved, and never settles.
      dropLeadingWhitespace(element);
      element.remove();
    }
  }

  return {
    htmlAttrs: serializeAttributes(doc.documentElement),
    headHtml: withRuntimeCss(doc.head.innerHTML, detection.runtimeCss),
    bodyAttrs: serializeAttributes(doc.body),
    slideShell: doc.body.innerHTML,
    deckRuntime,
    framework: detection.framework,
    stageClasses,
    // Most markup says nothing about the deck's intended size, so start at 16:9
    // and let the user correct it in the inspector; a detector that found a
    // stated size (deck-stage) overrides that.
    designWidth: detection.designWidth ?? DEFAULT_DESIGN_WIDTH,
    designHeight: detection.designHeight ?? DEFAULT_DESIGN_HEIGHT,
  };
}

/** Removes the whitespace-only text between `element` and whatever precedes it. */
function dropLeadingWhitespace(element: Element): void {
  let node = element.previousSibling;
  while (node && node.nodeType === Node.TEXT_NODE && !(node.nodeValue ?? '').trim()) {
    const previous = node.previousSibling;
    node.parentNode?.removeChild(node);
    node = previous;
  }
}

/** An inline script that registers the `<deck-stage>` element. */
const DECK_STAGE_REGISTRATION = /customElements\s*\.\s*define\(\s*['"]deck-stage['"]/;

/**
 * Takes the deck's presentation runtime out of the shell and hands it back
 * separately.
 *
 * `<deck-stage>` shows one slide at a time and draws its own thumbnail rail —
 * the deck as its author published it, and what an export has to go back to
 * being. Inside the editor it would fight the workspace: the canvas renders a
 * single slide already, and the rail would sit on top of the one in the left
 * pane. Held aside, it is out of the way of every mode but export, and
 * `hasScripts()` keeps reading the shell as the static markup it now is.
 *
 * Matching on the registration rather than on a marker of our own is what lets
 * an exported deck come back in: the file the editor writes is a plain
 * `<deck-stage>` deck with an ordinary inline script, indistinguishable from
 * one written by hand, and it has to round-trip as the same project.
 */
function liftDeckRuntime(doc: Document): string | undefined {
  for (const script of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const source = script.textContent ?? '';
    if (!DECK_STAGE_REGISTRATION.test(source)) continue;
    script.remove();
    return source;
  }
  return undefined;
}

/**
 * Class names decks use to mark whichever slide is currently on screen. Many
 * hide every slide by default (`opacity:0`) and reveal only the marked one, so
 * a slide rendered on its own would be blank without it.
 */
const STATE_CLASS = /^(is-|has-)?(active|current|present|presenting|visible|shown|selected|showing)$/i;

/**
 * Picks out state classes by looking for ones that only some slides carry.
 * A class every slide has is part of the design, not the state; matching the
 * name pattern as well keeps per-slide variants like `title` from being copied
 * onto the whole deck.
 */
function detectStageClasses(slides: Element[]): string[] {
  if (slides.length < 2) return [];

  const classLists = slides.map((slide) => new Set(Array.from(slide.classList)));
  const onEverySlide = (name: string) => classLists.every((set) => set.has(name));

  const found = new Set<string>();
  for (const set of classLists) {
    for (const name of set) {
      if (!onEverySlide(name) && STATE_CLASS.test(name)) found.add(name);
    }
  }
  return Array.from(found);
}

/**
 * Puts a detector's runtime CSS at the front of the head, so a deck that also
 * styles those elements itself still wins the cascade.
 *
 * It is marked as the editor's own, which is what keeps it to one copy: this
 * runs on every import, including the import of a file the editor itself wrote,
 * and {@link dropEditorScaffolding} has just taken the previous one out.
 */
function withRuntimeCss(headHtml: string, runtimeCss: string | undefined): string {
  if (!runtimeCss) return headHtml;
  return `<style ${INJECTED_ATTRIBUTE}="stage-css">\n${runtimeCss}\n</style>${headHtml}`;
}

/**
 * Removes what a previous session's editor put in the head, so this one can
 * write it again.
 *
 * Everything taken out here is regenerated by the next compose, so nothing is
 * lost — and leaving it in is what would make the file grow by a `<style>` on
 * every open-and-save (save is export here, §7.4).
 *
 * Files written before the mark existed are matched on their text instead. The
 * two things the editor has ever injected are generated deterministically —
 * `stageCss(width, height)` from the same element this import just read, and a
 * fixed guard string — so an exact match is the deck's own copy of ours and
 * nothing else. Anything that does not match exactly is the author's and is
 * left alone (§6.4).
 */
function dropEditorScaffolding(doc: Document, runtimeCss: string | undefined): void {
  // Whatever wears the mark is ours, whatever its tag. It was only ever a
  // `<style>` until the stage started pointing documents at the bundled
  // typefaces with a `<link>` (core/document/compose.ts) — that one is written
  // for the stage alone and never reaches an exported file, but the mark has to
  // keep meaning what it says or the next injected tag brings this back.
  for (const element of Array.from(doc.querySelectorAll(`[${INJECTED_ATTRIBUTE}]`))) {
    element.remove();
  }

  for (const style of Array.from(doc.querySelectorAll('style'))) {
    const text = (style.textContent ?? '').trim();
    const mine = text === DECK_GUARD_CSS || (runtimeCss !== undefined && text === runtimeCss.trim());
    if (mine) style.remove();
  }
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}
