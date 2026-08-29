/**
 * Unwrapping a Claude Artifacts "standalone" HTML download.
 *
 * That file is not the deck. Its body is a spinner, and the real document sits
 * JSON-encoded in `<script type="__bundler/template">`, with every font, image
 * and script it references stored beside it in a manifest keyed by uuid.
 * Opening the file runs a loader that mints blob URLs for the manifest entries,
 * substitutes them into the template and replaces the whole document with it.
 *
 * The editor cannot import what only exists after a script has run (AD-2), so
 * this module performs the same substitution ahead of time, as string work:
 *
 * - Fonts and images are inlined as `data:` URLs. The deck stays one file,
 *   which is the only form this app persists, so they survive a round trip.
 * - The template runtime (the `x-dc` component system, React, the `image-slot`
 *   component) is dropped. It exists to build the DOM the editor is about to
 *   take over, and keeping it would have the deck re-render itself underneath
 *   the editor.
 * - `<deck-stage>`'s own script is the exception: it does not build the deck,
 *   it *presents* one, slotting whatever children it is given (one slide on
 *   screen, a thumbnail rail, arrow-key paging). Dropping it is what makes an
 *   export a silent scroll of every slide, so it is kept aside — inlined here,
 *   lifted into `SharedResources.deckRuntime` by the pipeline, and put back
 *   only when composing an export. While it is gone, the layout it would apply
 *   is reproduced as CSS by the deck-stage detector.
 * - Whatever the runtime would have *rendered* is folded into the markup in its
 *   place: `{{ prop }}` bindings become the text the component declared as
 *   their default, and `<image-slot>` becomes the placeholder box it draws
 *   while empty. Left alone, both vanish once the runtime is gone — the
 *   bindings as literal double braces, the photo frames as unknown elements
 *   with no box at all, invisible and unselectable.
 * - The `<x-dc>` / `<helmet>` / `<x-import>` wrappers are flattened to plain
 *   HTML, since nothing defines those elements once the runtime is gone.
 * - Tag and attribute names the bundler escaped to get the template past the
 *   HTML parser (`<sc-raw-td>`, `sc-camel-view-box`) are decoded back. Skipping
 *   this leaves a table as a heap of unknown inline elements and an SVG with no
 *   `viewBox`; see {@link ESCAPED_TAGS}.
 *
 * Fonts are subsetted on the way in. A Google Fonts Japanese family arrives as
 * ~120 `unicode-range` slices totalling 7 MB, and the shared head is
 * re-serialized into every thumbnail, every autosave and every export — so only
 * the slices covering characters the deck actually uses are kept.
 */

const TEMPLATE_SELECTOR = 'script[type="__bundler/template"]';
const MANIFEST_SELECTOR = 'script[type="__bundler/manifest"]';

/**
 * The deck component's own script, named by the `<x-import>` that mounts it
 * (`from="<uuid>#/deck-stage.js"`) rather than by a `<script src>` of its own.
 */
const DECK_RUNTIME_SOURCE = 'from';

/** What an `<x-import>` that mounts the deck component looks like. */
const DECK_STAGE_MARKER = 'component-from-global-scope="deck-stage"';
export const DECK_STAGE_IMPORT = `x-import[${DECK_STAGE_MARKER}]`;

/**
 * Tag names the bundler substitutes so that the template survives being parsed
 * as HTML.
 *
 * The parser has opinions about table markup that predate any script: a `<td>`
 * with no `<table>` around it is dropped, and a `<table>` holding anything
 * unexpected has it foster-parented out to a sibling. The template is a string
 * that has to round-trip through exactly that parser, so the tags it cannot be
 * trusted with are stored under names the parser has no rules for, and the
 * runtime renames them back as it builds the DOM. This app parses the template
 * instead of running the runtime (AD-2), so the rename is on us.
 */
