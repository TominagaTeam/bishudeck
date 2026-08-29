import { describe, expect, it } from 'vitest';

import { buildProject } from '../../import/pipeline';
import { composeDocument, composeSlideDocument } from './compose';

/**
 * Previewing one slide of a *scripted* deck.
 *
 * The deck's own script decides what a slide does, and plenty of decks decide
 * it from the slide index — this one starts an animation only on slide 3. A
 * slide rendered on its own is index 0 to that script, so the preview
 * reproduces the deck's shape and lets the deck navigate itself.
 */
const SCRIPTED_DECK = `<!doctype html>
<html>
  <head><style>.slide{opacity:0}.slide.is-active{opacity:1}</style></head>
  <body>
    <div class="deck">
      <section class="slide is-active" data-cost="1"><h1>1</h1></section>
      <section class="slide" data-cost="2"><h1>2</h1></section>
      <section class="slide" data-cost="3"><h1>3</h1></section>
    </div>
    <script>
      var slides = document.querySelectorAll('.slide');
      addEventListener('keydown', () => {});
    </script>
  </body>
</html>`;

const PLAIN_DECK = `<!doctype html>
<html>
  <head><style>.slide{color:red}</style></head>
  <body>
    <section class="slide"><h1>1</h1></section>
    <section class="slide"><h1>2</h1></section>
  </body>
</html>`;

function project(html: string) {
  return buildProject(html, 'generic');
}

