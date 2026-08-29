import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearHistory, setActiveStage, undo } from '../commands/engine';
import { composeSlideDocument } from '../document/compose';
import { useDocumentStore } from '../document/store';
import { buildProject } from '../../import/pipeline';
import { StageBridge } from '../../stage/bridge';
import {
  alignElement,
  boxGrowthStyle,
  carryAlignmentIntoLists,
  chosenAlign,
  fitListsIntoBox,
  listAlignmentStyle,
  listFitStyle,
  listsIn,
  listTargets,
  type BoxMetrics,
  type ListMetrics,
} from './listOverrides';

// jsdom ships no CSS.escape; both target WebViews have it.
if (typeof CSS === 'undefined') {
  globalThis.CSS = { escape: (value: string) => value } as never;
}

const DECK = `<!doctype html>
<html>
  <body>
    <section class="slide">
      <h2 class="listed"><ul><li>ひとつめ</li><li>ふたつめ</li></ul></h2>
      <p class="plain">本文</p>
    </section>
  </body>
</html>`;

/** A real iframe: `carryAlignmentIntoLists` reads computed style, which a
 *  parsed document has no view to answer. Same shape as format.test.ts. */
function mountStage() {
  const project = buildProject(DECK, 'generic');
  useDocumentStore.getState().loadProject(project, null);
  clearHistory();

  const html = composeSlideDocument(project.shared, project.slides[0], { mode: 'edit' });
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();

  const bridge = new StageBridge(doc, () => {
    useDocumentStore.getState().setSlideHtml(project.slides[0].id, bridge.serializeSlide());
  });
  setActiveStage(bridge);
  return { bridge, doc };
}

describe('what counts as a chosen alignment', () => {
  it('reads the three the buttons offer', () => {
    expect(chosenAlign('left')).toBe('left');
    expect(chosenAlign('center')).toBe('center');
    expect(chosenAlign('right')).toBe('right');
  });

  // The panel stopped offering 両端 (issues #39), but a deck that justifies its
  // own text still hands `justify` to `carryAlignmentIntoLists`. Reading it as
  // "nobody chose" would leave that deck's bulleted lines unjustified the
  // moment someone touched them.
  it('still reads a deck’s own justify', () => {
    expect(chosenAlign('justify')).toBe('justify');
  });

  // Writing `left` onto every list on every deck the moment someone bullets a
  // line is the failure mode this guards: `start` is the absence of a choice.
  it('treats the untouched value as no choice at all', () => {
    expect(chosenAlign('start')).toBeNull();
    expect(chosenAlign('')).toBeNull();
    expect(chosenAlign('  ')).toBeNull();
  });
});

describe('what a list node is given', () => {
  it('pulls the marker in when the line leaves the left edge', () => {
    expect(listAlignmentStyle('center', 'UL')).toEqual({
      'text-align': 'center',
      'list-style-position': 'inside',
      'padding-left': '0',
    });
    expect(listAlignmentStyle('right', 'OL')['list-style-position']).toBe('inside');
  });

  // Both start their lines at the left edge, where an outside marker belongs.
  // `justify` has no button behind it any more (issues #39) and keeps its road
  // for the deck that brings its own.
  it('hands the marker back for left and a deck’s justify', () => {
    expect(listAlignmentStyle('left', 'UL')).toEqual({
      'text-align': 'left',
      'list-style-position': '',
      'padding-left': '',
    });
    expect(listAlignmentStyle('justify', 'UL')['list-style-position']).toBe('');
  });

  // The indent lives on the list; flattening the item would collapse a nest.
  it('never touches the item’s own indent', () => {
    expect(listAlignmentStyle('center', 'LI')).not.toHaveProperty('padding-left');
    expect(listAlignmentStyle('center', 'LI')['list-style-position']).toBe('inside');
  });
});