const ESCAPED_TAGS: Record<string, string> = {
  'sc-helmet': 'helmet',
  'sc-raw-caption': 'caption',
  'sc-raw-select': 'select',
  'sc-raw-table': 'table',
  'sc-raw-tbody': 'tbody',
  'sc-raw-td': 'td',
  'sc-raw-tfoot': 'tfoot',
  'sc-raw-th': 'th',
  'sc-raw-thead': 'thead',
  'sc-raw-tr': 'tr',
};

/**
 * Prefix on an attribute whose real name is camelCase. HTML lower-cases
 * attribute names, which is harmless everywhere except SVG, where `viewBox`
 * and `viewbox` are not the same attribute.
 */
const CAMEL_ATTRIBUTE = 'sc-camel-';

/** Attributes that only mean something to the x-dc runtime we are dropping. */
const RUNTIME_ATTRIBUTES = new Set(['component-from-global-scope', 'from', 'hint-size']);

/** The component's logic block, whose `data-props` declares its bindings. */
const DC_SCRIPT = 'script[data-dc-script]';

/** `{{ path }}`, the runtime's one interpolation form. */
const BINDING = /\{\{([^{}]+)\}\}/g;

/** Text the runtime never interpolates: machinery, not content. */
const NOT_INTERPOLATED = new Set(['SCRIPT', 'STYLE']);

/**
 * Kept regardless of what the deck currently says, so that typing a character
 * the deck happens not to use yet does not silently lose the face. One
 * representative code point per script is enough: subsets are ranges.
 */
const TYPING_HEADROOM = 'Aa0あア';

const FONT_FACE = /@font-face\s*\{[^}]*\}/gi;
const FONT_WEIGHT = /font-weight\s*:\s*([^;}]+);?/i;

/** Bundled resources are addressed by bare uuid, never by path. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Chunked so a multi-megabyte font does not blow the argument limit. */
const BASE64_CHUNK = 0x8000;

interface Resource {
  mime: string;
  compressed: boolean;
  data: string;
}

export interface ArtifactUnwrap {
  /** The deck as plain HTML. */
  html: string;
  fontsInlined: number;
  fontsDropped: number;
  scriptsDropped: number;
  /** `{{ prop }}` bindings filled in with the component's declared default. */
  propsResolved: number;
  /** `<image-slot>` photo frames turned into plain markup. */
  imageSlots: number;
  /** Whether the deck's own presentation runtime came through with it. */
  deckRuntimeKept: boolean;
}

/**
 * Whether this file needs unwrapping at all. Ordinary decks must not be put
 * through the round trip below: re-serializing a document the editor has no
 * business rewriting is exactly the kind of silent damage AD-1 rules out — and
 * this one would re-subset the fonts of a deck that has already been subsetted,
 * dropping faces for text the user has since deleted.
 *
 * The answer has to come from the parsed document, not from the text. A deck
 * the editor itself exported carries the marker twice over without being an
 * artifact: the stage CSS names `x-import[component-from-global-scope=...]` as
 * a selector, and the deck component's own source documents its usage in a
 * comment. Neither is an element. The substring test stays in front of the
 * parse as a fast reject, because "no" is the common answer and parsing several
 * megabytes to reach it is the expensive way to get there.
 */
export function isArtifactHtml(html: string): boolean {
  if (!html.includes('__bundler/template') && !html.includes(DECK_STAGE_MARKER)) return false;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector(TEMPLATE_SELECTOR) !== null || doc.querySelector(DECK_STAGE_IMPORT) !== null;
}

