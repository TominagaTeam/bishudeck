import { DECK_STAGE_IMPORT } from '../artifact';
import type { DetectionResult, SlideDetector } from '../types';
import { t } from '../../shared/i18n';

/**
 * Claude Artifacts の deck-stage デッキ.
 *
 * `<deck-stage>` is a web component: its slides are its direct children, and it
 * absolutely positions and scales them at runtime. The editor never runs that
 * script (AD-2), and {@link unwrapArtifact} drops it, so the geometry it would
 * have applied is handed back as {@link DetectionResult.runtimeCss} — mirroring
 * the component's own `::slotted(*)` rule, which is the authored slides' only
 * source of size and of a positioned containing block.
 *
 * The component is also matched in its unflattened `<x-import>` form, so an
 * artifact that was never bundled splits the same way.
 */
const STAGE_SELECTOR = `deck-stage, ${DECK_STAGE_IMPORT}`;

/** The design size `<deck-stage>` uses when the markup states none. */
const DEFAULT_STAGE_WIDTH = 1920;
const DEFAULT_STAGE_HEIGHT = 1080;

const NON_SLIDE_TAGS = ['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'];

export const deckStageDetector: SlideDetector = {
  id: 'deck-stage',
  detect(doc) {
    const stage = doc.querySelector(STAGE_SELECTOR);
    if (!stage) return null;

    const slides = Array.from(stage.children).filter((el) => !NON_SLIDE_TAGS.includes(el.tagName));
    if (slides.length === 0) return null;

    const width = stageSize(stage.getAttribute('width'), DEFAULT_STAGE_WIDTH);
    const height = stageSize(stage.getAttribute('height'), DEFAULT_STAGE_HEIGHT);

    return {
      framework: 'deck-stage',
      description: t('import.detector.deckStage'),
      confidence: 0.97,
      slides,
      designWidth: width,
      designHeight: height,
      runtimeCss: stageCss(width, height),
    };
  },
};

function stageSize(value: string | null, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Slides are laid out in flow rather than stacked, unlike the component, which
 * shows one at a time and hides the rest. A stack needs a script to decide
 * which slide is on top; in flow, a document holding one slide renders that
 * slide and an export holding all of them reads top to bottom.
 */
function stageCss(width: number, height: number): string {
  const stage = STAGE_SELECTOR.split(', ');
  return [
    'body{margin:0}',
    `${stage.join(',')}{display:block;background:#fff}`,
    `${stage.map((s) => `${s}>*`).join(',')}{position:relative;` +
      `width:${width}px;height:${height}px;box-sizing:border-box;overflow:hidden}`,
  ].join('\n');
}
