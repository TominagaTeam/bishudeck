/**
 * The document model.
 *
 * The source of truth for a slide is its HTML string, never a derived object
 * graph. Anything the editor does not understand survives a round trip
 * untouched, which is what makes arbitrary AI-generated decks reproducible.
 */

export const PROJECT_VERSION = 1;

export interface ProjectMeta {
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface SharedResources {
  /** Attributes of the original `<html>` tag, as a serialized attribute list. */
  htmlAttrs: string;
  /** Everything that was inside `<head>`: styles, links, scripts, meta. */
  headHtml: string;
  /** Attributes of the original `<body>` tag. */
  bodyAttrs: string;
  /**
   * The original body markup with every slide removed and {@link SLIDE_SLOT}
   * left where the first one stood. Rendering a slide means dropping its HTML
   * back into this hole, which restores whatever wrapper structure the deck
   * relied on (`.reveal > .slides`, a fixed header, ...) exactly as authored.
   */
  slideShell: string;
  /** Detector that claimed the document: `reveal`, `generic-section`, ... */
  framework: string;
  /**
   * Classes the deck puts on whichever slide is currently on screen, such as
   * `is-active`. Many decks hide every slide by default and reveal only the
   * active one, so a slide shown on its own would render blank without these.
   *
   * They are a *rendering* concern and are never written into the slide's own
   * markup: export reproduces the deck's original active-slide state instead.
   */
  stageClasses: string[];
  /**
   * Logical stage size in CSS pixels. Slides are rendered at exactly this size
   * and then scaled to fit, so `100vh` layouts stay stable no matter how the
   * editor window is resized.
   */
  designWidth: number;
  designHeight: number;
  /**
   * The deck's own presentation runtime, held aside rather than left in the
   * shell.
   *
   * A `<deck-stage>` deck carries a script that turns its slides into a
   * presentation: one slide on screen at a time, a thumbnail rail, arrow-key
   * paging. That behaviour belongs to the exported file — it is what the deck
   * looked like before it was ever imported — but not to the editor, which
   * lays the slides out in flow and has a thumbnail pane of its own. So it is
   * lifted out on import and put back only when composing an export.
   */
  deckRuntime?: string;
}

export const DEFAULT_DESIGN_WIDTH = 1280;
export const DEFAULT_DESIGN_HEIGHT = 720;

/** Marker comment occupying the slide's position inside {@link SharedResources.slideShell}. */
export const SLIDE_SLOT = 'HSE_SLIDE_SLOT';

export interface Slide {
  id: string;
  /** One slide's markup, including its own outermost element. */
  html: string;
}

export interface Project {
  version: number;
  meta: ProjectMeta;
  shared: SharedResources;
  slides: Slide[];
  /** Asset file names; the bytes live in the Rust side's asset store. */
  assets: string[];
}

export function emptyShared(): SharedResources {
  return {
    htmlAttrs: '',
    headHtml: '',
    bodyAttrs: '',
    slideShell: `<!--${SLIDE_SLOT}-->`,
    framework: 'empty',
    stageClasses: [],
    designWidth: DEFAULT_DESIGN_WIDTH,
    designHeight: DEFAULT_DESIGN_HEIGHT,
  };
}

export function emptyProject(title = 'Untitled'): Project {
  const now = new Date().toISOString();
  return {
    version: PROJECT_VERSION,
    meta: { title, createdAt: now, updatedAt: now },
    shared: emptyShared(),
    slides: [],
    assets: [],
  };
}
