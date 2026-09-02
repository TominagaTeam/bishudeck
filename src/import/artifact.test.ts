import { describe, expect, it } from 'vitest';

import { isArtifactHtml, unwrapArtifact } from './artifact';

const JS_UUID = '11111111-1111-4111-8111-111111111111';
const STAGE_UUID = '55555555-5555-4555-8555-555555555555';
const KANA_FONT = '22222222-2222-4222-8222-222222222222';
const KANJI_FONT = '33333333-3333-4333-8333-333333333333';
const IMAGE_UUID = '44444444-4444-4444-8444-444444444444';

/** A one-pixel gif, so the inlined data URL is recognizable in assertions. */
const GIF_BASE64 = 'R0lGODlhAQABAAAAACw=';

/**
 * Stands in for the real `<deck-stage>` component. The `</script>` is the part
 * that matters: the real runtime carries one in a usage comment, and it has to
 * survive being written into an HTML file.
 */
const STAGE_RUNTIME =
  "/* usage: <deck-stage></deck-stage><script src=\"deck-stage.js\"></script> */\n" +
  "customElements.define('deck-stage', class extends HTMLElement {});";

const TEMPLATE = `<!doctype html>
<html><head><meta charset="utf-8"><script src="${JS_UUID}"></script></head>
<body><x-dc><helmet><style>
@font-face{font-family:'Deck';src:url("${KANA_FONT}") format('woff2');unicode-range:U+3040-309F;}
@font-face{font-family:'Deck';src:url("${KANJI_FONT}") format('woff2');unicode-range:U+4E00-9FFF;}
.title{font-family:'Deck'}
</style></helmet>
<x-import component-from-global-scope="deck-stage" from="${STAGE_UUID}#/deck-stage.js" width="1600" height="900" hint-size="100%,100%">
<section data-label="表紙"><h1 class="title">はじめに</h1><img src="${IMAGE_UUID}"><p>{{ presenter }}</p></section>
<section data-label="{{ eventDate }}"><p>ふたつめ{{ missing }}</p>
<image-slot id="shot" shape="rect" placeholder="ここにしゃしん"></image-slot>
<image-slot id="hero" src="${IMAGE_UUID}" fit="contain" shape="circle"></image-slot>
</section>
</x-import>
<script type="text/x-dc" data-dc-script data-props='{"presenter": {"editor": "text", "default": "なまえ"}, "eventDate": {"editor": "text", "default": "ついたち"}}'>
class Component extends DCLogic {
  renderVals() { return { presenter: this.props.presenter ?? "なまえ" }; }
}
</script>
</x-dc></body></html>`;

function bundle(template: string): string {
  const manifest = {
    [JS_UUID]: { mime: 'text/javascript', compressed: false, data: btoa('console.log(1)') },
    [STAGE_UUID]: { mime: 'text/javascript', compressed: false, data: btoa(STAGE_RUNTIME) },
    [KANA_FONT]: { mime: 'font/woff2', compressed: false, data: 'd09GMgABAAAA' },
    [KANJI_FONT]: { mime: 'font/woff2', compressed: false, data: 'd09GMgABAAAB' },
    [IMAGE_UUID]: { mime: 'image/gif', compressed: false, data: GIF_BASE64 },
  };
  return `<!doctype html><html><head><title>Bundled Page</title></head><body>
<div id="__bundler_loading">Unpacking...</div>
<script type="__bundler/manifest">${JSON.stringify(manifest)}</script>
<script type="__bundler/page_order">[]</script>
<script type="__bundler/template">${encode(template)}</script>
</body></html>`;
}

