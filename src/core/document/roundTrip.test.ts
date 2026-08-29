import { describe, expect, it } from 'vitest';

import { buildProject } from '../../import/pipeline';
import { composeDocument, INJECTED_ATTRIBUTE } from './compose';

/**
 * Opening a deck and saving it must not change it a second time.
 *
 * Saving *is* exporting here (§7.4), so a deck is imported and exported once
 * per working session — and anything the editor adds to the shared head
 * without taking the previous copy out would grow by one on every one of them.
 * The check is a fixed point: export, read that back, export again, and the
 * two have to be the same bytes.
 */
function cycle(html: string, detectorId: string): string {
  const project = buildProject(html, detectorId);
  return composeDocument(project.shared, project.slides, { mode: 'export' });
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** A deck whose slides only have a size because a component gives them one. */
const STAGE_DECK = `<!doctype html>
<html>
  <head><style>.title{color:red}</style></head>
  <body>
    <deck-stage width="1600" height="900">
      <section><h1 class="title">A</h1></section>
      <section><h1>B</h1></section>
    </deck-stage>
  </body>
</html>`;

/** The same deck, still carrying the component that presents it. */
const STAGE_DECK_WITH_RUNTIME = STAGE_DECK.replace(
  '</deck-stage>',
  `</deck-stage>
    <script>customElements.define('deck-stage', class extends HTMLElement {});</script>`,
);

/** An ordinary deck: nothing about it needs the editor to supply anything. */
const PLAIN_DECK = `<!doctype html>
<html>
  <head><style>.slide{color:red}</style></head>
  <body>
    <section class="slide is-active"><h1>1</h1></section>
    <section class="slide"><h1>2</h1></section>
  </body>
</html>`;

const DECKS: [name: string, html: string, detectorId: string][] = [
  ['a deck-stage deck', STAGE_DECK, 'deck-stage'],
  ['a deck-stage deck that kept its runtime', STAGE_DECK_WITH_RUNTIME, 'deck-stage'],
  ['a plain deck', PLAIN_DECK, 'generic'],
];

describe('opening and saving repeatedly', () => {
  for (const [name, html, detectorId] of DECKS) {
    it(`settles after the first export for ${name}`, () => {
      const first = cycle(html, detectorId);
      const second = cycle(first, detectorId);
      const third = cycle(second, detectorId);

      expect(second).toBe(first);
      expect(third).toBe(first);
    });
  }

  it('carries exactly one copy of each thing the editor injects', () => {
    let html = cycle(STAGE_DECK_WITH_RUNTIME, 'deck-stage');
    for (let i = 0; i < 4; i += 1) html = cycle(html, 'deck-stage');

    const injected = Array.from(parse(html).querySelectorAll(`[${INJECTED_ATTRIBUTE}]`));
    expect(injected.map((el) => el.getAttribute(INJECTED_ATTRIBUTE)).sort()).toEqual([
      'deck-guard',
      'stage-css',
    ]);
    // The deck's own script is put back once, not once per save.
    expect(html.match(/customElements\.define/g)).toHaveLength(1);
  });

  it('takes over scaffolding written before it was marked', () => {
    // What the editor used to write: the same CSS, with nothing saying it was
    // the editor that wrote it.
    const legacy = STAGE_DECK.replace(
      '<head>',
      '<head><style>\nbody{margin:0}\n' +
        'deck-stage,x-import[component-from-global-scope="deck-stage"]' +
        '{display:block;background:#fff}\n' +
        'deck-stage>*,x-import[component-from-global-scope="deck-stage"]>*' +
        '{position:relative;width:1600px;height:900px;box-sizing:border-box;overflow:hidden}\n</style>',
    );
    const doc = parse(cycle(legacy, 'deck-stage'));
    const styles = Array.from(doc.querySelectorAll('style'));

    expect(styles.filter((el) => el.textContent?.includes('deck-stage>*'))).toHaveLength(1);
    expect(styles.filter((el) => el.hasAttribute(INJECTED_ATTRIBUTE))).toHaveLength(1);
    // The author's own styles are not what this is looking for.
    expect(doc.head.textContent).toContain('.title{color:red}');
  });

  it('drops what the editor marked whatever tag it wore', () => {
    // The mark used to be looked for on `<style>` alone, which was every tag
    // the editor had ever injected. The stage now points documents at the
    // bundled typefaces with a `<link>` — never in an export, but a file that
    // reached one by some other route would otherwise carry it forever, into
    // browsers where `slides://` resolves to nothing.
    const carried = PLAIN_DECK.replace(
      '<head>',
      `<head><link ${INJECTED_ATTRIBUTE}="bundled-fonts" rel="stylesheet" href="slides://localhost/fonts/fonts.css">`,
    );
    const doc = parse(cycle(carried, 'generic'));

    expect(doc.querySelectorAll('link')).toHaveLength(0);
    expect(doc.head.textContent).toContain('.slide{color:red}');
  });

  it('leaves no editor annotation on the slides themselves', () => {
    const html = cycle(PLAIN_DECK, 'generic');

    // A uid or a stage class changes which selectors match, so those stay
    // strictly out no matter what the shared head is allowed to carry.
    expect(html).not.toContain('data-hse-uid');
    expect(html).not.toContain('data-hse-slide-root');
    expect(html).not.toContain('contenteditable');
    expect(parse(html).querySelectorAll('.is-active')).toHaveLength(1);
  });
});