describe('aligning a box that holds a list', () => {
  let bridge: StageBridge;
  let doc: Document;

  beforeEach(() => {
    document.body.innerHTML = '';
    ({ bridge, doc } = mountStage());
  });

  const heading = () => doc.querySelector('h2') as HTMLElement;
  const list = () => doc.querySelector('ul') as HTMLElement;
  const item = () => doc.querySelector('li') as HTMLElement;

  it('reaches the list and the items, not just the box', () => {
    alignElement(bridge.uidOf(heading())!, 'center');

    expect(heading().style.textAlign).toBe('center');
    expect(list().style.textAlign).toBe('center');
    expect(item().style.textAlign).toBe('center');
    expect(list().style.listStylePosition).toBe('inside');
    expect(list().style.paddingLeft).toBe('0px');
    expect(item().style.listStylePosition).toBe('inside');
  });

  it('leaves no residue when the step is taken back', () => {
    alignElement(bridge.uidOf(heading())!, 'center');
    undo();

    expect(heading().getAttribute('style') ?? '').toBe('');
    expect(list().getAttribute('style') ?? '').toBe('');
    expect(item().getAttribute('style') ?? '').toBe('');
  });

  // Undoing has to be one press, or the fix trades a layout bug for a history
  // one (inspector/test.md 7e).
  it('is a single undo step however many nodes it wrote', () => {
    alignElement(bridge.uidOf(heading())!, 'center');
    undo();
    expect(list().style.textAlign).toBe('');
  });

  it('clears the marker override on the way back to left', () => {
    const uid = bridge.uidOf(heading())!;
    alignElement(uid, 'center');
    alignElement(uid, 'left');

    expect(item().style.textAlign).toBe('left');
    expect(list().style.listStylePosition).toBe('');
    expect(list().style.paddingLeft).toBe('');
  });

  it('falls back to a plain element override when there is no list', () => {
    const paragraph = doc.querySelector('p') as HTMLElement;
    alignElement(bridge.uidOf(paragraph)!, 'right');

    expect(paragraph.style.textAlign).toBe('right');
    expect(paragraph.style.listStylePosition).toBe('');
    expect(paragraph.style.paddingLeft).toBe('');
  });
});

describe('a list built inside an already aligned box', () => {
  let doc: Document;

  beforeEach(() => {
    document.body.innerHTML = '';
    ({ doc } = mountStage());
  });

  it('carries the box’s alignment onto the new list', () => {
    const heading = doc.querySelector('h2') as HTMLElement;
    heading.style.textAlign = 'center';

    carryAlignmentIntoLists(heading);

    expect((doc.querySelector('ul') as HTMLElement).style.textAlign).toBe('center');
    expect((doc.querySelector('li') as HTMLElement).style.listStylePosition).toBe('inside');
  });

  it('writes nothing when nobody has aligned the box', () => {
    const heading = doc.querySelector('h2') as HTMLElement;

    carryAlignmentIntoLists(heading);

    expect((doc.querySelector('ul') as HTMLElement).getAttribute('style') ?? '').toBe('');
  });
});

/**
 * The half that is measured rather than declared (issues #31).
 *
 * The blockage is set up here with an inline declaration on the list rather than
 * with a `<style>` rule, because what the probe reads is the *computed* value —
 * where the value came from is exactly what it does not need to know, and jsdom
 * is not a cascade worth testing against. The numbers on the real thing are
 * checked by hand instead (inspector/test.md ケース 58 以降).
 */
