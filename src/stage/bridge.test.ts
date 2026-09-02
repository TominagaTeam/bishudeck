import { afterEach, describe, expect, it } from 'vitest';

import { SLIDE_ROOT_ATTRIBUTE, composeSlideDocument } from '../core/document/compose';
import { CROPPING_ATTRIBUTE, CROP_ORIGIN_ATTRIBUTE } from '../core/editing/crop';
import { buildProject } from '../import/pipeline';
import { StageBridge } from './bridge';
import { BLANK_ATTRIBUTE, CARET_LINE_ATTRIBUTE, openCaretLine, syncBlankMark } from './placeholder';

/**
 * The load/edit/save round trip is the promise the whole design rests on: what
 * comes out has to be the slide that went in, with no trace of the editor.
 */
const DECK = `<!doctype html>
<html>
  <head><style>.slide { color: red; }</style></head>
  <body>
    <section class="slide" data-role="cover">
      <h1 class="headline">タイトル</h1>
      <button onclick="next()">次へ</button>
      <script>setup();</script>
    </section>
    <section class="slide"><h2>2 枚目</h2></section>
  </body>
</html>`;

function loadIntoStage(slideIndex: number) {
  const project = buildProject(DECK, 'generic');
  const slide = project.slides[slideIndex];
  const html = composeSlideDocument(project.shared, slide, { mode: 'edit' });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return { project, slide, bridge: new StageBridge(doc, () => {}), doc };
}

describe('StageBridge', () => {
  it('gives every element a resolvable uid', () => {
    const { bridge, doc } = loadIntoStage(0);
    const headline = doc.querySelector('.headline')!;
    const uid = bridge.uidOf(headline);

    expect(uid).toBeTruthy();
    expect(bridge.resolve(uid!)).toBe(headline);
  });

  it('returns the slide unchanged when nothing was edited', () => {
    const { slide, bridge } = loadIntoStage(0);
    expect(bridge.serializeSlide()).toBe(slide.html);
  });

  it('restores scripts and inline handlers that edit mode disabled', () => {
    const { bridge, doc } = loadIntoStage(0);

    // While editing, neither is live.
    expect(doc.querySelector('button')!.getAttribute('onclick')).toBeNull();
    expect(doc.querySelector('section script')!.getAttribute('type')).toBe(
      'application/hse-disabled',
    );

    const serialized = bridge.serializeSlide();
    expect(serialized).toContain('onclick="next()"');
    expect(serialized).toContain('<script>setup();</script>');
    expect(serialized).not.toContain('hse-disabled');
  });

  it('leaves no editor attributes in the saved markup', () => {
    const { bridge, doc } = loadIntoStage(0);
    const headline = doc.querySelector('.headline') as HTMLElement;
    headline.setAttribute('contenteditable', 'true');
    // Both marks an open crop leaves on a frame, including the copy of the
    // picture's original style that 「元の画像に戻す」 restores from.
    headline.setAttribute('data-hse-cropping', '');
    headline.setAttribute('data-hse-crop-origin', 'width:100%');
    headline.textContent = '編集後';

    const serialized = bridge.serializeSlide();
    expect(serialized).toContain('編集後');
    expect(serialized).not.toContain('data-hse-');
    expect(serialized).not.toContain('crop-origin');
    expect(serialized).not.toContain('contenteditable');
  });

  it('serializes only the slide, never the surrounding shell', () => {
    const { bridge } = loadIntoStage(1);
    const serialized = bridge.serializeSlide();

    expect(serialized).toContain('2 枚目');
    expect(serialized).not.toContain('タイトル');
    expect(serialized).not.toContain('<body');
  });

  it('keeps authored attributes such as data-role intact', () => {
    const { bridge } = loadIntoStage(0);
    expect(bridge.serializeSlide()).toContain('data-role="cover"');
  });

  // The cleaning is aimed at a prefix and two attribute names, and everything
  // that decides how the slide looks sits outside all three. Pinned because the
  // list of what counts as the editor's own is now shared with `slideMarkup`,
  // and a name added to it carelessly would take a deck's markup with it.
  it('keeps everything that decides how the element looks', () => {
    const { bridge, doc } = loadIntoStage(0);
    const headline = doc.querySelector('.headline') as HTMLElement;
    headline.style.transform = 'translate(40px, 10px)';

    const serialized = bridge.serializeSlide();
    expect(serialized).toContain('class="headline"');
    expect(serialized).toContain('translate(40px, 10px)');
    expect(serialized).toContain('data-role="cover"');
  });

  // The crop session un-clips the frame through a stylesheet rule keyed on this
  // attribute, so it sits on a slide element for as long as the session is open
  // — including across the commit each drag ends with.
  it('leaves no trace of an open crop session', () => {
    const { bridge, doc } = loadIntoStage(0);
    (doc.querySelector('.headline') as HTMLElement).setAttribute(CROPPING_ATTRIBUTE, '');

    const serialized = bridge.serializeSlide();
    expect(serialized).not.toContain(CROPPING_ATTRIBUTE);
    expect(serialized).toContain('タイトル');
  });

  // The prompt painted over an empty element is selected on this attribute, so
  // it sits on a slide element while the text session is open — and autosave
  // can serialize in the middle of one.
  it('leaves no trace of the empty-element mark', () => {
    const { bridge, doc } = loadIntoStage(0);
    const headline = doc.querySelector('.headline') as HTMLElement;
    headline.setAttribute('contenteditable', 'true');
    syncBlankMark(headline);
    headline.textContent = '';
    syncBlankMark(headline);
    expect(headline.hasAttribute(BLANK_ATTRIBUTE)).toBe(true);

    const serialized = bridge.serializeSlide();
    expect(serialized).not.toContain(BLANK_ATTRIBUTE);
    expect(serialized).not.toContain('contenteditable');
  });
});