/** The real bundler escapes `</script>` so the JSON survives the HTML parser. */
function encode(template: string): string {
  return JSON.stringify(template).replace(/<\//g, '<\\u002F');
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('recognizing an artifact download', () => {
  it('claims a bundled file and an unbundled x-dc deck', () => {
    expect(isArtifactHtml(bundle(TEMPLATE))).toBe(true);
    expect(isArtifactHtml(TEMPLATE)).toBe(true);
  });

  it('leaves an ordinary deck alone', () => {
    expect(isArtifactHtml('<html><body><section class="slide">A</section></body></html>')).toBe(false);
  });

  it('does not claim a deck the editor itself exported', () => {
    // Both of these carry the marker as text without being an artifact: the
    // stage CSS uses it as a selector, and the deck component documents its own
    // usage in a comment. Unwrapping either would re-subset fonts that were
    // subsetted on the way in.
    const exported = `<!doctype html><html><head><style data-hse-injected="stage-css">
      x-import[component-from-global-scope="deck-stage"]{display:block}
      </style></head><body><deck-stage><section>A</section></deck-stage>
      <script>/* usage: <x-import component-from-global-scope="deck-stage"> */
      customElements.define('deck-stage', class extends HTMLElement {});</script>
      </body></html>`;

    expect(isArtifactHtml(exported)).toBe(false);
  });
});

describe('unwrapping', () => {
  it('replaces the loader with the deck it would have rendered', async () => {
    const { html } = await unwrapArtifact(bundle(TEMPLATE));
    const doc = parse(html);

    expect(doc.getElementById('__bundler_loading')).toBeNull();
    expect(doc.querySelector('script[type="__bundler/template"]')).toBeNull();
    expect(doc.querySelectorAll('deck-stage > section')).toHaveLength(2);
  });

  it('flattens the x-dc wrappers into plain HTML', async () => {
    const { html } = await unwrapArtifact(bundle(TEMPLATE));
    const doc = parse(html);

    expect(doc.querySelector('x-dc')).toBeNull();
    expect(doc.querySelector('helmet')).toBeNull();
    expect(doc.querySelector('x-import')).toBeNull();
    // The helmet's styles are what the runtime would have put in <head>.
    expect(doc.head.querySelector('style')?.textContent).toContain('.title');
  });

  it('keeps the stage size the deck states', async () => {
    const { html } = await unwrapArtifact(bundle(TEMPLATE));
    const stage = parse(html).querySelector('deck-stage');

    expect(stage?.getAttribute('width')).toBe('1600');
    expect(stage?.getAttribute('height')).toBe('900');
    // Runtime-only attributes go with the runtime.
    expect(stage?.getAttribute('from')).toBeNull();
    expect(stage?.getAttribute('hint-size')).toBeNull();
  });

  it('drops the bundled template runtime', async () => {
    const result = await unwrapArtifact(bundle(TEMPLATE));
    const scripts = Array.from(parse(result.html).querySelectorAll('script'));

    expect(result.scriptsDropped).toBe(1);
    // Only the deck's own presentation component is left standing.
    expect(scripts).toHaveLength(1);
    expect(scripts[0].textContent).toContain("customElements.define('deck-stage'");
  });

  it("keeps the deck's presentation runtime, which is named by an attribute", async () => {
    const result = await unwrapArtifact(bundle(TEMPLATE));

    // Nothing points at it with a `src`, so dropping every bundled script by
    // src would have kept it by accident and flattening would have lost it.
    expect(result.deckRuntimeKept).toBe(true);
    expect(result.html).toContain("customElements.define('deck-stage'");
  });

  it('inlines images as data URLs', async () => {
    const { html } = await unwrapArtifact(bundle(TEMPLATE));
    const src = parse(html).querySelector('img')?.getAttribute('src');

    expect(src).toBe(`data:image/gif;base64,${GIF_BASE64}`);
  });
});

describe('what the runtime would have rendered', () => {
  it('fills bindings in with the default the component declares', async () => {
    const result = await unwrapArtifact(bundle(TEMPLATE));
    const doc = parse(result.html);

    expect(doc.querySelector('section p')?.textContent).toBe('なまえ');
    // Attribute values are interpolated too, exactly as in the runtime.
    expect(doc.querySelectorAll('section')[1].getAttribute('data-label')).toBe('ついたち');
    expect(result.propsResolved).toBe(2);
  });

  it('leaves a binding it cannot resolve standing', async () => {
    const { html } = await unwrapArtifact(bundle(TEMPLATE));

    // Emptying it would erase the only clue about what belongs there.
    expect(parse(html).querySelectorAll('section')[1].textContent).toContain('{{ missing }}');
  });

  it('drops the logic block once its bindings are resolved', async () => {
    const { html } = await unwrapArtifact(bundle(TEMPLATE));

    expect(parse(html).querySelector('script[data-dc-script]')).toBeNull();
  });

  it('turns an empty photo frame into a box that can be seen', async () => {
    const result = await unwrapArtifact(bundle(TEMPLATE));
    const doc = parse(result.html);

    expect(doc.querySelector('image-slot')).toBeNull();
    expect(result.imageSlots).toBe(2);

    const box = doc.getElementById('shot');
    expect(box?.tagName).toBe('DIV');
    expect(box?.textContent).toContain('ここにしゃしん');
    // Without a box of its own the frame is invisible, which is the bug.
    expect(box?.getAttribute('style')).toContain('height:100%');
    expect(box?.innerHTML).toContain('dashed');
    // `rect` is the one shape that rounds nothing.
    expect(box?.innerHTML).not.toContain('border-radius');
  });

  /**
   * The caption covers the whole frame, so it is what every click on the frame
   * would land on — and it carries words, which is where selection stops. That
   * left the frame itself reachable only through the breadcrumb, and a
   * double-click on a photo frame opening a text session on the placeholder
   * text instead of asking for a photo.
   */
  it('leaves the caption untouchable, the way the component drew it', async () => {
    const { html } = await unwrapArtifact(bundle(TEMPLATE));
    const caption = parse(html).querySelector('#shot div div');

    expect(caption?.textContent).toBe('ここにしゃしん');
    expect(caption?.getAttribute('style')).toContain('pointer-events:none');
  });

  it('turns a filled photo frame into the image it was showing', async () => {
    const { html } = await unwrapArtifact(bundle(TEMPLATE));
    const image = parse(html).querySelector('#hero img');

    // Still inlined: the slot is rewritten before resources are resolved.
    expect(image?.getAttribute('src')).toBe(`data:image/gif;base64,${GIF_BASE64}`);
    expect(image?.getAttribute('style')).toContain('object-fit:contain');
    expect(parse(html).querySelector('#hero div')?.getAttribute('style')).toContain(
      'border-radius:50%',
    );
  });

  it('emits markup that reads back the same way', async () => {
    const { html } = await unwrapArtifact(bundle(TEMPLATE));
    const once = parse(html).getElementById('shot')?.outerHTML ?? '';

    expect(parse(`<!doctype html><html><body>${once}</body></html>`).getElementById('shot')
      ?.outerHTML).toBe(once);
  });
});

describe('markup the bundler escaped past the HTML parser', () => {
  const ESCAPED = `<!doctype html>
<html><head></head><body><x-dc>
<x-import component-from-global-scope="deck-stage" from="${STAGE_UUID}#/deck-stage.js" width="1600" height="900">
<section>
  <sc-raw-table style="border-collapse:collapse">
    <sc-raw-thead><sc-raw-tr><sc-raw-th>比較軸</sc-raw-th></sc-raw-tr></sc-raw-thead>
    <sc-raw-tbody><sc-raw-tr><sc-raw-td>主な役割</sc-raw-td></sc-raw-tr></sc-raw-tbody>
  </sc-raw-table>
  <svg sc-camel-view-box="0 0 24 24"><rect width="24" height="24"></rect></svg>
</section>
</x-import>
</x-dc></body></html>`;

  it('rebuilds the table the escaped tags stood in for', async () => {
    const { html } = await unwrapArtifact(bundle(ESCAPED));
    const table = parse(html).querySelector('section > table');

    expect(parse(html).querySelector('sc-raw-table')).toBeNull();
    expect(table?.getAttribute('style')).toBe('border-collapse:collapse');
    expect(table?.querySelector('thead > tr > th')?.textContent).toBe('比較軸');
    expect(table?.querySelector('tbody > tr > td')?.textContent).toBe('主な役割');
  });

  it('emits a table that survives being parsed again', async () => {
    // The point of the escaping in the first place: the deck is handed on as a
    // string, so what comes out here has to keep its shape through one more
    // parse — the one the importer does.
    const { html } = await unwrapArtifact(bundle(ESCAPED));
    const again = parse(parse(html).documentElement.outerHTML);

    expect(again.querySelectorAll('table tbody td')).toHaveLength(1);
    expect(again.querySelectorAll('section > table')).toHaveLength(1);
  });

  it('restores a camelCase attribute name', async () => {
    const { html } = await unwrapArtifact(bundle(ESCAPED));
    const svg = parse(html).querySelector('svg');

    // Lower-cased, `viewBox` does nothing and the drawing loses its scale.
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.hasAttribute('sc-camel-view-box')).toBe(false);
  });

  it('reads an escaped helmet as a helmet', async () => {
    const withHelmet = ESCAPED.replace('<section>', '<sc-helmet><style>.x{color:red}</style></sc-helmet><section>');
    const doc = parse((await unwrapArtifact(bundle(withHelmet))).html);

    expect(doc.querySelector('sc-helmet')).toBeNull();
    expect(doc.head.querySelector('style')?.textContent).toContain('.x{color:red}');
  });
});

describe('font subsetting', () => {
  it('keeps only the faces covering characters the deck shows', async () => {
    const result = await unwrapArtifact(bundle(TEMPLATE));
    const css = parse(result.html).head.querySelector('style')?.textContent ?? '';

    expect(result.fontsInlined).toBe(1);
    expect(result.fontsDropped).toBe(1);
    expect(css).toContain('data:font/woff2;base64,d09GMgABAAAA');
    expect(css).not.toContain('U+4E00-9FFF');
    // Rules that are not font faces survive untouched.
    expect(css).toContain(".title{font-family:'Deck'}");
  });

  it('reads wildcard ranges', async () => {
    const wildcard = TEMPLATE.replace('U+3040-309F', 'U+30??');
    const result = await unwrapArtifact(bundle(wildcard));

    // U+30A2 (ア) is in the typing headroom, so the katakana block is covered.
    expect(result.fontsInlined).toBe(1);
  });

  it('merges weight variants that share one file into a single rule', async () => {
    const variants = TEMPLATE.replace(
      `@font-face{font-family:'Deck';src:url("${KANJI_FONT}") format('woff2');unicode-range:U+4E00-9FFF;}`,
      `@font-face{font-family:'Deck';font-weight:700;src:url("${KANA_FONT}") format('woff2');unicode-range:U+3040-309F;}`,
    ).replace(
      "@font-face{font-family:'Deck';src:",
      "@font-face{font-family:'Deck';font-weight:400;src:",
    );
    const result = await unwrapArtifact(bundle(variants));
    const css = parse(result.html).head.querySelector('style')?.textContent ?? '';

    // One rule, one copy of the font: the file already backed both weights.
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(css).toContain('font-weight:400 700;');
    expect(css.match(/data:font\/woff2/g)).toHaveLength(1);
  });

  it('keeps a face that declares no range', async () => {
    const unranged = TEMPLATE.replace('unicode-range:U+4E00-9FFF;', '');
    const result = await unwrapArtifact(bundle(unranged));

    expect(result.fontsInlined).toBe(2);
    expect(result.fontsDropped).toBe(0);
  });
});

describe('compressed manifest entries', () => {
  it('gunzips before inlining', async () => {
    const gzipped = await gzip(new Uint8Array([1, 2, 3, 4]));
    const manifest = {
      [IMAGE_UUID]: { mime: 'image/gif', compressed: true, data: toBase64(gzipped) },
    };
    const template = `<html><body><img src="${IMAGE_UUID}"></body></html>`;
    const html = `<html><body>
<script type="__bundler/manifest">${JSON.stringify(manifest)}</script>
<script type="__bundler/template">${encode(template)}</script>
</body></html>`;

    const result = await unwrapArtifact(html);

    expect(parse(result.html).querySelector('img')?.getAttribute('src')).toBe(
      `data:image/gif;base64,${btoa('\x01\x02\x03\x04')}`,
    );
  });
});

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  void writer.write(bytes);
  void writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
