/**
 * Which panels the inspector shows, in what order, which of them start open,
 * and which of them are there but cannot be worked.
 *
 * The inspector used to hand every element the same column of five panels, all
 * expanded, which is 18 rows before anyone touches 辺ごと (issues #20). Two
 * things are wrong with that at once, and they turn out to be the same problem:
 * there is too much on screen, and what little the user actually wants is not
 * at the top (issues #22).
 *
 * Neither half is solved by *hiding* fields. 余白 / 角丸 / 塗り / 枠線 all apply
 * to an `<img>` and an `<svg>` as much as to a `<div>`, so there is no element
 * for which they are meaningless — only elements for which they are unlikely to
 * be the reason someone opened the inspector. That makes this a question of
 * order and of what starts collapsed, which is what this table is.
 *
 * **Every panel is drawn for every element** (decisions #56). The ones with
 * nothing to act on arrive at the end of the column, collapsed and disabled,
 * rather than not arriving: a pane whose contents change shape with the
 * selection asks the user to remember what a photo "has" — and the answer to
 * "where did 文字書式 go" should be visible in the pane rather than recalled.
 * What the earlier rule got right is kept: those panels are still last, still
 * shut, and still cost one row each rather than their contents.
 *
 * The table is kept apart from the components so it can be tested as a plain
 * function. Testing something that lives inside a component is possible but
 * costly: with no testing-library here, a test has to mount the real thing with
 * `createElement` and drive it by hand (decisions #36, see
 * `inspectorField.test.ts`). That is worth the scaffolding when the markup
 * itself is what has to be right, and not worth it for a question that is pure
 * data — order and open/closed defaults need no rendered tree to check.
 */

import { isCroppable } from '../core/editing/crop';
import { isFillable } from '../core/editing/imageFill';
import { isUntouchedTextBox } from '../core/editing/textBox';
import { isTextEditable } from '../stage/selectionHeuristics';

/** The collapsible blocks. 選択 (the breadcrumb) is not one of them: it says
 *  where you are rather than offering anything to edit, and a user who folded
 *  it away would lose the only route back out of a nested selection. */
export type PanelId = 'geometry' | 'image' | 'text' | 'box' | 'border';

/**
 * Every panel there is, and the order the disabled ones queue in at the end.
 *
 * 位置とサイズ leads because it is the only one disabled by a *mode* rather
 * than by the element: a text session ends and it comes back, so keeping it
 * nearest the live panels is what stops the column from reshuffling around a
 * temporary state. 画像 and 文字書式 are disabled by what the element *is*,
 * which does not change while it stays selected.
 */
const ALL_PANELS: readonly PanelId[] = ['geometry', 'image', 'text', 'box', 'border'];

/**
 * What the selection is, as far as the ordering is concerned.
 *
 * Deliberately the same tests the rest of the editor already uses —
 * `isCroppable` decides whether トリミング can be started, `isTextEditable`
 * decides whether a double-click opens a text session and whether 文字書式 is
 * live (decisions #21). A further opinion about "is this an image" would
 * eventually disagree with one of them, and nobody could say which was right.
 * `isFillable` is not that further opinion: it is the two of them read together
 * (core/editing/imageFill.ts), which is why it decides only whether 画像 is
 * live and never what kind an element is.
 */
export type ElementKind = 'text' | 'image' | 'shape';

export interface PanelSlot {
  id: PanelId;
  open: boolean;
  /** False when the panel is drawn but has nothing to act on: it arrives shut,
   *  its summary does not answer a click, and its contents are not built. */
  enabled: boolean;
}

/**
 * The order, and what is expanded on arrival, per kind.
 *
 * Two panels open is the budget: it is about as much as the pane shows at its
 * default 280px without scrolling, so "what you see when you select something"
 * stays a decision this table makes rather than one the window height makes.
 * Disabled panels cost a summary each and never open, so they do not spend it.
 *
 * 位置とサイズ is open everywhere because it is the one panel whose numbers are
 * about the object rather than its look — everywhere except inside a text
 * session, where it goes dark (see `panelsFor`). A shape gets ボックス instead
 * of a second look-panel because 塗り is what a rectangle on a slide is *for*,
 * while a text box or a photo is usually selected to change the words or the
 * crop.
 */
