import { useEffect, useMemo, useRef, useState } from 'react';

import { execute, getActiveStage } from '../core/commands/engine';
import { SetInlineStyleCommand } from '../core/commands/element';
import { useDocumentStore } from '../core/document/store';
import { TEXT_TOOLS_ATTRIBUTE, useTextSession } from '../core/editing/richText';
import {
  CROP_RATIOS,
  cropToRatio,
  resetCrop,
  scalePicture,
  useCropSession,
} from '../core/editing/crop';
import { PAINTABLE_PROPERTIES } from '../core/editing/format';
import { fillSelectionFromPicker } from '../core/editing/imageFill';
import { MIN_SIZE, setGeometry, type GeometryField } from '../core/editing/geometry';
import { useSelectionStore } from '../core/selection/store';
import { boxOf, round } from '../stage/geometry';
import { useUiStore } from '../app/uiStore';
import { CollapsiblePanel, DisabledPanel, type Fold } from './CollapsiblePanel';
import { ColorPicker } from './ColorPicker';
import { Field } from './Field';
import { BorderColorIcon, FillIcon } from './icons';
import {
  type ElementKind,
  type PanelId,
  type PanelSlot,
  offeredPanels,
  panelsFor,
} from './inspectorLayout';
import { LiveNumberInput } from './LiveNumberInput';
import { isTransparent, parsePixels, toHex } from './styleValues';
import { TextFormatControls } from './TextFormatControls';
import { t, type MessageKey } from '../shared/i18n';

export function Inspector() {
  const mode = useUiStore((s) => s.mode);

  return (
    <aside className="inspector">
      {mode === 'edit' ? <ElementPanels /> : <p className="hint">{t('inspector.previewLocked')}</p>}
    </aside>
  );
}

/** PowerPoint offers exactly these outline kinds, and they cover what decks use. */
const BORDER_STYLES = [
  { value: 'none', labelKey: 'inspector.borderNone' },
  { value: 'solid', labelKey: 'inspector.borderSolid' },
  { value: 'dashed', labelKey: 'inspector.borderDashed' },
  { value: 'dotted', labelKey: 'inspector.borderDotted' },
] as const;

/** Clockwise from the top, the order CSS itself writes the sides in. */
const PADDING_SIDES = [
  { property: 'padding-top', labelKey: 'inspector.sideTop' },
  { property: 'padding-right', labelKey: 'inspector.sideRight' },
  { property: 'padding-bottom', labelKey: 'inspector.sideBottom' },
  { property: 'padding-left', labelKey: 'inspector.sideLeft' },
] as const;

/** Past this a padding is the layout rather than breathing room. */
const MAX_SPACING = 400;
/** Enough to round any box on a slide into a pill, and no more. */
const MAX_RADIUS = 400;

/** Shown until the read for the current element lands (one render). */
const EMPTY_STYLES: Record<string, string> = {};

/**
 * What each panel is called, in one place.
 *
 * A disabled panel is drawn without its contents, so the title cannot come from
 * inside the component that owns the rest of it — and a second table naming the
 * same five panels would be the same fact written twice. `Panel` reads this and
 * hands the title down, which is why the panel components take one.
 */
const PANEL_TITLES: Record<PanelId, MessageKey> = {
  geometry: 'inspector.geometry',
  image: 'inspector.image',
  text: 'inspector.textFormat',
  box: 'inspector.box',
  border: 'inspector.border',
};

/**
 * What would make a dark panel live again.
 *
 * Written as the way *out* rather than as the reason: "画像ではありません" only
 * restates what the user can already see selected, while "画像を選ぶと使えます"
 * is the one thing they could not have worked out from the screen.
 *
 * ボックス and 枠線 have no entry because they have no dark state — 余白 and
 * 塗り apply to every element there is, which is the same reason they were never
 * hidden by kind (inspectorLayout.ts).
 */
const PANEL_DISABLED_REASONS: Partial<Record<PanelId, MessageKey>> = {
  geometry: 'inspector.disabledGeometry',
  image: 'inspector.disabledImage',
  text: 'inspector.disabledText',
};