export async function unwrapArtifact(html: string): Promise<ArtifactUnwrap> {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const bundle = readBundle(source);
  const deck = bundle ? new DOMParser().parseFromString(bundle.template, 'text/html') : source;
  const manifest = bundle?.manifest ?? {};

  // Read before flattening: the uuid is on the `<x-import>` attribute that
  // flattening throws away.
  const runtimeUuid = deckRuntimeUuid(deck, manifest);

  decodeEscapedMarkup(deck);
  flattenDesignComponents(deck);
  // Before the fonts are subsetted: both of these turn attribute values into
  // rendered text, and a subset chosen without it would drop the very faces
  // that text needs.
  const propsResolved = resolveComponentProps(deck);
  const imageSlots = materializeImageSlots(deck);
  const scriptsDropped = dropRuntimeScripts(deck, manifest);
  const fonts = subsetFontFaces(deck, manifest);

  // Decoding is the only asynchronous step, so everything that decides *which*
  // resources are needed runs first and the substitution itself stays sync.
  const inlined = await resolveResources(neededResources(deck, manifest), manifest);
  substituteResources(deck, inlined);

  const deckRuntimeKept = runtimeUuid !== null && (await inlineDeckRuntime(deck, manifest, runtimeUuid));

  return {
    html: `<!doctype html>\n${deck.documentElement.outerHTML}`,
    scriptsDropped,
    propsResolved,
    imageSlots,
    deckRuntimeKept,
    ...fonts,
  };
}

function readBundle(doc: Document): { template: string; manifest: Record<string, Resource> } | null {
  const templateText = doc.querySelector(TEMPLATE_SELECTOR)?.textContent;
  const manifestText = doc.querySelector(MANIFEST_SELECTOR)?.textContent;
  if (!templateText || !manifestText) return null;

  try {
    const template: unknown = JSON.parse(templateText);
    const manifest: unknown = JSON.parse(manifestText);
    if (typeof template !== 'string' || typeof manifest !== 'object' || manifest === null) return null;
    return { template, manifest: manifest as Record<string, Resource> };
  } catch {
    // A bundle we cannot read is left to the ordinary detectors rather than
    // failing the import outright.
    return null;
  }
}

/**
 * Undoes the substitution described on {@link ESCAPED_TAGS}.
 *
 * Renaming through the DOM rather than the string keeps the parser out of it:
 * a `<tbody>` built with `createElement` and handed its children stays where
 * it is put, which is the whole reason the bundle avoided writing one.
 */
function decodeEscapedMarkup(doc: Document): void {
  for (const escaped of Array.from(doc.querySelectorAll(Object.keys(ESCAPED_TAGS).join(',')))) {
    const real = doc.createElement(ESCAPED_TAGS[escaped.localName]);
    for (const attribute of Array.from(escaped.attributes)) {
      real.setAttribute(attribute.name, attribute.value);
    }
    real.append(...Array.from(escaped.childNodes));
    escaped.replaceWith(real);
  }

  for (const element of Array.from(doc.querySelectorAll('*'))) {
    for (const { name, value } of Array.from(element.attributes)) {
      if (!name.startsWith(CAMEL_ATTRIBUTE)) continue;
      element.removeAttribute(name);
      element.setAttribute(kebabToCamel(name.slice(CAMEL_ATTRIBUTE.length)), value);
    }
  }
}