const LAYOUTS: Record<ElementKind, readonly { id: PanelId; open: boolean }[]> = {
  text: [
    { id: 'text', open: true },
    { id: 'geometry', open: true },
    { id: 'box', open: false },
    { id: 'border', open: false },
  ],
  image: [
    { id: 'image', open: true },
    { id: 'geometry', open: true },
    { id: 'box', open: false },
    { id: 'border', open: false },
  ],
  shape: [
    { id: 'geometry', open: true },
    { id: 'box', open: true },
    // 画像 is named here, ahead of 枠線, rather than being left to arrive as
    // part of the tail. A shape's 画像 panel holds 「画像を入れる」, and the box
    // it is most often wanted on is the photo frame an imported deck draws
    // where its `<image-slot>` was (issues #100) — a panel that answers that
    // from the bottom of the column is one the user has to go looking for.
    { id: 'image', open: false },
    { id: 'border', open: false },
  ],
};

/**
 * What this element is, and which panels have something to act on.
 *
 * The two answers come from one set of reads because they are the same two
 * questions: the kind that decides the order, and the gate that decides whether
 * 画像 / 文字書式 are live. Splitting them would mean asking `isCroppable`
 * twice, and `isCroppable` reaches for `getComputedStyle`.
 *
 * **画像 is live for two different reasons, and only one of them is a kind.**
 * A picture gets it because トリミング acts on a picture, and that is what makes
 * the element an `image` for ordering purposes. A box gets it because 画像を入れる
 * can put a picture *into* it (issues #100) — which does not make the box a
 * photo, so the kind stays `shape` and the panel takes the place the shape row
 * gives it. Reading `isFillable` here rather than inside the panel keeps the
 * column and the panel from ever disagreeing about whether there is anything to
 * press, the same way `croppable` already does.
 *
 * `enabled` is not ordered — `panelsFor` is what orders it, and what fills in
 * the rest of `ALL_PANELS` as the disabled tail.
 *
 * A `null` element is a selection the stage can no longer resolve, and gets the
 * three panels that never depended on reading it.
 *
 * **文字書式 is live wherever a text session can be, and the test has to be the
 * stage's own.** `isTextEditable` asks whether an element carries words, so it
 * says no to the text box inserted a moment ago — which is empty by design
 * (core/editing/textBox.ts) and is the single element on the slide the user
 * most obviously means to type into. The stage makes the exception at every
 * door into a session, as `isTextEditable(el) || isUntouchedTextBox(uid, el)`
 * (EditStage: the double-click, the context menu, Enter / F2), and the pane was
 * the one place asking only the first half. The result was the bug the pane
 * exists to prevent: insert a box, double-click it, and the session opens with
 * 文字書式 greyed out at the *bottom* of the column, under 画像 — every control
 * for the text being typed, unreachable, while the caret blinks in the box.
 *
 * Widening `isTextEditable` itself is still refused for the reason it always
 * was: it is the same function that decides what counts as background, and a
 * rule that let any empty `<div>` be text would make a deck's backdrops
 * selectable and editable (decisions #52, #75). `isUntouchedTextBox` answers for
 * exactly one uid and only until something is typed into it, which is why the
 * uid is a parameter here rather than the element being asked on its own.
 */
export function offeredPanels(
  uid: string | null,
  element: Element | null,
): {
  kind: ElementKind;
  enabled: PanelId[];
} {
  const croppable = element !== null && isCroppable(element);
  const fillable = element !== null && isFillable(element);
  const textual =
    element !== null &&
    (isTextEditable(element) || (uid !== null && isUntouchedTextBox(uid, element)));
  const enabled: PanelId[] = ['geometry', 'box', 'border'];
  if (croppable || fillable) enabled.push('image');
  if (textual) enabled.push('text');
  return { kind: croppable ? 'image' : textual ? 'text' : 'shape', enabled };
}