describe('an override a list would not otherwise receive', () => {
  let bridge: StageBridge;
  let doc: Document;

  beforeEach(() => {
    document.body.innerHTML = '';
    ({ bridge, doc } = mountStage());
  });

  const heading = () => doc.querySelector('h2') as HTMLElement;
  const list = () => doc.querySelector('ul') as HTMLElement;
  const uid = () => bridge.uidOf(heading())!;

  // The half that keeps the export clean: nothing is in the way, so nothing
  // gets written, and the deck comes back out the way it went in.
  it('leaves the list alone when the declaration already arrives', () => {
    const targets = listTargets(uid(), { color: 'rgb(1, 2, 3)' });

    expect(Object.keys(targets)).toEqual([uid()]);
  });

  it('writes onto the node that is standing in the way', () => {
    list().style.fontSize = '26px';

    const targets = listTargets(uid(), { 'font-size': '60px' });

    expect(targets[bridge.uidOf(list())!]).toEqual({ 'font-size': '60px' });
  });

  // The items were never blocked themselves — they were reading a blocked
  // ancestor. Repairing the list in place, before they are measured, is what
  // keeps one deck rule from costing one override per line.
  it('stops at the node that was blocking, not every node below it', () => {
    list().style.fontSize = '26px';

    const targets = listTargets(uid(), { 'font-size': '60px' });

    expect(targets[bridge.uidOf(doc.querySelector('li')!)!]).toBeUndefined();
  });

  it('still writes the item when the item is the one in the way', () => {
    const item = doc.querySelector('li') as HTMLElement;
    item.style.fontSize = '26px';

    const targets = listTargets(uid(), { 'font-size': '60px' });

    expect(targets[bridge.uidOf(item)!]).toEqual({ 'font-size': '60px' });
    expect(targets[bridge.uidOf(list())!]).toBeUndefined();
  });

  /**
   * Box properties do not inherit, so a `<li>` differing from its box is the
   * normal state of affairs. Reading that as a blockage would paint a
   * background behind every line the brush ever touched.
   */
  it('never pushes down a property that was not inherited to begin with', () => {
    const targets = listTargets(uid(), { 'background-color': 'rgb(1, 2, 3)', padding: '8px' });

    expect(Object.keys(targets)).toEqual([uid()]);
  });

  it('hands the box back exactly as it found it', () => {
    heading().style.fontSize = '40px';
    list().style.fontSize = '26px';

    listTargets(uid(), { 'font-size': '60px' });

    expect(heading().style.fontSize).toBe('40px');
  });

  // One press of the brush carries both kinds at once, and both have to end up
  // in the same record — two records for one uid would lose one of them.
  it('merges what the alignment spreads with what the probe found', () => {
    list().style.fontSize = '26px';

    const targets = listTargets(uid(), { 'text-align': 'center', 'font-size': '60px' });

    expect(targets[bridge.uidOf(list())!]).toMatchObject({
      'text-align': 'center',
      'list-style-position': 'inside',
      'font-size': '60px',
    });
  });

  // Handing back a property is how an override is removed (writeInlineStyle),
  // and there is nothing to push down about "stop overriding this".
  it('has nothing to push down for a cleared property', () => {
    list().style.fontSize = '26px';

    const targets = listTargets(uid(), { 'font-size': '' });

    expect(Object.keys(targets)).toEqual([uid()]);
  });
});

/**
 * The half that is geometry rather than cascade.
 *
 * Every number here came off Chromium — a 520x90 text box at font-size 28px,
 * line-height 1.5, inside the same `sandbox="allow-same-origin"` frame the app
 * runs — because the runner cannot produce them: jsdom answers every rect with
 * 0 and computes no cascade, so a test that measured its own layout would be
 * testing nothing. What is checked here is the decision, with the measurement
 * handed in: for this computed style, which declarations get written.
 */
const MEASURED: ListMetrics = {
  paddingLeft: '40px',
  listStylePosition: 'outside',
  fontSize: '28px',
  marginTop: '0px',
  marginBottom: '0px',
  // A bullet at 28px, measured the way `measureMarkerAdvance` measures one.
  markerAdvance: 26.6,
};

function metrics(overrides: Partial<ListMetrics>): ListMetrics {
  return { ...MEASURED, ...overrides };
}

