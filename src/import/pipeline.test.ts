import { describe, expect, it } from 'vitest';

import { composeDocument, composeSlideDocument, fillShell } from '../core/document/compose';
import { SLIDE_SLOT } from '../core/document/model';
import { analyzeHtml, buildProject } from './pipeline';

const GENERIC_DECK = `<!doctype html>
<html lang="ja">
  <head>
    <title>四半期レビュー</title>
    <style>.slide { width: 1280px; }</style>
  </head>
  <body class="deck" data-theme="light">
    <header class="brand">ACME</header>
    <section class="slide"><h1>タイトル</h1></section>
    <section class="slide"><h2>ハイライト</h2><p>本文</p></section>
    <section class="slide"><h2>まとめ</h2></section>
    <script>console.log('deck');</script>
  </body>
</html>`;

const REVEAL_DECK = `<!doctype html>
<html>
  <head><link rel="stylesheet" href="https://cdn.example/reveal.css" /></head>
  <body>
    <div class="reveal">
      <div class="slides">
        <section><h1>A</h1></section>
        <section><h1>B</h1></section>
      </div>
    </div>
    <script src="https://cdn.example/reveal.js"></script>
  </body>
</html>`;

describe('detection', () => {
  it('splits a plain section deck and reports the title', () => {
    const analysis = analyzeHtml(GENERIC_DECK);
    expect(analysis.title).toBe('四半期レビュー');
    expect(analysis.best?.detectorId).toBe('generic');
    expect(analysis.best?.slideCount).toBe(3);
  });

  it('prefers reveal.js over the generic pattern when both match', () => {
    const analysis = analyzeHtml(REVEAL_DECK);
    expect(analysis.best?.detectorId).toBe('reveal');
    expect(analysis.best?.slideCount).toBe(2);
  });

  it('offers alternatives so a wrong guess can be overridden', () => {
    const analysis = analyzeHtml(GENERIC_DECK);
    expect(analysis.candidates.length).toBeGreaterThan(1);
  });
});

describe('project construction', () => {
  it('keeps head, body attributes and non-slide siblings out of the slides', () => {
    const project = buildProject(GENERIC_DECK, 'generic');

    expect(project.slides).toHaveLength(3);
    expect(project.slides[0].html).toContain('<h1>タイトル</h1>');
    expect(project.slides[0].html).not.toContain('ACME');

    expect(project.shared.headHtml).toContain('width: 1280px');
    expect(project.shared.bodyAttrs).toContain('class="deck"');
    expect(project.shared.bodyAttrs).toContain('data-theme="light"');

    // Sibling furniture and the deck's script stay in the shell.
    expect(project.shared.slideShell).toContain('ACME');
    expect(project.shared.slideShell).toContain("console.log('deck')");
    expect(project.shared.slideShell).toContain(SLIDE_SLOT);
  });

  it('preserves the reveal.js wrapper chain around each slide', () => {
    const project = buildProject(REVEAL_DECK, 'reveal');
    const rendered = fillShell(project.shared.slideShell, project.slides[1].html);

    expect(rendered).toContain('class="reveal"');
    expect(rendered).toContain('class="slides"');
    expect(rendered.indexOf('class="slides"')).toBeLessThan(rendered.indexOf('<h1>B</h1>'));
  });

  it('does not leave a second slide behind in the shell', () => {
    const project = buildProject(GENERIC_DECK, 'generic');
    expect(project.shared.slideShell).not.toContain('ハイライト');
    expect(project.shared.slideShell).not.toContain('まとめ');
  });
});

/**
 * A Claude Artifacts deck after {@link unwrapArtifact}: slides are the children
 * of `<deck-stage>`, which states the design size and, at runtime, would have
 * been the only thing giving them a size and a positioned containing block.
 */
const DECK_STAGE_DECK = `<!doctype html>
<html>
  <head><style>.title{font-size:76px}</style></head>
  <body>
    <deck-stage width="1600" height="900">
      <section data-label="\u8868\u7d19" style="background:#fff"><h1 class="title">A</h1></section>
      <section data-label="\u307e\u3068\u3081"><h1>B</h1></section>
    </deck-stage>
    <script>customElements.define('deck-stage', class extends HTMLElement {});</script>
  </body>
</html>`;

describe('deck-stage decks', () => {
  it('splits on the component children and beats the generic pattern', () => {
    const analysis = analyzeHtml(DECK_STAGE_DECK);

    expect(analysis.best?.detectorId).toBe('deck-stage');
    expect(analysis.best?.slideCount).toBe(2);
  });

  it("holds the component's own script aside instead of leaving it in the shell", () => {
    const project = buildProject(DECK_STAGE_DECK, 'deck-stage');

    // In the shell it would run in preview and draw a second thumbnail rail
    // over the editor's own; held aside, only an export puts it back.
    expect(project.shared.slideShell).not.toContain('customElements.define');
    expect(project.shared.deckRuntime).toContain("customElements.define('deck-stage'");
  });

  it('takes the design size from the component instead of the 16:9 default', () => {
    const project = buildProject(DECK_STAGE_DECK, 'deck-stage');

    expect(project.shared.designWidth).toBe(1600);
    expect(project.shared.designHeight).toBe(900);
  });

  it('supplies the geometry the component would have applied', () => {
    const project = buildProject(DECK_STAGE_DECK, 'deck-stage');
    const html = composeSlideDocument(project.shared, project.slides[0], { mode: 'edit' });

    expect(html).toContain('width:1600px;height:900px');
    // Ahead of the deck's own styles, so authored CSS still wins.
    expect(html.indexOf('deck-stage')).toBeLessThan(html.indexOf('.title{font-size:76px}'));
    // Scaffolding belongs to the shared head, never to the slide.
    expect(project.slides[0].html).not.toContain('deck-stage');
  });

  it('stacks every slide in one stage on export', () => {
    const project = buildProject(DECK_STAGE_DECK, 'deck-stage');
    const html = composeDocument(project.shared, project.slides, { mode: 'export' });

    // One stage holding both slides. The component decides which of them is on
    // screen when it is there; the stage CSS lays them out in flow when it is not.
    expect(html.match(/<deck-stage/g)).toHaveLength(1);
    expect(html.match(/<section/g)).toHaveLength(2);
    expect(html.indexOf('<h1 class="title">A</h1>')).toBeLessThan(html.indexOf('<h1>B</h1>'));
  });

  it('keeps the stage wrapper around each rendered slide', () => {
    const project = buildProject(DECK_STAGE_DECK, 'deck-stage');
    const rendered = fillShell(project.shared.slideShell, project.slides[1].html);

    expect(rendered).toContain('<deck-stage width="1600" height="900">');
    expect(rendered).toContain('<h1>B</h1>');
    expect(rendered).not.toContain('<h1>A</h1>');
  });
});

