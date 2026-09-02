import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';

import { execute } from '../core/commands/engine';
import { SetInlineStyleGroupCommand } from '../core/commands/element';
import { alignElement, listTargets } from '../core/editing/listOverrides';
import {
  activeTextSession,
  applyInlineFormat,
  commitTextSession,
  createLink,
  hasSessionRange,
  onBeforeSessionEnd,
  setFontFamily,
  setFontSize,
  setFontWeight,
  setHighlight,
  setTextColor,
  useCaretStyle,
  useFormatState,
  useTextSession,
} from '../core/editing/richText';
import { DEFAULT_FONT_STACK, matchFontStack, usableFonts, type FontGroup } from '../shared/fonts';
import { t } from '../shared/i18n';
import { ColorPicker } from './ColorPicker';
import { Field } from './Field';
import { LinkDialog } from './LinkDialog';
import { LiveNumberInput } from './LiveNumberInput';
import { HighlightIcon, TextColorIcon } from './icons';
import { normalizeWeight, parsePixels, shownAlign, toHex } from './styleValues';

/**
 * What the fields show while no session is open, kept outside the component.
 *
 * The inspector drops its panels whenever nothing is selected, so local state
 * would reset every time the user clicked away and back.
 *
 * It used to be a *draft* — the last thing picked, held because applying to a
 * range leaves the element's own computed value untouched, so a field reading
 * the element would snap back to the box's font the instant it was used on
 * three words inside it. That is no longer why it exists. Inside a session the
 * fields read the caret instead (`useCaretStyle`), which answers the range
 * question properly, and out of one the element's computed style is simply the
 * truth: element scope writes to the element, so what is read back is what was
 * written. What is left here is a place for that reading to sit between the
 * render that changes the selection and the effect one step later that
 * measures it — without it every click on a new box would blank the fields for
 * a frame.
 */
/**
 * The colour the highlighter is loaded with.
 *
 * It used to live in an uncontrolled input's `defaultValue`, so the pen forgot
 * its colour whenever the panel came back — and picking this very yellow, the
 * one already sitting in the box, changed no value and therefore fired nothing
 * at all.
 */
const DEFAULT_HIGHLIGHT = '#ffe066';

interface TextFormatDraft {
  size: number;
  font: string;
  color: string;
  highlight: string;
  setSize(size: number): void;
  setFont(font: string): void;
  setColor(color: string): void;
  setHighlightColor(color: string): void;
}

const useTextFormatDraft = create<TextFormatDraft>((set) => ({
  size: 28,
  font: DEFAULT_FONT_STACK,
  color: '#14161a',
  highlight: DEFAULT_HIGHLIGHT,
  setSize(size) {
    set({ size });
  },
  setFont(font) {
    set({ font });
  },
  setColor(color) {
    set({ color });
  },
  // Not `setHighlight`: that is the frame-side command this value gets handed
  // to, and both names are in scope in this file.
  setHighlightColor(color) {
    set({ highlight: color });
  },
}));

/**
 * The toggles, and the reason they are a list rather than five hand-written
 * buttons: everything about being lit — the class, `aria-pressed`, the title
 * that says it is on — is written once here. 上付き sat outside this list with
 * none of it, so it was the one format that never showed whether it was on.
 */
const FORMAT_BUTTONS = [
  { command: 'bold', label: 'B', titleKey: 'text.bold' },
  { command: 'italic', label: 'I', titleKey: 'text.italic' },
  { command: 'underline', label: 'U', titleKey: 'text.underline' },
  { command: 'strikeThrough', label: 'S', titleKey: 'text.strikeThrough' },
  { command: 'superscript', label: 'x²', titleKey: 'text.superscript' },
] as const;

/** Small enough for a caption, large enough for a title slide's one word. */
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 200;

/** The weights a variable or multi-cut family actually ships, coarse to bold. */
const WEIGHTS = ['300', '400', '500', '600', '700', '800', '900'];