/**
 * The panels to draw, in order, each with the open state and the live/dark
 * state it should have. Every `PanelId` comes back exactly once.
 *
 * `overrides` holds only the panels the user has actually opened or closed by
 * hand. That is the whole reason the table keeps working: storing an entry for
 * every panel would mean the first time anyone collapsed 枠線, every panel
 * would have a remembered state and the per-kind defaults would never be
 * consulted again — the ordering work above would be dead code after one click.
 *
 * **The overrides are read for live panels only.** A dark panel is shut whatever
 * the store says, which is what keeps the two records from contaminating each
 * other: a fold taken while 文字書式 was live must not reopen it on a photo,
 * and — since the summary of a dark panel does not answer a click — no override
 * can be filed from one either.
 *
 * A panel the element offers but this kind's row does not name is still drawn
 * live, collapsed, ahead of the dark tail. A row is a statement about priority,
 * not a whitelist; an element that is somehow both croppable and textual must
 * not lose a panel because the table did not anticipate it.
 *
 * `inTextSession` is the one thing that moves a panel by mode rather than by
 * element, and it moves two of them in opposite directions.
 *
 * 位置とサイズ loses its power: it reads the box once per commit, and typing
 * commits nothing, so during a session its numbers are not merely beside the
 * point — they are wrong (issues #37). Going dark is what keeps them off the
 * screen: the panel is shut, its summary does not open, and `Inspector` does
 * not build the fields, so there is no route to a stale number and no route to
 * filing an override from one either.
 *
 * 文字書式 is **forced open**, overrides and all. A session is the user saying
 * "I am working on these words", and a pane that answers that with a shut
 * heading is the report this rule exists for: the panel was there, first in the
 * column, and folded — because a fold is remembered until it is undone by hand
 * and one taken weeks ago on a photo's column is still in force here.
 *
 * Overriding a remembered fold is normally exactly what this function refuses
 * to do, so it is worth being plain about why this is not that. The two records
 * are not in conflict, because they answer different questions: the store says
 * what the column looks like when the user is *choosing* what to work on, and
 * a session is not that moment — it is a mode the user entered deliberately,
 * with one panel in it. This is the same trade 位置とサイズ already makes one
 * paragraph up, in the same direction: what the mode needs beats what the store
 * remembers, **for the length of the mode only**. Nothing is written: the fold
 * is read again the moment the session ends, and the panel goes straight back
 * to whatever the user had folded it to. `CollapsiblePanel` files an override
 * from a real click and from nothing else, so a session cannot leave a record
 * of its own either — a user who shuts 文字書式 *during* a session is heard,
 * for that session and for every one after it.
 *
 * The two alternatives were tried on paper and are worse. Leaving the fold
 * alone and only scrolling to the panel puts a shut heading on screen, which
 * answers "where are the text tools" with the same non-answer at a different
 * scroll position. Opening it at the start of the session and folding it back
 * at the end reaches into the store twice per double-click, and a session that
 * ends while the app is closing would persist the wrong value — a fold quietly
 * lost is worse than one temporarily ignored.
 */
export function panelsFor(
  kind: ElementKind,
  enabled: readonly PanelId[],
  overrides: Readonly<Record<string, boolean>>,
  inTextSession: boolean,
): PanelSlot[] {
  const usable = inTextSession ? enabled.filter((id) => id !== 'geometry') : enabled;
  const offered = new Set(usable);
  const ordered = LAYOUTS[kind].filter((slot) => offered.has(slot.id));
  const named = new Set(ordered.map((slot) => slot.id));
  const rest = usable.filter((id) => !named.has(id)).map((id) => ({ id, open: false }));

  const live: PanelSlot[] = [...ordered, ...rest].map((slot) => ({
    id: slot.id,
    // The session's one claim on the column, and it is read here rather than
    // written to the store on purpose — see the note above.
    open: inTextSession && slot.id === 'text' ? true : (overrides[slot.id] ?? slot.open),
    enabled: true,
  }));

  const drawn = new Set(live.map((slot) => slot.id));
  const dark: PanelSlot[] = ALL_PANELS.filter((id) => !drawn.has(id)).map((id) => ({
    id,
    open: false,
    enabled: false,
  }));

  return [...live, ...dark];
}
