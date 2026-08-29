import type { DetectionResult, SlideDetector } from '../types';
import { t } from '../../shared/i18n';

/**
 * reveal.js. Vertical stacks are flattened: a `<section>` that only contains
 * other sections is a grouping construct, not a slide of its own.
 */
export const revealDetector: SlideDetector = {
  id: 'reveal',
  detect(doc) {
    const container = doc.querySelector('.reveal .slides');
    if (!container) return null;

    const slides: Element[] = [];
    for (const section of Array.from(container.children)) {
      if (section.tagName !== 'SECTION') continue;
      const nested = Array.from(section.children).filter((c) => c.tagName === 'SECTION');
      if (nested.length > 0 && nested.length === section.children.length) {
        slides.push(...nested);
      } else {
        slides.push(section);
      }
    }
    if (slides.length === 0) return null;

    return result('reveal', 'reveal.js', 0.98, slides);
  },
};

export const impressDetector: SlideDetector = {
  id: 'impress',
  detect(doc) {
    const steps = Array.from(doc.querySelectorAll('#impress .step, .impress-enabled .step'));
    return steps.length > 0 ? result('impress', 'impress.js', 0.95, steps) : null;
  },
};

export const swiperDetector: SlideDetector = {
  id: 'swiper',
  detect(doc) {
    const slides = Array.from(doc.querySelectorAll('.swiper-wrapper > .swiper-slide'));
    return slides.length > 0 ? result('swiper', t('import.detector.swiper'), 0.9, slides) : null;
  },
};

function result(
  framework: string,
  description: string,
  confidence: number,
  slides: Element[],
): DetectionResult {
  return { framework, description, confidence, slides };
}