/**
 * What a `<select>` in this panel carries when the selection has no one answer.
 *
 * `''` could not be it. The font menu already offers the empty string as 指定なし,
 * which is a value the user may pick and this panel may write; "two fonts are
 * selected and I cannot name one" is a different statement and must not be
 * confusable with it — least of all by being *pickable*, which would silently
 * strip the family off the run. So the sentinel is a string no stack and no
 * weight can be, and the option that carries it is disabled and hidden: it
 * shows in the closed control and is absent from the list that drops down.
 */
const MIXED = '*mixed*';

/** The two ways a run of text can be listed, as one either-or control. */
const LISTS = [
  { command: 'insertUnorderedList', labelKey: 'text.bulletList' },
  { command: 'insertOrderedList', labelKey: 'text.numberedList' },
] as const;

/**
 * Written as CSS values, because that is what the current one is compared to.
 *
 * `justify` used to be the fourth. It was offered and it was written, but on
 * the sample deck not one of the twelve text boxes moved a pixel by it: a
 * justified line only has slack to distribute when the text wraps, and a slide
 * is made of lines that do not. `text-align-last` would have moved
 * them, by spreading four characters across the whole box — which is 均等割り付け,
 * not the 両端 the button was labelled.
 *
 * The value still travels: a deck that justifies its own text keeps doing so,
 * and `listAlignmentStyle` still has a road for it (core/editing/listOverrides.ts).
 * What is gone is only the button that wrote it.
 */
const ALIGNMENTS = [
  { value: 'left', labelKey: 'inspector.alignLeft' },
  { value: 'center', labelKey: 'inspector.alignCenter' },
  { value: 'right', labelKey: 'inspector.alignRight' },
] as const;

/**
 * Text formatting for the selected element, or for the range inside it.
 *
 * It used to be split in two: these controls formatted the caret's selection,
 * and a second panel below wrote the same three properties onto the element.
 * They read as duplicates because they looked identical, so the
 * second one is gone and the scope is chosen from what the user is doing —
 * a range if one is open, the whole box otherwise, which is how every slide
 * tool behaves.
 *
 * `data-hse-text-tools` belongs on whatever *contains* this, not on this: the
 * attribute marks a region of the host UI, which is not this component's to
 * know about.
 */