function kebabToCamel(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Rewrites the x-dc component format as the plain HTML it renders to:
 * `<helmet>` is the runtime's way of writing into `<head>`, `<x-dc>` is a
 * wrapper with no rendered meaning, and the deck's `<x-import>` becomes the
 * `<deck-stage>` element it mounts.
 */
function flattenDesignComponents(doc: Document): void {
  for (const helmet of Array.from(doc.querySelectorAll('helmet'))) {
    doc.head.append(...Array.from(helmet.childNodes));
    helmet.remove();
  }

  for (const mount of Array.from(doc.querySelectorAll(DECK_STAGE_IMPORT))) {
    const stage = doc.createElement('deck-stage');
    for (const attribute of Array.from(mount.attributes)) {
      if (RUNTIME_ATTRIBUTES.has(attribute.name)) continue;
      stage.setAttribute(attribute.name, attribute.value);
    }
    stage.append(...Array.from(mount.childNodes));
    mount.replaceWith(stage);
  }

  for (const wrapper of Array.from(doc.querySelectorAll('x-dc'))) {
    wrapper.replaceWith(...Array.from(wrapper.childNodes));
  }
}

/**
 * Fills in the `{{ prop }}` bindings the component's logic block would have
 * resolved, and then removes that block.
 *
 * The runtime's interpolation is a substitution and nothing more: `renderVals()`
 * returns an object and `{{ a.b }}` is looked up in it, in text nodes and in
 * attribute values alike. What the editor cannot do is *run* `renderVals()` to
 * get that object (AD-2), so the values come from the `default` each prop
 * declares in `data-props` — which is what the component renders anyway until
 * someone supplies a value, and these downloads carry none.
 *
 * A binding with no declared default is left standing rather than emptied. The
 * runtime renders it as nothing, but a hole in a slide is unreadable: the
 * braces at least say which prop was meant to fill it.
 */
function resolveComponentProps(doc: Document): number {
  let resolved = 0;

  for (const script of Array.from(doc.querySelectorAll(DC_SCRIPT))) {
    const defaults = declaredDefaults(script.getAttribute('data-props'));
    // A component wraps its own markup, so its bindings live in its parent's
    // subtree — except for the one that sits at the top of the document, whose
    // parent says nothing useful and whose `<helmet>` content has by now been
    // moved into `<head>`.
    const parent = script.parentElement;
    const scope =
      !parent || parent === doc.body || parent === doc.documentElement
        ? doc.documentElement
        : parent;
    script.remove();
    if (defaults) resolved += interpolate(scope, defaults);
  }

  return resolved;
}

/** `{"presenter": {"default": "…", …}, …}` -> `{presenter: "…"}`. */
function declaredDefaults(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    console.warn('[import] a component declared props this file cannot read', cause);
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const defaults: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof spec === 'object' && spec !== null && 'default' in spec) {
      defaults[name] = (spec as { default: unknown }).default;
    }
  }
  return defaults;
}

/** Substitutes every resolvable binding in `root`, and reports how many. */
function interpolate(root: Element, defaults: Record<string, unknown>): number {
  let filled = 0;
  const fill = (text: string) =>
    text.replace(BINDING, (whole, path: string) => {
      const value = lookup(defaults, path);
      if (value === undefined) return whole;
      filled += 1;
      return value;
    });

  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    if (!text.includes('{{')) continue;
    if (NOT_INTERPOLATED.has(node.parentElement?.tagName ?? '')) continue;
    node.nodeValue = fill(text);
  }

  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const { name, value } of Array.from(element.attributes)) {
      if (!value.includes('{{')) continue;
      const filledValue = fill(value);
      if (filledValue !== value) element.setAttribute(name, filledValue);
    }
  }

  return filled;
}