/**
 * What the panels read, which is not the same list as what the brush paints.
 *
 * `PAINTABLE_PROPERTIES` answers "what does this element's look consist of",
 * and the shorthands are the right answer there — pasting `padding` copies the
 * spacing whatever shape it has. A panel has the harder job of *showing* the
 * value in a field, and a shorthand comes back from `getComputedStyle` as a
 * four-value list the moment the sides differ (`10px 20px 10px 20px`), which no
 * single number field can hold. So the sides are read individually, exactly as
 * the outline already reads `border-top-*` for the same reason.
 */
const READ_PROPERTIES: readonly string[] = [
  ...PAINTABLE_PROPERTIES,
  ...PADDING_SIDES.map((side) => side.property),
  // The corners are not editable separately, so one of them stands for the box.
  // Reading the `border-radius` shorthand instead would hand the field
  // `8px 8px 0px 0px` on any deck that rounds only the top.
  'border-top-left-radius',
  // Read, never written — and deliberately not on the brush's list. The
  // alignment row needs it to say which physical side an unaligned element's
  // `start` is sitting on; a brush that carried it would re-flow
  // the text it was asked only to restyle.
  'direction',
];

/** What 単色 starts from on a box that had no fill. White reads as a fill on
 *  the dark and coloured slides decks actually use. */
const DEFAULT_FILL = '#ffffff';

/** Thin enough to read as an outline rather than a band, at slide scale. */
const DEFAULT_BORDER_WIDTH = 2;
/** Past this the border stops being an outline and starts being the layout. */
const MAX_BORDER_WIDTH = 64;

interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** Which box an outline edit is for, and what it looked like when it started. */
interface BorderTarget {
  uid: string;
  style: string;
  color: string;
  width: number;
}

function ElementPanels() {
  const uid = useSelectionStore((s) => s.uid);
  const ancestry = useSelectionStore((s) => s.ancestry);
  const select = useSelectionStore((s) => s.select);
  const focusOn = useSelectionStore((s) => s.focusOn);
  const revision = useDocumentStore((s) => s.project.meta.updatedAt);
  // Tagged with the element it was read from. The read happens in an effect,
  // so the render that first shows a newly selected box still holds the
  // previous one's values — harmless for a field that is about to be
  // overwritten, but not for one that remembers what it was given.
  const [read, setRead] = useState<{
    uid: string;
    values: Record<string, string>;
  } | null>(null);
  // Named for what it is rather than for the panel that shows it: `setGeometry`
  // is the *edit*, and a state setter of the same name reading the other way
  // would be one letter of difference away from writing to the wrong one.
  const [box, setBox] = useState<Geometry>({ x: 0, y: 0, width: 0, height: 0, rotation: 0 });

  // Re-read after every commit: a drag or an undo changes the element without
  // the selection ever changing.
  useEffect(() => {
    const stage = getActiveStage();
    const element = uid ? (stage?.resolve(uid) as HTMLElement | null) : null;
    if (!element || !uid) {
      setRead(null);
      return;
    }

    const view = element.ownerDocument.defaultView;
    if (view) {
      const computed = view.getComputedStyle(element);
      const next: Record<string, string> = {};
      for (const property of READ_PROPERTIES) {
        next[property] = computed.getPropertyValue(property).trim();
      }
      setRead({ uid, values: next });
    }

    const measured = boxOf(element);
    setBox({
      x: round(measured.cx - measured.width / 2),
      y: round(measured.cy - measured.height / 2),
      width: round(measured.width),
      height: round(measured.height),
      rotation: round(measured.rotation),
    });
  }, [uid, revision]);

  // A preview must not outlive the breadcrumb that asked for it.
  useEffect(() => () => focusOn(null), [focusOn]);

  const folds = useUiStore((s) => s.inspectorPanels);
  const setFold = useUiStore((s) => s.setInspectorPanel);
  // The same test 文字書式 uses one component down (`TextPanel`), so the column
  // and the controls inside it can never disagree about whether a session is
  // open. `uid` is checked first because both sides are null
  // when nothing is selected, and `null === null` would read as "editing".
  const sessionUid = useTextSession((s) => s.uid);
  const inTextSession = uid !== null && sessionUid === uid;

  // Which panels there are, in what order — read during render rather than in
  // the effect above. The style read can afford to land a render late, because
  // the fields it fills are about to be overwritten either way; the *list of
  // panels* cannot, or every selection change would draw the previous
  // element's column for one frame. Re-read on `revision` for the same reason
  // トリミング always has: wrapping a picture in a frame is itself an edit, and
  // undoing it turns the selection back into a plain <img>.
  //
  // And re-read when a session opens or closes, which is a third way the answer
  // moves without either of the other two budging. Typing is the case: it puts
  // words into a box that had none and takes them out again, and it commits
  // nothing until the session ends, so `revision` sits still through all of it
  // while `isTextEditable` changes its mind underneath. The selection does not
  // move either — it is the same box throughout.
  const layout = useMemo(
    () => offeredPanels(uid, uid ? (getActiveStage()?.resolve(uid) ?? null) : null),
    [uid, revision, inTextSession],
  );

  if (!uid) return <p className="hint">{t('inspector.noSelection')}</p>;

  const styles = read?.uid === uid ? read.values : EMPTY_STYLES;

  return (
    <>
      {/* Not one of the folds. It says where you are rather than offering
          anything to edit, and folding it away would take with it the only
          route back out of a nested selection. */}
      <section className="panel fixed">
        <h2>{t('inspector.selection')}</h2>
        {/* Pointing at a crumb outlines that ancestor on the stage. The labels
            alone (`div.container`) rarely say which box they mean in a deck
            full of wrappers, so the answer has to be shown, not read. Keyboard
            focus counts as pointing: the crumbs are buttons in the tab order. */}
        <nav className="breadcrumb" onPointerLeave={() => focusOn(null)}>
          {ancestry.map((step) => (
            <button
              key={step.uid}
              className={step.uid === uid ? 'crumb current' : 'crumb'}
              onClick={() => select(step.uid)}
              onPointerEnter={() => focusOn(step.uid)}
              onFocus={() => focusOn(step.uid)}
              onBlur={() => focusOn(null)}
            >
              {step.label}
            </button>
          ))}
        </nav>
      </section>

      {/* The order, the initial folds and which of them are live all come from
          the table, not from the order these are written in — see
          inspectorLayout.ts. Every panel appears exactly once for every
          element, so a panel cannot go missing by being forgotten here. */}
      {panelsFor(layout.kind, layout.enabled, folds, inTextSession).map((slot) => (
        <Panel
          key={slot.id}
          slot={slot}
          kind={layout.kind}
          uid={uid}
          styles={styles}
          geometry={box}
          fold={{ open: slot.open, onToggle: (open) => setFold(slot.id, open) }}
        />
      ))}
    </>
  );
}