describe('what a freshly built list is given so it fits its box', () => {
  // The reset every second deck ships — `* { margin: 0; padding: 0 }` — leaves
  // the list no gutter, and an `outside` marker is painted in that gutter. The
  // bullets came out at a negative x: outside the box, over whatever sits left
  // of it.
  it('opens a gutter when the deck’s reset took it away', () => {
    // 26.6px of bullet at 28px text is 0.95em, and 0.3em of breathing room on
    // top. The number moved from a flat 1.2em when the marker stopped being
    // guessed at and started being measured.
    expect(listFitStyle(metrics({ paddingLeft: '0px' }))).toEqual({ 'padding-left': '1.25em' });
  });

  // The UA's own 40px, and the sample deck's 1.2em (31.2px at 28px text), both
  // already hold the marker inside the box. Writing over them would move a deck
  // that was never broken.
  //
  // The test used to be "at least 1em", which was a stand-in for "wide enough".
  // It is now the measured marker plus its breathing room — 1.25em, or 35px at
  // 28px text — so 31.2px no longer counts as enough. That is the point: the
  // deck reporting this had a gutter that cleared its marker by 2.18px, and it
  // read as an overflow.
  it('leaves an indent the deck already chose', () => {
    expect(listFitStyle(metrics({ paddingLeft: '40px' }))).toEqual({});
    expect(listFitStyle(metrics({ paddingLeft: '35px' }))).toEqual({});
  });

  // `inside` puts the marker in the line rather than hanging off it, so there
  // is nothing to make room for. This is also what keeps the fit from fighting
  // `listAlignmentStyle`, which writes `inside` and `padding-left: 0` together
  // for centre and right on purpose — an indent added here would push those
  // lines back off-centre.
  it('adds no gutter for a marker that sits in the line', () => {
    expect(listFitStyle(metrics({ paddingLeft: '0px', listStylePosition: 'inside' }))).toEqual({});
  });

  // The UA gives `<ul>` a `margin-block` of 1em, which at 28px is 56px of the
  // 90px box gone before a word is counted.
  it('flattens the vertical margin the UA hands out', () => {
    expect(listFitStyle(metrics({ marginTop: '28px', marginBottom: '28px' }))).toEqual({
      'margin-top': '0',
      'margin-bottom': '0',
    });
  });

  // One side is enough to make the box short, and no list wants 28px above and
  // nothing below, so both sides go together.
  it('flattens both sides when only one of them is set', () => {
    expect(listFitStyle(metrics({ marginTop: '28px' }))).toEqual({
      'margin-top': '0',
      'margin-bottom': '0',
    });
  });

  // A deck that already zeroed them has answered. Restating it would grow the
  // export with an override that changes nothing.
  it('writes nothing when the deck already zeroed them', () => {
    expect(listFitStyle(MEASURED)).toEqual({});
  });

  it('carries both findings at once, since a deck can produce both', () => {
    expect(
      listFitStyle(metrics({ paddingLeft: '0px', marginTop: '28px', marginBottom: '28px' })),
    ).toEqual({
      'padding-left': '1.25em',
      'margin-top': '0',
      'margin-bottom': '0',
    });
  });

  // The empty string is what an engine that computed nothing hands back, and
  // sizing an override off a measurement that never happened is worse than
  // leaving the list as the deck had it.
  it('treats an unmeasurable value as a reason to stay out', () => {
    expect(listFitStyle({
      paddingLeft: '',
      listStylePosition: '',
      fontSize: '',
      marginTop: '',
      marginBottom: '',
      markerAdvance: null,
    })).toEqual({});
    expect(listFitStyle(metrics({ paddingLeft: '0px', fontSize: 'medium' }))).toEqual({});
  });
});

const BOX: BoxMetrics = {
  offsetHeight: 90,
  clientHeight: 90,
  scrollHeight: 90,
  boxSizing: 'content-box',
  paddingTop: '0px',
  paddingBottom: '0px',
  borderTopWidth: '0px',
  borderBottomWidth: '0px',
};

function box(overrides: Partial<BoxMetrics>): BoxMetrics {
  return { ...BOX, ...overrides };
}

