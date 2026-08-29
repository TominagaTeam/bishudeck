import type { DetectionResult, SlideDetector } from '../types';
import { t } from '../../shared/i18n';

/**
 * Class and tag patterns that AI-generated decks land on, most specific first.
 * A more specific hit is also a more confident one.
 */
const PATTERNS: { selector: string; description: string; confidence: number }[] = [
  { selector: 'section.slide', description: '<section class="slide">', confidence: 0.95 },
  { selector: 'div.slide', description: '<div class="slide">', confidence: 0.92 },
  { selector: '[class*="slide"]', description: t('import.detector.classSlide'), confidence: 0.8 },
  { selector: '.page', description: 'class="page"', confidence: 0.8 },
  { selector: '[data-slide]', description: t('import.detector.dataSlide'), confidence: 0.85 },
  { selector: 'section', description: t('import.detector.section'), confidence: 0.75 },
  { selector: 'article', description: t('import.detector.article'), confidence: 0.6 },
];

/**
 * Looks for repeated sibling elements matching a known slide pattern. Grouping
 * by parent matters: matches scattered across the document are page furniture,
 * whereas a run of siblings under one parent is a deck.
 */
export const genericPatternDetector: SlideDetector = {
  id: 'generic',
  detect(doc) {
    let best: DetectionResult | null = null;

    for (const pattern of PATTERNS) {
      const matches = Array.from(doc.body.querySelectorAll(pattern.selector));
      if (matches.length < 2) continue;

      const group = largestSiblingGroup(matches);
      if (group.length < 2) continue;

      // Nested matches would make one slide contain another; keep the outermost.
      const outermost = group.filter((el) => !group.some((other) => other !== el && other.contains(el)));
      if (outermost.length < 2) continue;

      const candidate: DetectionResult = {
        framework: `generic:${pattern.selector}`,
        description: pattern.description,
        confidence: pattern.confidence,
        slides: outermost,
      };
      if (!best || candidate.confidence > best.confidence) best = candidate;
    }

    return best;
  },
};

/**
 * Decks built as a stack of full-viewport blocks. Detected from markup alone,
 * so it only sees sizing that is declared inline or through obvious class names.
 */
export const fullpageDetector: SlideDetector = {
  id: 'fullpage',
  detect(doc) {
    const containers = new Set<Element>([doc.body]);
    for (const child of Array.from(doc.body.children)) containers.add(child);

    for (const container of containers) {
      const children = Array.from(container.children).filter(
        (el) => !['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(el.tagName),
      );
      if (children.length < 2) continue;
      if (!children.every(isFullViewportBlock)) continue;

      return {
        framework: 'fullpage',
        description: t('import.detector.fullHeight'),
        confidence: 0.7,
        slides: children,
      };
    }
    return null;
  },
};

/** Last resort: the document is one slide. Always matches, always lowest priority. */
export const singlePageDetector: SlideDetector = {
  id: 'single',
  detect(doc) {
    const content = Array.from(doc.body.children).filter(
      (el) => !['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(el.tagName),
    );
    if (content.length === 0) return null;
    return {
      framework: 'single',
      description: t('import.detector.single'),
      confidence: 0.3,
      // Wrapping in the body's own children keeps the markup intact; the shell
      // ends up empty and the slide carries everything.
      slides: content.length === 1 ? content : [doc.body],
    };
  },
};

function largestSiblingGroup(elements: Element[]): Element[] {
  const byParent = new Map<Element, Element[]>();
  for (const element of elements) {
    const parent = element.parentElement;
    if (!parent) continue;
    const group = byParent.get(parent);
    if (group) group.push(element);
    else byParent.set(parent, [element]);
  }

  let largest: Element[] = [];
  for (const group of byParent.values()) {
    if (group.length > largest.length) largest = group;
  }
  return largest;
}

function isFullViewportBlock(element: Element): boolean {
  const style = element.getAttribute('style') ?? '';
  if (/height\s*:\s*(100vh|100%|100dvh)/i.test(style)) return true;
  const className = typeof element.className === 'string' ? element.className : '';
  return /\b(h-screen|min-h-screen|fullscreen|full-page|vh-100)\b/.test(className);
}