/**
 * The one place that turns a `PanelId` back into the panel it names.
 *
 * A dark slot never reaches the switch. That is the point of deciding it here
 * rather than inside each panel: the components below all read something on
 * mount — the crop session, the element's computed font — and a panel nobody
 * can open has no business doing either. What is drawn instead is a summary
 * that says what would bring it back.
 */
function Panel({
  slot,
  kind,
  uid,
  styles,
  geometry,
  fold,
}: {
  slot: PanelSlot;
  kind: ElementKind;
  uid: string;
  styles: Record<string, string>;
  geometry: Geometry;
  fold: Fold;
}) {
  const title = t(PANEL_TITLES[slot.id]);

  if (!slot.enabled) {
    const reason = PANEL_DISABLED_REASONS[slot.id];
    // Every panel that can go dark has a reason in the table. A panel that
    // somehow arrives dark without one still draws rather than throwing — the
    // title alone is worse than the title plus a sentence, and better than a
    // hole in the column.
    return <DisabledPanel title={title} reason={reason ? t(reason) : ''} />;
  }

  switch (slot.id) {
    case 'geometry':
      return <GeometryPanel title={title} uid={uid} geometry={geometry} fold={fold} />;
    // 画像 is live for a picture and for a box a picture can go into, and the
    // two have nothing to offer each other: トリミング needs a photo to act on,
    // 画像を入れる only makes sense while there is not one. The kind is what
    // tells them apart, and it is decided in one place (inspectorLayout.ts) so
    // that the panel cannot reach a different answer than the column did.
    case 'image':
      return kind === 'image' ? (
        <CropPanel title={title} uid={uid} fold={fold} />
      ) : (
        <FillPanel title={title} fold={fold} />
      );
    case 'text':
      return <TextPanel title={title} uid={uid} styles={styles} fold={fold} />;
    case 'box':
      return <BoxPanel title={title} uid={uid} styles={styles} fold={fold} />;
    case 'border':
      return <BorderPanel title={title} uid={uid} styles={styles} fold={fold} />;
  }
}