describe('how tall the box has to become', () => {
  // The inserted box is 520x90 with no overflow of its own, and two bulleted
  // lines at 28px/1.5 plus the UA margins came to 154px.
  it('grows to exactly what is hanging out of it', () => {
    expect(boxGrowthStyle(box({ scrollHeight: 154 }))).toEqual({ height: '154px' });
  });

  // A box with no height of its own already grew with its content, so its two
  // measurements agree and nothing is written. That is what keeps this off
  // every self-sizing element on the slide.
  it('leaves a box that already fits alone', () => {
    expect(boxGrowthStyle(BOX)).toEqual({});
    expect(boxGrowthStyle(box({ scrollHeight: 40 }))).toEqual({});
  });

  // One box, padded 8 and bordered 2 on both sides, holding content that needs
  // 138px. Under `border-box` the declaration has to carry those 20px as well,
  // so handing `scrollHeight` (154px, content plus padding) straight over would
  // leave it 4px short and still overflowing.
  it('counts the edges in when height means the border box', () => {
    expect(
      boxGrowthStyle(box({
        boxSizing: 'border-box',
        offsetHeight: 90,
        clientHeight: 86,
        scrollHeight: 154,
        paddingTop: '8px',
        paddingBottom: '8px',
        borderTopWidth: '2px',
        borderBottomWidth: '2px',
      })),
    ).toEqual({ height: '158px' });
  });

  // The same box and the same content under `content-box`, where the
  // declaration means the content alone: 138px, twenty less than above, and
  // sixteen less than the `scrollHeight` a shortcut would have written.
  it('counts the edges out when height means the content box', () => {
    expect(
      boxGrowthStyle(box({
        boxSizing: 'content-box',
        offsetHeight: 110,
        clientHeight: 106,
        scrollHeight: 154,
        paddingTop: '8px',
        paddingBottom: '8px',
        borderTopWidth: '2px',
        borderBottomWidth: '2px',
      })),
    ).toEqual({ height: '138px' });
  });

  // Rounding down leaves the last line a sub-pixel short and the box still
  // overflowing, which is the same bug one pixel smaller.
  it('rounds a fractional layout up', () => {
    expect(boxGrowthStyle(box({ scrollHeight: 153.4 }))).toEqual({ height: '154px' });
  });
});

/**
 * The wiring, with the layout faked.
 *
 * `getComputedStyle` is stubbed rather than set up through a `<style>` rule
 * because jsdom computes no cascade and lays nothing out — there is no
 * arrangement of real CSS that would make it answer with a number. What this
 * still checks is the part the fake cannot hide: which nodes get written to,
 * and in what order the box is measured.
 */
type FakeStyle = Partial<CSSStyleDeclaration>;

const NOT_MEASURED: FakeStyle = {
  paddingLeft: '',
  listStylePosition: '',
  fontSize: '',
  marginTop: '',
  marginBottom: '',
  boxSizing: '',
  paddingTop: '',
  paddingBottom: '',
  borderTopWidth: '',
  borderBottomWidth: '',
};

function stubComputed(view: Window, entries: Array<[Element, FakeStyle]>): void {
  const table = new Map(entries);
  vi.spyOn(view, 'getComputedStyle').mockImplementation(
    (node: Element) =>
      ({ ...NOT_MEASURED, ...(table.get(node) ?? {}) }) as unknown as CSSStyleDeclaration,
  );
}

function stubSize(element: HTMLElement, sizes: Record<string, number>): void {
  for (const [name, value] of Object.entries(sizes)) {
    Object.defineProperty(element, name, { value, configurable: true });
  }
}