/**
 * The undo snapshot is the other door slide markup is copied through, and it
 * cleans by a different rule than serialization: an address has to survive it
 * or the history loses track of what it is putting back, while the scaffolding
 * of a session has to be left behind — nothing takes those marks off an element
 * that arrives back through an undo, so a restored `data-hse-blank` painted
 * 「テキストを入力」 over an empty box until the slide was closed.
 */
describe('slideMarkup', () => {
  /** A slide holding one element that looks exactly like an open session. */
  function midSession() {
    const { bridge, doc } = loadIntoStage(0);
    const headline = doc.querySelector('.headline') as HTMLElement;
    headline.setAttribute('contenteditable', 'true');
    headline.setAttribute('spellcheck', 'false');
    headline.textContent = '';
    openCaretLine(headline);
    syncBlankMark(headline);
    headline.setAttribute(CROPPING_ATTRIBUTE, '');
    return { bridge, doc, headline };
  }

  it('leaves the session scaffolding out of the snapshot', () => {
    const { bridge, headline } = midSession();
    expect(headline.hasAttribute(BLANK_ATTRIBUTE)).toBe(true);

    const markup = bridge.slideMarkup();
    expect(markup).not.toContain(BLANK_ATTRIBUTE);
    expect(markup).not.toContain(CARET_LINE_ATTRIBUTE);
    expect(markup).not.toContain('contenteditable');
    expect(markup).not.toContain('spellcheck');
    expect(markup).not.toContain(CROPPING_ATTRIBUTE);
    // Only the mark comes off the caret's line. The break is a node in the
    // document by now, and a snapshot is not where it gets decided that it was
    // ours to take away (placeholder.ts) — serialization treats it the same.
    expect(markup).toContain('<br>');
  });

  it('reads the stage without disturbing it', () => {
    const { bridge, headline } = midSession();
    bridge.slideMarkup();
    expect(headline.hasAttribute(BLANK_ATTRIBUTE)).toBe(true);
    expect(headline.getAttribute('contenteditable')).toBe('true');
  });

  it('keeps the addresses an undo has to find things by', () => {
    const { bridge, doc } = midSession();
    const uid = bridge.uidOf(doc.querySelector('.headline')!)!;

    const markup = bridge.slideMarkup();
    expect(markup).toContain(`data-hse-uid="${uid}"`);
    expect(markup).toContain(SLIDE_ROOT_ATTRIBUTE);
  });

  // The line between "scaffolding" and "state the editor is remembering for the
  // user": the crop marks look alike, and only one of them is a running session.
  it('keeps what 「元の画像に戻す」 restores from', () => {
    const { bridge, headline } = midSession();
    headline.setAttribute(CROP_ORIGIN_ATTRIBUTE, 'width:100%');

    const markup = bridge.slideMarkup();
    expect(markup).toContain(`${CROP_ORIGIN_ATTRIBUTE}="width:100%"`);
    expect(markup).not.toContain(CROPPING_ATTRIBUTE);
  });

  it('keeps everything that decides how the slide looks', () => {
    const { bridge, headline } = midSession();
    headline.style.transform = 'translate(40px, 10px)';

    const markup = bridge.slideMarkup();
    expect(markup).toContain('class="headline"');
    expect(markup).toContain('translate(40px, 10px)');
    expect(markup).toContain('data-role="cover"');
  });
});

const ACTIVE_CLASS_DECK = `<!doctype html>
<html>
  <head><style>.slide{opacity:0}.slide.is-active{opacity:1}</style></head>
  <body>
    <div class="deck">
      <section class="slide is-active"><h1>A</h1></section>
      <section class="slide"><h1>B</h1></section>
    </div>
  </body>
</html>`;