/** Fill, spacing and opacity: what the box itself looks like, as opposed to
 *  where it is (位置とサイズ) or what edges it draws (枠線). */
function BoxPanel({
  title,
  uid,
  styles,
  fold,
}: {
  title: string;
  uid: string;
  styles: Record<string, string>;
  fold: Fold;
}) {
  return (
    <CollapsiblePanel title={title} fold={fold}>
      {/* Keyed on the element: what these two remember (the colour picked
          before a trip through 透明, whether the sides are expanded) belongs
          to the box being edited, not to the panel. The keys are prefixed
          because they are siblings — two children of one parent keyed on the
          same uid is a duplicate key, which React leaves free to drop one. */}
      <BackgroundField key={`fill-${uid}`} uid={uid} value={styles['background-color']} />
      <SpacingFields key={`spacing-${uid}`} uid={uid} styles={styles} />
      <Field label={t('inspector.opacity')}>
        {(id) => (
          <input
            id={id}
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={styles['opacity'] || '1'}
            onChange={(e) => execute(new SetInlineStyleCommand(uid, { opacity: e.target.value }))}
          />
        )}
      </Field>
    </CollapsiblePanel>
  );
}

/**
 * The 文字書式 panel, and the container that shields it.
 *
 * The container is what carries `data-hse-text-tools` — the marker for "a click
 * here must not end the text session" belongs to the region of host UI, not to
 * the controls inside it.
 *
 * It also owns the hint, because the hint is the only thing that explains why
 * half the panel is missing outside a session: without it, a user who saw B and
 * 箇条書き once would read their absence as a bug rather than as "double-click
 * first".
 *
 * And it owns putting itself on screen when a session opens. `panelsFor` has
 * already done the two things that can be decided from a table — the panel
 * leads the column and arrives expanded — and neither of them helps if the pane
 * is still scrolled to where the user left it. The column is six blocks tall
 * and the pane is 280px wide by default, so 文字書式 expanded is easily taller
 * than the window: a user who had scrolled down to 枠線 before double-clicking
 * gets a session whose controls are above the fold, off the top.
 *
 * `block: 'nearest'` rather than `'start'` because the common case is the panel
 * being *already* visible, and 'nearest' is defined to do nothing then. Scroll
 * that fires when nothing needed to move is the kind of motion that reads as a
 * glitch, and it would fire on every double-click.
 */
function TextPanel({
  title,
  uid,
  styles,
  fold,
}: {
  title: string;
  uid: string;
  styles: Record<string, string>;
  fold: Fold;
}) {
  const inSession = useTextSession((s) => s.uid) === uid;
  const container = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (!inSession) return;
    // Mount counts: for a box that had no words a moment ago — the one just
    // inserted — this component did not exist until the session made 文字書式
    // live, so the session opening and the panel appearing are the same commit.
    // Nothing is scrolled back on the way out: the session ends where the user
    // left off, and moving the pane under them once they have stopped typing
    // would be motion they did not ask for.
    container.current?.scrollIntoView({ block: 'nearest' });
  }, [inSession]);

  return (
    <CollapsiblePanel
      title={title}
      fold={fold}
      containerRef={container}
      attributes={{ [TEXT_TOOLS_ATTRIBUTE]: '' }}
    >
      <p className="hint small">
        {t(inSession ? 'inspector.textFormatHintRange' : 'inspector.textFormatHint')}
      </p>
      <TextFormatControls uid={uid} styles={styles} />
    </CollapsiblePanel>
  );
}

/**
 * 画像 for a box that has no picture in it: the one route that puts one there.
 *
 * The box this is most often wanted on is the photo frame an imported deck
 * draws where its `<image-slot>` used to be. That frame arrives as plain markup
 * with nothing behind it — the component's own drop handler belongs to a
 * runtime the import has to drop (core/editing/imageFill.ts) — so
 * this button is what the frame's 「写真添付エリア」 caption now means.
 *
 * No uid: `fillWithImage` reads the selection itself, the way every other
 * element operation does (core/editing/actions.ts). Handing it one from here
 * would be a second opinion about what is selected.
 *
 * The hint is not optional. A button that replaces what the box holds has to
 * say so before it is pressed, not only afterwards in the undo tooltip.
 */