/** The runtime's dotted path lookup, over values it can render as text. */
function lookup(defaults: Record<string, unknown>, path: string): string | undefined {
  let value: unknown = defaults;
  for (const key of path.trim().split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  const kind = typeof value;
  return kind === 'string' || kind === 'number' || kind === 'boolean' ? String(value) : undefined;
}

/**
 * Rewrites `<image-slot>` as the box it renders.
 *
 * The element is a custom one with a shadow root: a photo frame the deck's
 * author leaves for a picture to be dropped into later. Without its script it
 * is an unknown *inline* element with no content — not an empty box the user
 * can see and fill, but nothing at all, which is how a slide silently loses
 * its photo area. So the empty state is rewritten as the plain markup that
 * draws the same thing: a soft plate, a dashed ring and the caption. A slot
 * that already carries a `src` becomes the `<img>` it was showing.
 *
 * The styling is inline because that is how the surrounding deck is written;
 * a rule added to the shared head would show up in every export the editor
 * writes from then on.
 */
function materializeImageSlots(doc: Document): number {
  const slots = Array.from(doc.querySelectorAll('image-slot'));

  for (const slot of slots) {
    const radius = slotRadius(slot);
    const box = doc.createElement('div');
    // The id is the slot's persistence key, and a plain HTML id besides; the
    // rest of the attributes only meant something to the component.
    const id = slot.getAttribute('id');
    if (id) box.id = id;
    box.setAttribute(
      'style',
      'position:relative;width:100%;height:100%;aspect-ratio:3/2;' +
        'font:13px/1.3 system-ui,-apple-system,sans-serif',
    );

    const frame = doc.createElement('div');
    frame.setAttribute(
      'style',
      `position:absolute;inset:0;overflow:hidden;background:rgba(127,127,127,.08)${radius}`,
    );
    box.append(frame);

    const src = slot.getAttribute('src');
    if (src) {
      const image = doc.createElement('img');
      image.setAttribute('src', src);
      image.setAttribute('alt', slot.getAttribute('placeholder') ?? '');
      image.setAttribute(
        'style',
        'display:block;width:100%;height:100%;object-fit:' +
          (slot.getAttribute('fit')?.toLowerCase() === 'contain' ? 'contain' : 'cover'),
      );
      frame.append(image);
      slot.replaceWith(box);
      continue;
    }

    // The caption is the author's own words or nothing. The component falls
    // back to "Drop an image", which is an instruction that no longer applies
    // once the drop handler is gone — and English text a Japanese deck never
    // asked for is worse than an unlabelled frame.
    //
    // `pointer-events: none` because the caption is stretched over the whole
    // frame: without it, the caption is what every click on the frame lands on,
    // and since it carries words, selection stops there and never reaches the
    // box (stage/selectionHeuristics.ts). That left 画像を入れる reachable only
    // through the breadcrumb, and a double-click on a photo frame opening a
    // text session on its own placeholder text (issues #100). The component
    // drew this caption inside a shadow root, where it was equally untouchable,
    // so the mark restores the original behaviour rather than departing from
    // it. The ring below has carried the same declaration all along.
    const caption = doc.createElement('div');
    caption.setAttribute(
      'style',
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'text-align:center;padding:12px;box-sizing:border-box;font-weight:500;opacity:.75;' +
        'pointer-events:none',
    );
    caption.textContent = slot.getAttribute('placeholder') ?? '';
    frame.append(caption);

    // `currentColor`, like the component: the slide's own text colour is the
    // one colour guaranteed to read against its background.
    const ring = doc.createElement('div');
    ring.setAttribute(
      'style',
      `position:absolute;inset:0;pointer-events:none;border:1.5px dashed currentColor;opacity:.35${radius}`,
    );
    frame.append(ring);

    slot.replaceWith(box);
  }

  return slots.length;
}

/** The `border-radius` declaration the slot's shape asks for, or none. */
function slotRadius(slot: Element): string {
  switch ((slot.getAttribute('shape') ?? 'rounded').toLowerCase()) {
    case 'rect':
      return '';
    case 'circle':
      return ';border-radius:50%';
    case 'pill':
      return ';border-radius:9999px';
    default: {
      const declared = Number.parseFloat(slot.getAttribute('radius') ?? '');
      return `;border-radius:${Number.isFinite(declared) ? declared : 12}px`;
    }
  }
}

/**
 * The bundled script that defines `<deck-stage>`, if this deck mounts one.
 *
 * It is not loaded by a `<script src>` like the rest of the runtime — the
 * component is named on the `<x-import>` that mounts it, and the template
 * runtime fetches it. So it survives {@link dropRuntimeScripts} either way,
 * and has to be found before {@link flattenDesignComponents} discards the
 * attribute that names it.
 */
function deckRuntimeUuid(doc: Document, manifest: Record<string, Resource>): string | null {
  const mount = doc.querySelector(DECK_STAGE_IMPORT);
  const uuid = firstUuid(mount?.getAttribute(DECK_RUNTIME_SOURCE) ?? '');
  return uuid && isScript(manifest[uuid]) ? uuid : null;
}

/**
 * Puts the deck component's script back into the document as plain inline
 * JavaScript, at the end of the body where its own documentation says it goes.
 *
 * Inline rather than a `data:` URL or a file beside the HTML: a deck is one
 * self-contained file here (§5.2), and that is the form it has to be sharable
 * in. Nothing runs it at this point — the editor's stage never gets
 * `allow-scripts` — and the pipeline lifts it straight back out of the shell;
 * this is how it reaches {@link SharedResources.deckRuntime}.
 */
async function inlineDeckRuntime(
  doc: Document,
  manifest: Record<string, Resource>,
  uuid: string,
): Promise<boolean> {
  const resource = manifest[uuid];
  const bytes = fromBase64(resource.data);
  const source = new TextDecoder().decode(resource.compressed ? await gunzip(bytes) : bytes);

  const script = doc.createElement('script');
  // The runtime's usage comment contains a `</script>`, and a script element
  // ends at the first one of those wherever it appears. The escape is nothing
  // to JavaScript and everything to the parser that reads this string back.
  script.textContent = source.replace(/<\/script/gi, '<\\/script');
  doc.body.append(script);
  return true;
}

/** Removes the `<script>` elements that point at bundled JavaScript. */
function dropRuntimeScripts(doc: Document, manifest: Record<string, Resource>): number {
  let dropped = 0;
  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const uuid = firstUuid(script.getAttribute('src') ?? '');
    if (!uuid || !isScript(manifest[uuid])) continue;
    script.remove();
    dropped += 1;
  }
  return dropped;
}

