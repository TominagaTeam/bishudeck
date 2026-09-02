/**
 * Slide boundary detection.
 *
 * AI-generated decks come in a handful of recognizable shapes. Each detector
 * claims the ones it understands; the pipeline takes the most confident answer
 * and shows it to the user for confirmation, because a wrong split is the one
 * import failure that is expensive to undo by hand.
 */

export interface DetectionResult {
  /** Stable identifier of the detector that produced this, e.g. `reveal`. */
  framework: string;
  /** Human-readable description shown in the import confirmation UI. */
  description: string;
  /** 0..1. The pipeline sorts candidates by this and preselects the highest. */
  confidence: number;
  /** The elements that each become one slide, in document order. */
  slides: Element[];
  /**
   * The stage size the deck states in its own markup, for the few formats that
   * state one. Most do not, which is why {@link SharedResources} otherwise
   * starts at a 16:9 default the user can correct in the inspector.
   */
  designWidth?: number;
  designHeight?: number;
  /**
   * CSS a deck's own runtime would have applied at render time, for decks whose
   * layout lives in a script the editor does not run. It is added to the
   * shared head ahead of the deck's own styles — never to slide markup — so the
   * authored CSS still wins and the slides round-trip untouched.
   */
  runtimeCss?: string;
}

export interface SlideDetector {
  readonly id: string;
  detect(doc: Document): DetectionResult | null;
}