function FillPanel({ title, fold }: { title: string; fold: Fold }) {
  return (
    <CollapsiblePanel title={title} fold={fold}>
      <div className="format-row">
        <button onClick={() => void fillSelectionFromPicker()}>
          {t('inspector.fillWithImage')}
        </button>
      </div>
      <p className="hint small">{t('inspector.fillHint')}</p>
    </CollapsiblePanel>
  );
}

/**
 * Trimming: the panel a picture gets, whether or not a frame is open on it.
 *
 * The panel is the keyboard-and-mouse route into the same session double-click
 * opens, plus the operations that have no gesture: a ratio, the two ways of
 * scaling the picture to its frame, and giving the whole picture back. All four
 * act on the frame that is currently open — so outside one they are drawn
 * disabled rather than not drawn, which is what stops 「トリミング」 from
 * looking like the only thing this panel does.
 *
 * The hint is the piece that tells the two states apart, the same way 文字書式
 * switches its own: a row of greyed buttons with nothing to explain them reads
 * as broken, and the one thing the screen cannot say is what to press first.
 */
function CropPanel({ title, uid, fold }: { title: string; uid: string; fold: Fold }) {
  const target = useCropSession((s) => s.target);
  const start = useCropSession((s) => s.start);
  const stop = useCropSession((s) => s.stop);

  // Whether this panel is live at all is decided by `isCroppable`, one level up
  // in the layout (inspectorLayout.ts) — so a picture that stops being one is
  // handled by the panel going dark rather than by a second test in here. This
  // is the narrower question of whether a frame is currently open on it.
  const open = target?.frameUid === uid;
  // Both halves are checked so the handlers below can use `target` without a
  // second guard: `open` is already false whenever it is null.
  const idle = !open || !target;
  const why = (name: string) => (idle ? t('inspector.cropDisabled', { name }) : name);

  return (
    <CollapsiblePanel title={title} fold={fold}>
      <div className="format-row">
        <button className={open ? 'active' : ''} onClick={() => (open ? stop() : start())}>
          {open ? t('inspector.cropEnd') : t('menu.crop')}
        </button>
      </div>

      <p className="hint small">{t(idle ? 'inspector.cropHintIdle' : 'inspector.cropHint')}</p>
      <Field label={t('inspector.aspectRatio')}>
        <div className="segmented">
          {CROP_RATIOS.map(({ label, ratio }) => (
            <button
              key={label}
              disabled={idle}
              title={why(label)}
              onClick={() => target && cropToRatio(target, ratio)}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('inspector.fitToFrame')}>
        <div className="segmented">
          <button
            disabled={idle}
            title={why(t('inspector.fill'))}
            onClick={() => target && scalePicture(target, 'fill')}
          >
            {t('inspector.fill')}
          </button>
          <button
            disabled={idle}
            title={why(t('inspector.fit'))}
            onClick={() => target && scalePicture(target, 'fit')}
          >
            {t('inspector.fit')}
          </button>
        </div>
      </Field>
      <div className="format-row">
        <button
          disabled={idle}
          title={why(t('inspector.resetImage'))}
          onClick={() => target && resetCrop(target)}
        >
          {t('inspector.resetImage')}
        </button>
      </div>
    </CollapsiblePanel>
  );
}

/**
 * The fill, the way a slide tool offers it: 透明 or 単色, then the colour.
 *
 * The kind has to come first because a colour input cannot express "no fill".
 * A box without one computes to `rgba(0, 0, 0, 0)`, which the swatch could only
 * show as black — so the panel used to claim every unfilled box was filled with
 * black, and the first colour picked looked like a change of shade rather than
 * a fill being added. The segmented control states which of the two it is, and
 * the swatch is only the colour for 単色.
 *
 * 「透明」 and 「解除」 are different, for the same reason as the outline's
 * 「なし」 and 「解除」: the deck's own CSS may be painting the fill, so 透明
 * writes `transparent` as an override that beats it, while 解除 drops the
 * inline declaration and returns the box to the deck's look.
 */
function BackgroundField({ uid, value }: { uid: string; value: string | undefined }) {
  const transparent = isTransparent(value);
  // What 単色 goes back to. Held here so a trip through 透明 does not lose the
  // colour that was picked — the element no longer carries it once it is off.
  const [color, setColor] = useState(() => (transparent ? DEFAULT_FILL : toHex(value)));

  useEffect(() => {
    if (!transparent) setColor(toHex(value));
  }, [transparent, value]);

  const apply = (next: string) =>
    execute(new SetInlineStyleCommand(uid, { 'background-color': next }));

  return (
    <Field label={t('inspector.background')}>
      <div className="segmented">
        <button className={transparent ? 'active' : ''} onClick={() => apply('transparent')}>
          {t('inspector.transparent')}
        </button>
        <button className={transparent ? '' : 'active'} onClick={() => apply(color)}>
          {t('inspector.solid')}
        </button>
      </div>
      {/* Picking a colour is a request for a fill, as in PowerPoint's colour
          menu, so it switches the box to 単色 rather than doing nothing while
          the fill is off. The apply half of the split button says the same
          thing for the colour already loaded, which is what 単色 above does —
          they agree because both write the same declaration. */}
      <ColorPicker
        color={color}
        icon={FillIcon}
        applyLabel={t('inspector.backgroundApply')}
        paletteLabel={t('inspector.backgroundPalette')}
        onPick={(next) => {
          setColor(next);
          apply(next);
        }}
      />
      <button className="link" onClick={() => apply('')}>
        {t('inspector.reset')}
      </button>
    </Field>
  );
}

/**
 * Padding and corner radius, as plain numbers with the unit in the interface.
 *
 * Both used to be text fields holding raw CSS, which asked the user to know
 * that `px` was required and showed them `10px 20px 10px 20px` whenever the
 * sides differed — a value no one could edit sensibly. The unit
 * moved to a `.unit` label beside the box, and the field takes a number.
 *
 * **All four sides are written every time, even when one changed.** That is
 * what keeps a run of keystrokes inside one undo step: `SetInlineStyleCommand`
 * only merges commands whose property sets match, so writing `padding-left`
 * alone would end the run the moment the user moved to another side — and
 * moving between 一括 and 辺ごと would end it too.
 *
 * The radius is one number by design (the corners are not offered separately),
 * so it is written as the shorthand and read from one corner.
 */
function SpacingFields({ uid, styles }: { uid: string; styles: Record<string, string> }) {
  const properties = PADDING_SIDES.map((side) => side.property);
  const sides = sidesOf(styles, properties);
  // Only ever a request to *see* the sides. A box whose sides already differ
  // has no single number to fold them into, so it opens expanded and cannot be
  // collapsed until they agree — collapsing would flatten three sides the user
  // never looked at.
  const [expanded, setExpanded] = useState(false);
  const perSide = expanded || sides.uniform === null;

  const writeSides = (values: number[]) =>
    execute(new SetInlineStyleCommand(uid, paddingStyle(values), t('command.setPadding')));

  const radius = parsePixels(styles['border-top-left-radius']) ?? 0;

  return (
    <>
      <Field label={t('inspector.padding')}>
        {!perSide && (
          <LiveNumberInput
            className="spacing-number"
            value={sides.uniform ?? 0}
            min={0}
            max={MAX_SPACING}
            onApply={(next) => writeSides([next, next, next, next])}
          />
        )}
        <span className="unit">px</span>
        {perSide ? (
          sides.uniform !== null && (
            <button className="link" onClick={() => setExpanded(false)}>
              {t('inspector.paddingUniform')}
            </button>
          )
        ) : (
          <button className="link" onClick={() => setExpanded(true)}>
            {t('inspector.paddingPerSide')}
          </button>
        )}
      </Field>
      {perSide && (
        <div className="grid-2">
          {PADDING_SIDES.map((side, i) => (
            <label className="field compact" key={side.property}>
              <span>{t(side.labelKey)}</span>
              <LiveNumberInput
                value={sides.values[i] ?? 0}
                min={0}
                max={MAX_SPACING}
                onApply={(next) => writeSides(sides.values.map((was, j) => (j === i ? next : was)))}
              />
            </label>
          ))}
        </div>
      )}
      <Field label={t('inspector.radius')}>
        {(id) => (
          <>
            <LiveNumberInput
              id={id}
              className="spacing-number"
              value={radius}
              min={0}
              max={MAX_RADIUS}
              onApply={(next) =>
                execute(
                  new SetInlineStyleCommand(
                    uid,
                    { 'border-radius': `${next}px` },
                    t('command.setRadius'),
                  ),
                )
              }
            />
            <span className="unit">px</span>
          </>
        )}
      </Field>
    </>
  );
}

/**
 * The shape outline, the way a slide tool offers it: kind, colour, thickness.
 *
 * Written as the three longhands rather than the `border` shorthand. The
 * shorthand also resets `border-image`, which a deck may well be using, and
 * this editor only overrides what the user asked to change.
 *
 * Every field writes all three at once, because the parts are not independent:
 * a colour on its own is invisible while the style is `none`, and a deck whose
 * own CSS draws no border computes to width 0, so switching to 実線 alone would
 * do nothing visible. One write is also one undo step, which is what the user
 * means by "枠線を付けた".
 *
 * Every field also applies as it is used — dragging the thickness slider grows
 * the outline on the slide while the pointer is still down. `tryMerge` keeps
 * the whole adjustment to a single undo step.
 */
function BorderPanel({
  title,
  uid,
  styles,
  fold,
}: {
  title: string;
  uid: string;
  styles: Record<string, string>;
  fold: Fold;
}) {
  const current: BorderTarget = {
    uid,
    style: styles['border-top-style'] || 'none',
    color: toHex(styles['border-top-color']),
    width: Math.round(parseFloat(styles['border-top-width'] || '0')) || 0,
  };
  const { style, color, width } = current;

  const write = (next: { style?: string; color?: string; width?: number }) => {
    const on = current;
    // Only 「なし」 itself means "no outline". Picking a colour or a thickness for
    // a box that has none is a request for one, the way PowerPoint's colour and
    // weight menus turn the line on — otherwise those fields would silently do
    // nothing on every box whose deck CSS draws no border.
    const kind = next.style ?? (on.style === 'none' ? 'solid' : on.style);
    if (kind === 'none') {
      // Explicit, not a removal: the deck's own CSS may be drawing the border,
      // and 「なし」 has to win over it. 解除 is the way back to the deck's look.
      execute(new SetInlineStyleCommand(on.uid, { 'border-style': 'none' }));
      return;
    }
    execute(
      new SetInlineStyleCommand(on.uid, {
        'border-style': kind,
        'border-color': next.color ?? on.color,
        'border-width': `${next.width ?? on.width ?? DEFAULT_BORDER_WIDTH}px`,
      }),
    );
  };

  return (
    <CollapsiblePanel title={title} fold={fold}>
      <Field label={t('inspector.borderStyle')}>
        <div className="segmented">
          {BORDER_STYLES.map((kind) => (
            <button
              key={kind.value}
              className={style === kind.value ? 'active' : ''}
              onClick={() =>
                write({
                  style: kind.value,
                  // Turning an outline on has to make one appear, so a deck
                  // that draws none gets a visible thickness rather than 0.
                  width: width || DEFAULT_BORDER_WIDTH,
                })
              }
            >
              {t(kind.labelKey)}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('inspector.color')}>
        {/* No `id` to hand out: the split button is two buttons rather than one
            input, and each carries its own `aria-label` — the same shape 文字色
            has. A `<label for>` pointing at either half would name the wrong
            one. */}
        <ColorPicker
          color={color}
          icon={BorderColorIcon}
          applyLabel={t('inspector.borderColorApply')}
          paletteLabel={t('inspector.borderColorPalette')}
          onPick={(next) => write({ color: next, width: width || DEFAULT_BORDER_WIDTH })}
        />
      </Field>
      <Field label={t('inspector.weight')}>
        {/* The slider is the point: dragging it grows the outline on the slide
            under the pointer, which is the only way to judge a thickness. The
            number beside it is for the exact value. */}
        <input
          className="width-range"
          type="range"
          min="0"
          max={MAX_BORDER_WIDTH}
          step="1"
          value={Math.min(MAX_BORDER_WIDTH, width)}
          onChange={(e) => write({ width: Number(e.target.value) })}
        />
        <LiveNumberInput
          className="width-number"
          value={width}
          min={0}
          max={MAX_BORDER_WIDTH}
          onApply={(next) => write({ width: next })}
        />
        <span className="unit">px</span>
      </Field>
      <div className="panel-reset">
        <button
          className="link"
          onClick={() =>
            execute(
              new SetInlineStyleCommand(uid, {
                'border-style': '',
                'border-color': '',
                'border-width': '',
              }),
            )
          }
        >
          {t('inspector.reset')}
        </button>
      </div>
    </CollapsiblePanel>
  );
}

/**
 * Numeric position and size, the way a slide tool shows them. Writing here
 * moves the element by adjusting the editor's own translate offset rather than
 * its layout properties, exactly as dragging does (`core/editing/geometry.ts`).
 *
 * Every field lands as it is typed, like every other number in this panel. It
 * was the last one that did not: it committed on blur or Enter, so the stage
 * stood still while the number was being chosen and the spinner arrows — the
 * obvious way to close in on a position — did nothing until focus left. What
 * makes that affordable is the folding in
 * `StyleSnapshotCommand`, which keeps a run of keystrokes to one undo step.
 */
function GeometryPanel({
  title,
  uid,
  geometry,
  fold,
}: {
  title: string;
  uid: string;
  geometry: Geometry;
  fold: Fold;
}) {
  return (
    <CollapsiblePanel title={title} fold={fold}>
      <div className="grid-2">
        {/* X / Y / 回転 take any number: an element may sit off the slide, and
            a negative angle is a rotation the other way. Only the sizes have a
            floor, and it is the one `setGeometry` enforces anyway. */}
        <GeometryField uid={uid} label="X" field="x" value={geometry.x} />
        <GeometryField uid={uid} label="Y" field="y" value={geometry.y} />
        <GeometryField
          uid={uid}
          label={t('inspector.width')}
          field="width"
          value={geometry.width}
          min={MIN_SIZE}
        />
        <GeometryField
          uid={uid}
          label={t('inspector.height')}
          field="height"
          value={geometry.height}
          min={MIN_SIZE}
        />
        <GeometryField
          uid={uid}
          label={t('inspector.rotation')}
          field="rotation"
          value={geometry.rotation}
        />
      </div>
    </CollapsiblePanel>
  );
}

/**
 * One cell of the 位置とサイズ grid.
 *
 * `.field.compact` keeps its `<label>` wrapper: the row holds a single input,
 * so the implicit association has nothing else to hand the click to. `whole`
 * is off because these five are the only fields showing a
 * *measurement* — `round()` keeps two decimals — and rounding a typed 22.5°
 * would refuse a value the field itself displays.
 */
function GeometryField({
  uid,
  label,
  field,
  value,
  min,
}: {
  uid: string;
  label: string;
  field: GeometryField;
  value: number;
  min?: number;
}) {
  return (
    <label className="field compact">
      <span>{label}</span>
      <LiveNumberInput
        value={value}
        min={min}
        whole={false}
        onApply={(next) => setGeometry(uid, field, next)}
      />
    </label>
  );
}

/** The four sides, and the single number that stands for them when they agree. */
export interface Sides {
  values: number[];
  /** null when the sides differ — no one field can show them. */
  uniform: number | null;
}

/**
 * Reads the sides individually and asks whether one number can speak for them.
 *
 * A deck whose sides differ has to be *shown* that they differ: offering the
 * single field anyway would mean the first keystroke silently flattened three
 * sides the user never looked at.
 */
export function sidesOf(styles: Record<string, string>, properties: readonly string[]): Sides {
  const values = properties.map((property) => parsePixels(styles[property]) ?? 0);
  const first = values[0] ?? 0;
  return { values, uniform: values.every((value) => value === first) ? first : null };
}

/**
 * What a padding edit writes: all four sides, never only the one that changed.
 *
 * `SetInlineStyleCommand.tryMerge` folds two commands only when their property
 * sets match, so writing the edited side alone would end the undo run every
 * time the user moved to another side — or between 一括 and 辺ごと. Four
 * declarations every time is what makes a whole adjustment one undo step.
 */
export function paddingStyle(values: number[]): Record<string, string> {
  return Object.fromEntries(
    PADDING_SIDES.map((side, i) => [side.property, `${values[i] ?? 0}px`]),
  );
}