/**
 * Cuts the bundled font set down to what the deck actually needs.
 *
 * Two things bloat it. A Japanese family arrives as ~120 `unicode-range`
 * slices, most of which cover characters the deck never shows; and Google Fonts
 * declares one rule per weight, so a variable family points four rules at the
 * same file — four copies of the same multi-megabyte data URL once inlined.
 * So: rules covering nothing in use are deleted, and rules that differ only in
 * weight are merged into one spanning the weights the deck declared. The file
 * already had to cover every one of them, since it already backed each rule.
 */
function subsetFontFaces(
  doc: Document,
  manifest: Record<string, Resource>,
): { fontsInlined: number; fontsDropped: number } {
  const used = usedCodePoints(doc);
  const kept = new Set<string>();
  let fontsDropped = 0;

  for (const style of Array.from(doc.querySelectorAll('style'))) {
    const text = style.textContent ?? '';
    const rules = text.match(FONT_FACE);
    if (!rules) continue;

    // One entry per rule, in order, so the rewrite below can consume them as
    // it walks the same matches again.
    const rewritten: string[] = [];
    const byVariant = new Map<string, number[]>();

    rules.forEach((rule, index) => {
      rewritten[index] = rule;
      const uuid = firstUuid(rule);
      if (!uuid || !isFont(manifest[uuid])) return;

      if (!covers(rule, used)) {
        rewritten[index] = '';
        fontsDropped += 1;
        return;
      }
      kept.add(uuid);

      const weight = weightOf(rule);
      if (weight === null) return;
      const variant = rule.replace(FONT_WEIGHT, '').replace(/\s+/g, ' ');
      byVariant.set(variant, [...(byVariant.get(variant) ?? []), index]);
    });

    for (const indexes of byVariant.values()) {
      if (indexes.length < 2) continue;
      const weights = indexes.map((index) => weightOf(rules[index]) as number);
      const span = `font-weight:${Math.min(...weights)} ${Math.max(...weights)};`;
      rewritten[indexes[0]] = rules[indexes[0]].replace(FONT_WEIGHT, span);
      for (const index of indexes.slice(1)) rewritten[index] = '';
    }

    let cursor = 0;
    style.textContent = text.replace(FONT_FACE, () => rewritten[cursor++]);
  }

  return { fontsInlined: kept.size, fontsDropped };
}