describe('stage classes', () => {
  function load(index: number) {
    const project = buildProject(ACTIVE_CLASS_DECK, 'generic');
    const slide = project.slides[index];
    const html = composeSlideDocument(project.shared, slide, { mode: 'edit' });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return { slide, doc, bridge: new StageBridge(doc, () => {}) };
  }

  it('makes an otherwise hidden slide visible on the stage', () => {
    const { doc } = load(1);
    expect(doc.querySelector('.slide')?.classList.contains('is-active')).toBe(true);
  });

  it('strips the added class again on save', () => {
    const { slide, bridge } = load(1);
    expect(bridge.serializeSlide()).toBe(slide.html);
  });

  // An undo snapshot is put straight back onto the stage, so the class that
  // makes a lone slide visible has to be in it. Stripping there is for the
  // editor's own session marks only — this one is the stage's, and taking it
  // out would black the slide out on the first ⌘Z.
  it('keeps the added class in an undo snapshot', () => {
    const { bridge } = load(1);
    expect(bridge.slideMarkup()).toContain('is-active');
  });

  it('does not strip the class from a slide that authored it', () => {
    const { slide, bridge } = load(0);
    expect(bridge.serializeSlide()).toContain('is-active');
    expect(bridge.serializeSlide()).toBe(slide.html);
  });
});

/**
 * `elementsAt` is the only part of the bridge that asks the layout engine
 * anything, and jsdom answers neither `elementsFromPoint` (it has no such
 * method) nor `getBoundingClientRect` (every box is zero). Both are stated
 * outright here; the real numbers behind the rule were measured in a browser
 * and are written on the method.
 */
describe('StageBridge.elementsAt', () => {
  /**
   * The live document rather than a parsed one: `getComputedStyle` needs a
   * `defaultView`, and a `DOMParser` document has none — which is exactly how
   * the `visibility` test below first passed while testing nothing.
   */
  function stageWith(html: string) {
    document.body.innerHTML = `<section ${SLIDE_ROOT_ATTRIBUTE}>${html}</section>`;
    return { doc: document, bridge: new StageBridge(document, () => {}) };
  }

  afterEach(() => {
    Reflect.deleteProperty(document, 'elementsFromPoint');
    document.body.innerHTML = '';
  });

  function box(element: Element, left: number, top: number, width: number, height: number): void {
    element.getBoundingClientRect = () =>
      ({
        width,
        height,
        top,
        left,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
      }) as DOMRect;
  }

  /** What the browser would answer, minus anything clipped or refusing the pointer. */
  function hitTestAnswers(doc: Document, elements: Element[]): void {
    (doc as Document & { elementsFromPoint: () => Element[] }).elementsFromPoint = () => elements;
  }

  it('keeps what a pointer can reach in front of what it cannot', () => {
    // The reported case: a box dragged out of an ancestor that clips, so the
    // hit test never names it however exactly the pointer lands on it.
    const { doc, bridge } = stageWith('<div id="panel"></div><div id="card"><div id="lost"></div></div>');
    const panel = doc.getElementById('panel')!;
    const card = doc.getElementById('card')!;
    const lost = doc.getElementById('lost')!;
    box(panel, 0, 0, 800, 400);
    box(card, 0, 500, 300, 200);
    box(lost, 100, 100, 300, 100);
    hitTestAnswers(doc, [panel]);

    expect(bridge.elementsAt(200, 150)).toEqual([panel, lost]);
  });

  it('leaves out what the point misses', () => {
    const { doc, bridge } = stageWith('<div id="here"></div><div id="elsewhere"></div>');
    const here = doc.getElementById('here')!;
    const elsewhere = doc.getElementById('elsewhere')!;
    box(here, 0, 0, 200, 200);
    box(elsewhere, 600, 600, 200, 200);
    hitTestAnswers(doc, []);

    expect(bridge.elementsAt(100, 100)).toEqual([here]);
  });

  it('leaves out a box the deck itself hides', () => {
    // Hidden on purpose is not the same as dragged out of sight: offering it
    // would hand back something the deck never shows.
    const { doc, bridge } = stageWith('<div id="shown"></div><div id="hidden" style="visibility:hidden"></div>');
    const shown = doc.getElementById('shown')!;
    const hidden = doc.getElementById('hidden')!;
    box(shown, 0, 0, 200, 200);
    box(hidden, 0, 0, 200, 200);
    hitTestAnswers(doc, []);

    expect(bridge.elementsAt(100, 100)).toEqual([shown]);
  });

  it('puts a child in front of the parent it paints over', () => {
    const { doc, bridge } = stageWith('<div id="outer"><div id="inner"></div></div>');
    const outer = doc.getElementById('outer')!;
    const inner = doc.getElementById('inner')!;
    box(outer, 0, 0, 400, 400);
    box(inner, 0, 0, 200, 200);
    hitTestAnswers(doc, []);

    expect(bridge.elementsAt(100, 100)).toEqual([inner, outer]);
  });

  it('never names anything outside the slide', () => {
    const { doc, bridge } = stageWith('<div id="inside"></div>');
    const inside = doc.getElementById('inside')!;
    box(inside, 0, 0, 200, 200);
    // The shell around the slide answers hit tests too; it is not the slide.
    hitTestAnswers(doc, [doc.body, doc.documentElement]);

    expect(bridge.elementsAt(100, 100)).toEqual([inside]);
  });
});