export function TextFormatControls({
  uid,
  styles,
}: {
  uid: string;
  styles: Record<string, string>;
}) {
  const { size, font, color, highlight, setSize, setFont, setColor, setHighlightColor } =
    useTextFormatDraft();
  // What is already on at the caret. A deck's own heading is usually bold, so
  // without this the B button looks like "make bold" while it would strip the
  // weight the deck gave the text.
  const active = useFormatState();
  // And what the caret is *standing in*, for the three fields that show a value
  // rather than a yes/no. `queryCommandState` cannot answer those, so they used
  // to be seeded once per element from the box's computed style and then sat
  // still: with one word blown up to 200px, the field still read 200 with the
  // caret back among the 64px text, and the next number typed there resized the
  // wrong run. Subscribed whole rather than through three selectors because the
  // store publishes the same object until a value actually differs
  // (`refreshFormatState`), so this re-renders exactly when a field changes.
  const caret = useCaretStyle();
  // Whether the controls below that only act on a *range* have anything to act
  // on. They are drawn either way and greyed out when there is nothing — the
  // pane says what the editor can do, and a control that vanishes leaves the
  // user to remember it existed. The hint above them is what
  // says which of the two states this is, and what to press to change it.
  const inSession = useTextSession((s) => s.uid) === uid;
  /** A control's tooltip, with the way back to using it when it is grey. */
  const rangeTitle = (name: string) => (inSession ? name : t('text.rangeOnly', { name }));
  // Whether リンク is currently asking for an address. Local state, unlike the
  // draft above: there is nothing to remember between two presses, and a dialog
  // that came back open on the next element would be one nobody asked for.
  const [linking, setLinking] = useState(false);

  // A session that ended while the dialog was up leaves it with no range to
  // attach to, so it goes away with the session rather than staying open over
  // an element that is no longer being edited. It ends for reasons this
  // component cannot see — Escape reaches EditStage's capture listener before
  // ModalShell's, and a click on the canvas closes it outright — which is why
  // this watches the session instead of every one of those paths closing the
  // dialog on its way past.
  useEffect(() => {
    if (!inSession) setLinking(false);
  }, [inSession]);

  // What the element looks like, for the fields to show while nothing narrower
  // is being pointed at.
  //
  // Re-read on every measurement rather than once per element, which is what a
  // `seeded.current === uid` ref used to enforce. The ref was there for the
  // range case — a size applied to three words leaves the box's own computed
  // style alone, so re-reading it would snap the field back — and `inSession`
  // now draws that line exactly, one state earlier and without a ref to keep in
  // step with the uid. Outside a session every write goes to the element, so
  // what is read back is what was written and re-reading is simply right.
  useEffect(() => {
    // The computed read happens in an effect one step behind the selection, so
    // the first render for a new element is handed an empty set (Inspector's
    // `read.uid === uid` guard). Seeding from that would put every box on the
    // deck at 28px — and blanking the fields for a frame on every click, which
    // is why the previous element's values stay put until the real ones land.
    const family = styles['font-family'];
    if (!family || inSession) return;

    const px = parsePixels(styles['font-size']);
    if (px !== null) setSize(Math.round(px));
    setFont(matchFontStack(family) ?? '');
    setColor(toHex(styles['color']));
    // The highlighter is left out on purpose. An element has no "current
    // highlight" to read — its `background-color` is the box's own fill — so
    // seeding from it would load the pen with the colour of the very thing
    // being drawn on, and every stroke would be invisible.
  }, [styles, inSession, setSize, setFont, setColor]);

  /**
   * What サイズ / フォント / 太さ show.
   *
   * Inside a session they follow the caret, which is the only reading that can
   * describe a range: the box's computed style says nothing about the three
   * words the user selected. `null` there means the selection carries more than
   * one value, and the field goes empty rather than naming one of them.
   *
   * Outside one they show the element, because the element is what the controls
   * will write to. 太さ reads `styles` directly instead of the store above —
   * the store holds only what the fields are seeded with, and weight has never
   * been seeded into it.
   */
  const shownSize = inSession
    ? caret.fontSize === null
      ? null
      : Math.round(caret.fontSize)
    : size;
  const shownFont = inSession
    ? caret.fontFamily === null
      ? MIXED
      : (matchFontStack(caret.fontFamily) ?? '')
    : font;
  const shownWeight = inSession
    ? caret.fontWeight === null
      ? MIXED
      : String(caret.fontWeight)
    : normalizeWeight(styles['font-weight']);

  /**
   * Runs the edit against whatever the user is pointing at: the open range if
   * there is one on *this* element, the element itself otherwise.
   *
   * The uid is checked, not just the presence of a session, so that a session
   * left open on another box cannot swallow an edit meant for this one.
   *
   * **A session is not enough — there has to be a range.** The three commands
   * that write a *value* (size, family, weight) refuse a bare caret on purpose:
   * `execCommand` mints no element there, only a pending style, and the pending
   * style is thrown away the moment the number field takes focus back, leaving
   * a `<font>` behind in the slide for nothing (`hasSessionRange`, richText.ts).
   * Asking only whether a session is open therefore routed the commonest
   * gesture of all — click the box, change the size — into a command that does
   * nothing at all, and the panel's own hint promised otherwise.
   *
   * So a caret with no range falls through to the element, which is also what
   * the user meant: with nothing selected, "make this bigger" is about the box.
   */
  const applyToScope = (toRange: () => void, toElement: Record<string, string>) => {
    if (activeTextSession()?.uid === uid && hasSessionRange()) toRange();
    else applyToElement(toElement);
  };

  /**
   * Element scope, but not element *only*: everything written here is inherited,
   * and a deck that names its own `ul` stops an inherited value at the list
   * (core/editing/listOverrides.ts). `listTargets` adds the list
   * nodes that would otherwise be left behind, and hands back the single target
   * a plain `SetInlineStyleCommand` would have written when there are none.
   *
   * A run of keystrokes in the size field still folds into one undo step, since
   * `tryMerge` sees the same elements and the same properties each time — except
   * across the one keystroke where a list stops being blocked and drops out of
   * the target set. That press starts a new step, which is the honest reading of
   * it: what the command touches genuinely changed.
   */
  const applyToElement = (properties: Record<string, string>) =>
    asOwnStep(() => execute(new SetInlineStyleGroupCommand(listTargets(uid, properties))));

  /**
   * Everything this panel writes to the element rather than to a range, with
   * whatever has been typed flushed onto the stack ahead of it.
   *
   * Two reasons, and the first is the one that bit. A push moves the session's
   * baseline (EditStage watches the history), so without this the keystrokes
   * are absorbed into a step that never touched them and leave the stack
   * altogether (core/editing/richText.ts). The guard there is what
   * makes that survivable; this is what makes it *right* — 行揃え writes on the
   * list nodes inside the element, so the markup a later `SetInnerHtmlCommand`
   * would carry already contains it, and undoing the typing would re-index the
   * very `<li>`s that command captured to put back.
   *
   * Range edits need none of this: `withUndo` already flushes on both sides.
   */
  function asOwnStep(edit: () => void): void {
    commitTextSession();
    edit();
  }

  return (
    <>
      {/* Range-only, and grey outside a session. None of it has an element-wide
          meaning: half a heading can be bold, but "the whole box is bold" is the
          太さ menu below, and a link needs words to attach to.

          `aria-pressed` still says false rather than going away — the button is
          a toggle whichever state the caret is in, and dropping the attribute
          would change what it *is* rather than whether it can be worked. */}
      <div className="format-row">
        {FORMAT_BUTTONS.map(({ command, label, titleKey }) => (
          <button
            key={command}
            className={active[command] ? `format-button ${command} active` : `format-button ${command}`}
            title={
              active[command]
                ? t('text.activeHint', { name: t(titleKey) })
                : rangeTitle(t(titleKey))
            }
            aria-pressed={Boolean(active[command])}
            disabled={!inSession}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyInlineFormat(command)}
          >
            {label}
          </button>
        ))}
        {/* Not a toggle: there is no state for 「書式をクリア」 to be in. */}
        <button
          className="format-button"
          title={rangeTitle(t('text.clearFormat'))}
          disabled={!inSession}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyInlineFormat('removeFormat')}
        >
          {t('text.clear')}
        </button>
      </div>

      <Field label={t('text.color')}>
        <ColorPicker
          color={color}
          icon={TextColorIcon}
          applyLabel={t('text.colorApply')}
          paletteLabel={t('text.colorPalette')}
          onPick={(next) => {
            setColor(next);
            applyToScope(() => setTextColor(next), { color: next });
          }}
        />
        {/* No element-level counterpart: a highlight is a run of text, and a
            colour behind the whole box is the 塗り field in ボックス. So it
            rides in this row rather than owning one, and greys out with the rest
            of the range-only controls while 文字色 beside it stays live — which
            is the clearest statement this panel makes about the two scopes. */}
        <span className="dim">{t('text.highlight')}</span>
        <ColorPicker
          color={highlight}
          icon={HighlightIcon}
          applyLabel={rangeTitle(t('text.highlightApply'))}
          paletteLabel={rangeTitle(t('text.highlightPalette'))}
          disabled={!inSession}
          onPick={(next) => {
            setHighlightColor(next);
            setHighlight(next);
          }}
        />
      </Field>

      {/* Typed numbers land on Enter or when focus leaves; the stepper lands at
          once (`LiveNumberInput`). `flushOn` is here and nowhere else in the
          inspector: this is the one number aimed at a *range*, and the click on
          the canvas that takes focus off this box is the same click that closes
          the session the range belongs to — the session announces the loss
          first, so the draft applies while there is still something to apply it
          to.

          No `preventDefault` on the pointer here, unlike the buttons and menus
          around it: swallowing it would leave the box unclickable. The session
          survives the click through `data-hse-text-tools` on the panel, which is
          also where the range is snapshotted (EditStage). */}
      <Field label={t('text.size')}>
        {(id) => (
          <>
            <LiveNumberInput
              id={id}
              className="spacing-number"
              value={shownSize}
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              flushOn={onBeforeSessionEnd}
              onApply={(next) => {
                setSize(next);
                applyToScope(() => setFontSize(next), { 'font-size': `${next}px` });
              }}
            />
            <span className="unit">px</span>
          </>
        )}
      </Field>

      {/* Applies the moment a font is picked. The native select steals focus
          and with it the frame's selection, but the range is snapshotted on
          pointerdown and restored before the command runs (richText.ts), so
          no confirm button is needed. */}
      <Field label={t('text.font')}>
        {(id) => (
          <FontSelect
            id={id}
            value={shownFont}
            onChange={(stack) => {
              setFont(stack);
              applyToScope(() => setFontFamily(stack), { 'font-family': stack });
            }}
          />
        )}
      </Field>

      {/* 太さ takes the same scope B does: the range when there is one, the
          whole box when there is not. It used to be element-only even inside a
          session, on the grounds that a numeric weight has no `execCommand` —
          which was true of the mechanism and wrong about the user, who had just
          selected three words and watched the entire heading go bold. The
          wrapper `setFontWeight` writes is what closed that gap (richText.ts).

          It goes through `applyToScope` like size and family: all three write a
          *value* and all three refuse a bare caret, so the fall-through to the
          element is the same rule for the same reason, written once.

          Alignment below stays on the element in every case. It is a block
          property, so there is nothing character-sized for it to mean, and
          `execCommand('justifyCenter')` writes the session element's own
          `style` attribute, which never reaches the undo stack — what goes on
          it is the difference in `innerHTML` (richText.ts).

          No `preventDefault` on the pointer, unlike the buttons around it, and
          the difference is not a style choice: showing the popup *is* what a
          `<select>`'s mousedown defaults to, so cancelling it left the menu
          impossible to open by mouse while the keyboard still worked. A
          button's mousedown defaults to moving focus instead — which is what
          costs the frame its selection — so there the call is load-bearing
          and must stay. A select does not need it either way: the range is
          snapshotted on `pointerdown` over this panel and restored before a
          command runs (richText.ts), which is why `FontSelect` has always
          managed without one. */}
      <Field label={t('inspector.weight')}>
        {(id) => (
          <select
            id={id}
            title={t('inspector.weightScope')}
            value={shownWeight}
            onChange={(e) => {
              const weight = e.target.value;
              applyToScope(() => setFontWeight(weight), { 'font-weight': weight });
            }}
          >
            {/* Disabled and hidden: it is the closed control's readout, not an
                option. See MIXED. */}
            {shownWeight === MIXED && (
              <option value={MIXED} disabled hidden>
                {t('inspector.mixed')}
              </option>
            )}
            {/* A deck may compute to a weight the menu does not offer (350 from
                a variable face). Listing it keeps the menu honest about what
                the text currently is — without it the control shows a blank and
                the user cannot tell that from 混在. */}
            {shownWeight !== MIXED && !WEIGHTS.includes(shownWeight) && (
              <option value={shownWeight}>{shownWeight}</option>
            )}
            {WEIGHTS.map((weight) => (
              <option key={weight} value={weight}>
                {weight}
              </option>
            ))}
          </select>
        )}
      </Field>

      {/* The one declaration repeated on every list node rather than only the
          blocked ones: "align this" is an instruction about lines, and a list's
          own padding and marker get a say even where nothing is declared
          (core/editing/listOverrides.ts).

          Which button is lit goes through `shownAlign`, because an untouched
          element computes to `start` and would otherwise light none of the four
          while sitting plainly against one edge. */}
      <Field label={t('inspector.textAlign')}>
        <div className="segmented">
          {ALIGNMENTS.map(({ value, labelKey }) => {
            // `aria-pressed` as well as the class, which is what every other
            // toggle in this panel carries. It had only the class, so the three
            // buttons that say which way the lines run were the one group whose
            // state was visible to the eye and to nothing else — screen readers
            // read them as three plain buttons, and a test could see B lit but
            // not 中央 (issues: 行揃えの aria-pressed).
            const on = shownAlign(styles['text-align'], styles['direction']) === value;
            return (
              <button
                key={value}
                className={on ? 'active' : ''}
                // The one row in this panel that ignores the selection
                // entirely, and the panel's hint above says the opposite about
                // everything else. Saying so here rather than qualifying the
                // hint: the exception belongs on the exception, and a hint that
                // listed it would be three lines in a 280px pane. This is also
                // why these three are the only buttons here without
                // `rangeTitle` — they are never grey, so there is no "press
                // this first" to explain, and they work identically in and out
                // of a session.
                title={t('inspector.elementScope', { name: t(labelKey) })}
                aria-pressed={on}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => asOwnStep(() => alignElement(uid, value))}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>
      </Field>

      {/* On the same 56px label column as everything above it. Loose buttons
          hanging off the left edge were the one part of this panel that did not
          line up with anything. */}
      <Field label={t('inspector.paragraph')}>
        <div className="segmented">
          {LISTS.map(({ command, labelKey }) => (
            <button
              key={command}
              className={active[command] ? 'active' : ''}
              title={
                active[command]
                  ? t('text.activeHint', { name: t(labelKey) })
                  : rangeTitle(t(labelKey))
              }
              aria-pressed={Boolean(active[command])}
              disabled={!inSession}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyInlineFormat(command)}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </Field>

      {/* Its own row rather than the toolbar above: at the pane's default 280px
          the toolbar is already full, and a リンク pushed onto a second line is
          the loose hanging button this layout set out to remove. */}
      <Field label={t('inspector.insert')}>
        <button
          title={rangeTitle(t('text.link'))}
          disabled={!inSession}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setLinking(true)}
        >
          {t('text.link')}
        </button>
      </Field>

      {/* A sibling of the row rather than a child of it. The dialog paints as a
          full-window overlay, so it belongs to no row — and `.field-control` is
          a flex container, which a `position: fixed` box has no business being
          a member of.

          What it must stay inside is this component's subtree, because that is
          what sits under `data-hse-text-tools` (TextPanel, Inspector.tsx).
          EditStage ends the session on any pointerdown outside that marker, so
          a dialog portalled to `<body>` would close the session on the click
          that opened it and leave 挿入 with nothing to link. */}
      {linking && (
        <LinkDialog
          onCancel={() => setLinking(false)}
          onSubmit={(href) => {
            // Before the close, not after: `createLink` needs the range that
            // EditStage snapshotted on the pointerdown over this panel, and
            // running it while the dialog is still mounted keeps the two in one
            // commit — no frame in which focus has been handed back and the
            // link has not yet been written.
            createLink(href);
            setLinking(false);
          }}
        />
      )}
    </>
  );
}


const FONT_GROUP_ORDER: FontGroup[] = ['default', 'japanese', 'latin'];

/**
 * Font picker listing only what this machine can render.
 *
 * Each option previews itself in its own face where the platform's select
 * control allows it, which is the fastest way to tell two gothics apart.
 */
export function FontSelect({
  id,
  value,
  onChange,
}: {
  /** Set when the row ties its label to this select (`Field`). */
  id?: string;
  value: string;
  onChange(stack: string): void;
}) {
  const fonts = useMemo(() => usableFonts(), []);

  return (
    <select
      id={id}
      className="font-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {/* 指定なし is a font the panel can write; 混在 is a thing it can only
          report. They must not share the empty string — see MIXED. */}
      {value === MIXED && (
        <option value={MIXED} disabled hidden>
          {t('inspector.mixed')}
        </option>
      )}
      <option value="">{t('text.fontUnset')}</option>
      {FONT_GROUP_ORDER.map((group) => {
        const inGroup = fonts.filter((font) => font.group === group);
        if (inGroup.length === 0) return null;
        return (
          <optgroup key={group} label={t(`font.group.${group}`)}>
            {inGroup.map((font) => (
              <option key={font.label} value={font.stack} style={{ fontFamily: font.stack }}>
                {font.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