/** `normal` and `bold` are the only keywords; a range means it is already merged. */
function weightOf(rule: string): number | null {
  const declared = FONT_WEIGHT.exec(rule);
  if (!declared) return null;

  const value = declared[1].trim().toLowerCase();
  if (value === 'normal') return 400;
  if (value === 'bold') return 700;
  const weight = Number(value);
  return Number.isFinite(weight) ? weight : null;
}

/**
 * Every code point the deck renders, plus {@link TYPING_HEADROOM}. Style and
 * script text is excluded: it is ASCII machinery that would keep Latin subsets
 * alive for a deck that shows none.
 */
function usedCodePoints(doc: Document): Set<number> {
  const body = doc.body.cloneNode(true) as HTMLElement;
  for (const node of Array.from(body.querySelectorAll('style, script'))) node.remove();

  const points = new Set<number>();
  for (const character of `${body.textContent ?? ''}${TYPING_HEADROOM}`) {
    points.add(character.codePointAt(0) as number);
  }
  return points;
}

/** Whether a `@font-face` rule's `unicode-range` covers any code point in use. */
function covers(rule: string, used: Set<number>): boolean {
  const declared = /unicode-range:\s*([^;}]+)/i.exec(rule);
  // A face without a range covers everything, so it is always needed.
  if (!declared) return true;

  const ranges: [number, number][] = [];
  for (const part of declared[1].split(',')) {
    const span = /^u\+([0-9a-f]*)(\?*)(?:-([0-9a-f]+))?$/i.exec(part.trim());
    if (!span) continue;
    const [, start, wildcards, end] = span;
    const low = parseInt(start + '0'.repeat(wildcards.length), 16);
    const high = end ? parseInt(end, 16) : parseInt(start + 'f'.repeat(wildcards.length), 16);
    if (!Number.isNaN(low) && !Number.isNaN(high)) ranges.push([low, high]);
  }

  for (const point of used) {
    if (ranges.some(([low, high]) => point >= low && point <= high)) return true;
  }
  return false;
}

/** Resource uuids the surviving markup still refers to, scripts excluded. */
function neededResources(doc: Document, manifest: Record<string, Resource>): Set<string> {
  const needed = new Set<string>();
  const collect = (text: string) => {
    for (const uuid of text.match(UUID) ?? []) {
      const key = uuid.toLowerCase();
      const resource = manifest[key];
      if (resource && !isScript(resource)) needed.add(key);
    }
  };

  for (const style of Array.from(doc.querySelectorAll('style'))) collect(style.textContent ?? '');
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) collect(attribute.value);
  }
  return needed;
}

async function resolveResources(
  needed: Set<string>,
  manifest: Record<string, Resource>,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (const uuid of needed) {
    const resource = manifest[uuid];
    // Uncompressed entries are already base64 — the usual case for fonts and
    // images, and re-encoding them would be work for nothing.
    const data = resource.compressed
      ? toBase64(await gunzip(fromBase64(resource.data)))
      : resource.data;
    urls.set(uuid, `data:${resource.mime};base64,${data}`);
  }
  return urls;
}

function substituteResources(doc: Document, urls: Map<string, string>): void {
  const replace = (text: string) => text.replace(UUID, (uuid) => urls.get(uuid.toLowerCase()) ?? uuid);

  for (const style of Array.from(doc.querySelectorAll('style'))) {
    style.textContent = replace(style.textContent ?? '');
  }
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const replaced = replace(attribute.value);
      if (replaced !== attribute.value) element.setAttribute(attribute.name, replaced);
    }
  }
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  void writer.write(bytes);
  void writer.close();

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

function firstUuid(text: string): string | null {
  return text.match(UUID)?.[0]?.toLowerCase() ?? null;
}

function isFont(resource: Resource | undefined): boolean {
  return resource !== undefined && /^(font\/|application\/(x-)?font-)/i.test(resource.mime);
}

function isScript(resource: Resource | undefined): boolean {
  return resource !== undefined && /javascript|ecmascript/i.test(resource.mime);
}