describe('fitting the list the button just built', () => {
  let doc: Document;
  let view: Window;

  beforeEach(() => {
    document.body.innerHTML = '';
    ({ doc } = mountStage());
    view = doc.defaultView!;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const heading = () => doc.querySelector('h2') as HTMLElement;
  const deckList = () => doc.querySelector('ul') as HTMLElement;

  /** What `execCommand` leaves behind: a list that was not there before. */
  function buildList(): HTMLElement {
    const list = doc.createElement('ul');
    list.innerHTML = '<li>みっつめ</li>';
    heading().append(list);
    return list;
  }

  it('writes the fit onto the list, and the height onto the box', () => {
    const existing = listsIn(heading());
    const built = buildList();
    stubComputed(view, [
      [built, { paddingLeft: '0px', listStylePosition: 'outside', fontSize: '28px', marginTop: '28px', marginBottom: '28px' }],
      [heading(), { boxSizing: 'border-box', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' }],
    ]);
    stubSize(heading(), { offsetHeight: 90, clientHeight: 90, scrollHeight: 154 });

    fitListsIntoBox(heading(), existing);

    // The fallback: jsdom has no `Range` geometry, so `measureMarkerAdvance`
    // reports "unmeasurable" here and the guess stands in for it. What this
    // pins is the wiring — that the fit reaches the list at all — which is the
    // only half of it the runner can see.
    expect(built.style.paddingLeft).toBe('1.2em');
    expect(built.style.marginTop).toBe('0px');
    expect(built.style.marginBottom).toBe('0px');
    expect(heading().style.height).toBe('154px');
  });

  // The deck's own list was there before the button was pressed, and an indent
  // its author did not choose has no business appearing in it.
  it('never touches a list the deck brought with it', () => {
    const existing = listsIn(heading());
    buildList();
    stubComputed(view, []);
    stubSize(heading(), { offsetHeight: 90, clientHeight: 90, scrollHeight: 90 });

    fitListsIntoBox(heading(), existing);

    expect(deckList().getAttribute('style') ?? '').toBe('');
  });

  // The same button takes a list off again, and the press that removes content
  // must not be the one that grows the box.
  it('does not grow the box when nothing was built', () => {
    stubComputed(view, []);
    stubSize(heading(), { offsetHeight: 90, clientHeight: 90, scrollHeight: 154 });

    fitListsIntoBox(heading(), listsIn(heading()));

    expect(heading().style.height).toBe('');
  });
});

/**
 * How wide the gutter is, once the marker is measured rather than guessed.
 *
 * `1.2em` was the guess, and on the deck that reported this it was 2.18px wider
 * than a `1.` in a bold 76px heading actually needs — inside the box, but flush
 * against the border, and short the moment the same list reaches `10.`.
 */
describe('the gutter is as wide as the marker measured', () => {
  it('reserves what the marker takes, plus room to not sit on the words', () => {
    // The reported case: 76px heading, decimal marker measured at 89.02px.
    // 89.02 / 76 = 1.171em, and 0.3em of breathing room on top.
    expect(
      listFitStyle(metrics({ paddingLeft: '0px', fontSize: '76px', markerAdvance: 89.02 })),
    ).toMatchObject({ 'padding-left': '1.48em' });
  });

  it('reserves more for a wider marker at the same size', () => {
    // The same list once it reaches `10.`: two digits, so a wider marker and a
    // wider gutter, from the same arithmetic and no special case.
    expect(
      listFitStyle(metrics({ paddingLeft: '0px', fontSize: '76px', markerAdvance: 131 })),
    ).toMatchObject({ 'padding-left': '2.03em' });
  });

  it('rounds up, so the gutter is never a hundredth short of the marker', () => {
    // 30 / 28 = 1.0714…em; rounding down would leave the marker over the edge.
    const style = listFitStyle(metrics({ paddingLeft: '0px', fontSize: '28px', markerAdvance: 30 }));
    expect(style['padding-left']).toBe('1.38em');
    expect(1.38 * 28).toBeGreaterThanOrEqual(30);
  });

  it('widens a gutter the deck left too narrow for its marker', () => {
    // 1em of indent used to be enough to call the list "already indented" and
    // leave it alone. It is not enough when the marker is wider than that.
    expect(
      listFitStyle(metrics({ paddingLeft: '76px', fontSize: '76px', markerAdvance: 89.02 })),
    ).toMatchObject({ 'padding-left': '1.48em' });
  });

  it('leaves a gutter that already holds the marker alone', () => {
    // Nothing is written where the deck has answered: an override that changes
    // nothing would only grow the exported file.
    expect(
      listFitStyle(metrics({ paddingLeft: '120px', fontSize: '76px', markerAdvance: 89.02 })),
    ).not.toHaveProperty('padding-left');
  });

  it('falls back to the old guess when nothing could be measured', () => {
    // A list with no items to measure. 1.2em is close to what a one-digit
    // decimal really takes, so it is the right thing to guess when guessing.
    expect(
      listFitStyle(metrics({ paddingLeft: '0px', fontSize: '28px', markerAdvance: null })),
    ).toMatchObject({ 'padding-left': '1.2em' });
  });

  it('still writes no gutter for a marker that sits on the line', () => {
    // `inside` puts the marker in the line box, where no padding holds it —
    // which is what keeps this from fighting the centre and right alignment
    // branches of `listAlignmentStyle`.
    expect(
      listFitStyle(metrics({ paddingLeft: '0px', listStylePosition: 'inside', markerAdvance: 89.02 })),
    ).not.toHaveProperty('padding-left');
  });
});