function previewSlide(html: string, index: number) {
  const built = project(html);
  return composeSlideDocument(built.shared, built.slides[index], {
    mode: 'preview',
    deckPosition: { index, total: built.slides.length },
  });
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** A deck whose slides are presented by a component, not by the page. */
const STAGE_DECK = `<!doctype html>
<html>
  <head><style>.title{color:red}</style></head>
  <body>
    <deck-stage width="1600" height="900">
      <section><h1 class="title">1</h1></section>
      <section><h1>2</h1></section>
    </deck-stage>
    <script>/* <\\/script> in a comment */customElements.define('deck-stage', class extends HTMLElement {});</script>
  </body>
</html>`;

describe("the deck's own presentation runtime", () => {
  it('goes back into an export, so the file opens the way it arrived', () => {
    const built = buildProject(STAGE_DECK, 'deck-stage');
    const doc = parse(composeDocument(built.shared, built.slides, { mode: 'export' }));

    expect(doc.querySelector('script')?.textContent).toContain(
      "customElements.define('deck-stage'",
    );
    // Until the element is defined the importer's flow layout is in charge,
    // and a big deck would paint every slide before collapsing to one.
    expect(doc.head.textContent).toContain('deck-stage:not(:defined)');
  });

  it('survives being written out and read back', () => {
    const built = buildProject(STAGE_DECK, 'deck-stage');
    const exported = composeDocument(built.shared, built.slides, { mode: 'export' });
    const reimported = buildProject(exported, 'deck-stage');

    expect(reimported.slides).toHaveLength(2);
    expect(reimported.shared.deckRuntime).toContain("customElements.define('deck-stage'");
    expect(reimported.shared.slideShell).not.toContain('customElements.define');
  });

  it('stays out of the editor, where the workspace presents the deck', () => {
    const built = buildProject(STAGE_DECK, 'deck-stage');

    for (const mode of ['edit', 'preview'] as const) {
      const doc = parse(composeSlideDocument(built.shared, built.slides[0], { mode }));
      expect(doc.body.textContent).not.toContain('customElements.define');
    }
  });
});

describe('composeDocument deck position', () => {
  it('stands the slide at its real index among placeholders', () => {
    const doc = parse(previewSlide(SCRIPTED_DECK, 2));
    const slides = Array.from(doc.querySelectorAll('.slide'));

    expect(slides).toHaveLength(3);
    expect(slides.findIndex((el) => el.hasAttribute('data-hse-preview-target'))).toBe(2);
    expect(doc.querySelectorAll('[data-hse-placeholder]')).toHaveLength(2);
    expect(doc.querySelector('[data-hse-preview-target]')!.textContent).toContain('3');
  });

  it('keeps placeholders empty, hidden and free of the slide identity', () => {
    const doc = parse(previewSlide(SCRIPTED_DECK, 2));
    const stub = doc.querySelector('[data-hse-placeholder]') as HTMLElement;

    expect(stub.tagName).toBe('SECTION');
    expect(stub.className).toContain('slide');
    expect(stub.getAttribute('style')).toContain('display:none');
    expect(stub.getAttribute('aria-hidden')).toBe('true');
    expect(stub.children).toHaveLength(0);
    expect(stub.hasAttribute('id')).toBe(false);
  });

  it('asks the deck to advance exactly as many times as the index', () => {
    const script = parse(previewSlide(SCRIPTED_DECK, 2)).body.lastElementChild!;
    expect(script.tagName).toBe('SCRIPT');
    expect(script.textContent).toContain('i < 2');
    // One bubbling event per step: dispatching on window as well would move the
    // deck twice.
    expect(script.textContent).toContain('document.dispatchEvent');
    expect(script.textContent).not.toContain('window.dispatchEvent');
  });

  it('leaves a deck without scripts exactly as it was', () => {
    const built = project(PLAIN_DECK);
    const scaffolded = composeSlideDocument(built.shared, built.slides[1], {
      mode: 'preview',
      deckPosition: { index: 1, total: 2 },
    });
    const plain = composeSlideDocument(built.shared, built.slides[1], { mode: 'preview' });

    expect(scaffolded).toBe(plain);
    expect(scaffolded).not.toContain('data-hse-placeholder');
  });

  it('never scaffolds the edit stage or an export', () => {
    const built = project(SCRIPTED_DECK);
    const edit = composeSlideDocument(built.shared, built.slides[2], {
      mode: 'edit',
      deckPosition: { index: 2, total: 3 },
    });
    const exported = composeDocument(built.shared, built.slides, {
      mode: 'export',
      deckPosition: { index: 2, total: 3 },
    });

    expect(edit).not.toContain('data-hse-placeholder');
    expect(edit).not.toContain('data-hse-preview-target');
    expect(exported).not.toContain('data-hse-placeholder');
  });

  it('does not scaffold the first slide of a single-slide deck', () => {
    const built = project(SCRIPTED_DECK);
    const only = composeSlideDocument(built.shared, built.slides[0], {
      mode: 'preview',
      deckPosition: { index: 0, total: 1 },
    });

    expect(only).not.toContain('data-hse-placeholder');
  });
});

/**
 * Pointing a document at the typefaces the app ships with.
 *
 * The stage draws slides in a face the machine may not have, which is only
 * honest because the app supplies it — over `slides://`, the one origin all
 * three documents can read (shared/bundledFonts.ts). An export gets none of
 * it: that file is read where this app is not, and a link into a scheme only
 * this app serves would be a dead reference in someone else's browser.
 */
describe('bundled fonts', () => {
  const BASE = 'slides://localhost';

  function headOf(mode: 'edit' | 'preview' | 'export', baseUrl: string | undefined) {
    const built = project(PLAIN_DECK);
    return parse(composeSlideDocument(built.shared, built.slides[0], { mode, baseUrl })).head;
  }

  it('points the edit stage and the preview at the same stylesheet', () => {
    for (const mode of ['edit', 'preview'] as const) {
      const link = headOf(mode, BASE).querySelector('link[rel="stylesheet"]');
      expect(link?.getAttribute('href'), mode).toBe('slides://localhost/fonts/fonts.css');
    }
  });

  it('leaves an exported file pointing at nothing this app has to be running for', () => {
    expect(headOf('export', BASE).querySelector('link[rel="stylesheet"]')).toBeNull();
  });

  it('says nothing when there is no origin to say it about', () => {
    // `npm run dev` in a plain browser: no `slides://`, so no stylesheet to
    // name. Slides draw in whatever the system has, as they did before.
    expect(headOf('edit', undefined).querySelector('link[rel="stylesheet"]')).toBeNull();
  });

  it('declares the faces ahead of the deck, so a deck’s own @font-face wins', () => {
    // Later declarations take precedence, and a deck that ships its own
    // webfont under one of these names is not ours to overrule.
    const head = headOf('edit', BASE);
    const children = Array.from(head.children);
    const link = children.findIndex((el) => el.tagName === 'LINK');
    const deckStyle = children.findIndex((el) => el.tagName === 'STYLE');
    expect(link).toBeGreaterThanOrEqual(0);
    expect(link).toBeLessThan(deckStyle);
  });

  it('marks the link as the editor’s own, so a round trip cannot stack them', () => {
    const link = headOf('edit', BASE).querySelector('link[rel="stylesheet"]');
    expect(link?.getAttribute('data-hse-injected')).toBe('bundled-fonts');
  });
});