/**
 * The shape of decks that hide every slide and reveal only the active one.
 * Rendering a slide on its own has to restore that state or the stage is blank.
 */
const ACTIVE_CLASS_DECK = `<!doctype html>
<html>
  <head><style>.slide{opacity:0;visibility:hidden}.slide.is-active{opacity:1;visibility:visible}</style></head>
  <body>
    <div class="deck" id="deck">
      <section class="slide is-active" data-cost="1"><h1>A</h1></section>
      <section class="slide" data-cost="2"><h1>B</h1></section>
      <section class="slide" data-cost="4"><h1>C</h1></section>
    </div>
    <div class="hud">HUD</div>
  </body>
</html>`;

describe('active-slide decks', () => {
  it('detects the class the deck uses to mark the visible slide', () => {
    const project = buildProject(ACTIVE_CLASS_DECK, 'generic');
    expect(project.shared.stageClasses).toEqual(['is-active']);
  });

  it('does not record classes that every slide carries', () => {
    const project = buildProject(GENERIC_DECK, 'generic');
    expect(project.shared.stageClasses).toEqual([]);
  });

  it('applies the class when a slide is rendered on the stage', () => {
    const project = buildProject(ACTIVE_CLASS_DECK, 'generic');
    const html = composeSlideDocument(project.shared, project.slides[1], { mode: 'edit' });

    expect(html).toContain('<h1>B</h1>');
    expect(html).toMatch(/class="slide is-active"[^>]*data-cost="2"/);
  });

  it('keeps the authored markup free of the added class', () => {
    const project = buildProject(ACTIVE_CLASS_DECK, 'generic');
    expect(project.slides[1].html).toContain('class="slide"');
    expect(project.slides[1].html).not.toContain('is-active');
    // The slide that was active in the source keeps its own class.
    expect(project.slides[0].html).toContain('is-active');
  });

  it('leaves the deck to decide the active slide on export', () => {
    const project = buildProject(ACTIVE_CLASS_DECK, 'generic');
    const html = composeDocument(project.shared, project.slides, { mode: 'export' });
    // Exactly the one slide the source marked, not every slide.
    expect(html.match(/class="slide is-active"/g)).toHaveLength(1);
    expect(html).toMatch(/class="slide is-active"[^>]*data-cost="1"/);
  });
});

describe('composition', () => {
  it('rebuilds the original body structure on export', () => {
    const project = buildProject(ACTIVE_CLASS_DECK, 'generic');
    const html = composeDocument(project.shared, project.slides, { mode: 'export' });

    // One `.deck` holding all three slides, not one copy of the shell each.
    expect(html.match(/class="deck"/g)).toHaveLength(1);
    expect(html.match(/class="hud"/g)).toHaveLength(1);
    expect(html.indexOf('<h1>A</h1>')).toBeLessThan(html.indexOf('<h1>C</h1>'));
    expect(html.indexOf('<h1>C</h1>')).toBeLessThan(html.indexOf('HUD'));
  });

  it('reproduces styles and scripts in preview mode', () => {
    const project = buildProject(GENERIC_DECK, 'generic');
    const html = composeSlideDocument(project.shared, project.slides[0], { mode: 'preview' });

    expect(html).toContain('width: 1280px');
    expect(html).toContain("console.log('deck')");
    expect(html).toContain('<h1>タイトル</h1>');
    expect(html).toContain('class="deck"');
  });

  it('keeps CSS but disables every script in edit mode', () => {
    const project = buildProject(GENERIC_DECK, 'generic');
    const html = composeSlideDocument(project.shared, project.slides[0], { mode: 'edit' });

    expect(html).toContain('width: 1280px');
    expect(html).toContain('type="application/hse-disabled"');
    expect(html).not.toMatch(/<script(?![^>]*hse-disabled)/);
  });

  it('marks slide roots only in edit mode, so exports stay clean', () => {
    const project = buildProject(GENERIC_DECK, 'generic');
    const edit = composeSlideDocument(project.shared, project.slides[0], { mode: 'edit' });
    const exported = composeSlideDocument(project.shared, project.slides[0], { mode: 'export' });

    expect(edit).toContain('data-hse-slide-root');
    expect(exported).not.toContain('data-hse-slide-root');
  });

  it('points relative asset references at the slides origin', () => {
    const project = buildProject(GENERIC_DECK, 'generic');
    const html = composeSlideDocument(project.shared, project.slides[0], {
      mode: 'preview',
      baseUrl: 'slides://localhost',
    });

    expect(html).toContain('<base href="slides://localhost/">');
  });
});
