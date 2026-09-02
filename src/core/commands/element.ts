/** Commands that change a single element inside the edit stage. */

import type { CommandContext, EditCommand } from './types';
import { t } from '../../shared/i18n';
import { UID_ATTRIBUTE } from '../../shared/ids';

/**
 * Elements live in the stage iframe, so `instanceof HTMLElement` against this
 * window's constructor would always be false. The check has to use the stage
 * document's own view.
 */
function styleableElement(ctx: CommandContext, uid: string): HTMLElement | null {
  const element = ctx.stage?.resolve(uid);
  const view = element?.ownerDocument.defaultView;
  return element && view && element instanceof view.HTMLElement ? element : null;
}

/**
 * Writes an override set onto one element. An empty value removes the property
 * rather than declaring the empty string, which is what lets a revert restore
 * "there was nothing here" exactly — and what lets a caller hand back a
 * property it no longer wants to override.
 */
export function writeInlineStyle(element: HTMLElement, properties: Record<string, string>): void {
  for (const [name, value] of Object.entries(properties)) {
    if (value === '') element.style.removeProperty(name);
    else element.style.setProperty(name, value);
  }
}

/** Whether two records name the same keys, order aside. */
function sameKeys(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const mine = Object.keys(a).sort();
  const theirs = Object.keys(b).sort();
  return mine.length === theirs.length && mine.every((name, i) => name === theirs[i]);
}

/**
 * Every uid the markup carries.
 *
 * Read off the string rather than by parsing it: the two sides being compared
 * were produced the same way (`element.innerHTML` right after a `reindex`), so
 * a scan for the attribute answers the only question asked of it — which
 * elements are in here — without building a second DOM per keystroke.
 *
 * `innerHTML` escapes `"` inside attribute values, so the pattern can only meet
 * a real attribute or the literal characters `data-hse-uid="…"` typed into the
 * slide as *text*. The latter costs at worst one merge decision going the wrong
 * way, which is why the cheap read is taken over a parse.
 */
function uidsIn(html: string): Set<string> {
  const uids = new Set<string>();
  for (const [, uid] of html.matchAll(new RegExp(`${UID_ATTRIBUTE}="([^"]*)"`, 'g'))) {
    uids.add(uid);
  }
  return uids;
}

/** Whether two snapshots of the same element hold the same set of nodes. */
function sameElements(before: string, after: string): boolean {
  const mine = uidsIn(before);
  const theirs = uidsIn(after);
  return mine.size === theirs.size && [...mine].every((uid) => theirs.has(uid));
}

export class SetInnerHtmlCommand implements EditCommand {
  readonly label = t('command.editText');

  constructor(
    private readonly uid: string,
    private readonly before: string,
    private after: string,
  ) {}

  apply(ctx: CommandContext): void {
    this.#write(ctx, this.after);
  }

  revert(ctx: CommandContext): void {
    this.#write(ctx, this.before);
  }

  /**
   * Folds a continued run of typing, and nothing else.
   *
   * Typing produces no command of its own — the frame runs no scripts, so no
   * keystroke ever reaches the host — and is recorded instead by
   * whoever next flushes the element's markup onto the stack
   * (`commitTextSession`, core/editing/richText.ts). A run of those flushes is
   * one thing the user did and has to come back in one Undo. The formatting
   * buttons go through the very same flush, though, so "same uid, same class"
   * used to be the whole test and **two button presses a moment apart collapsed
   * into one step**: pressing U and then S 150ms later moved the undo stack by
   * one (measured), and a single ⌘Z took both off.
   *
   * What separates the two is *what the flush contains*. Typing only ever
   * rewrites text; a formatting command mints or removes elements — `<b>`, the
   * spans that carry a chosen size or family, the `<ul>` a list arrives in —
   * and `commitTextSession` reindexes before it reads the markup, so every one
   * of those nodes is already wearing a uid by the time it lands here. So the
   * node set is the signal, and it is read off the incoming step alone: a step
   * that added or removed elements is an act of its own and starts a new one.
   *
   * This is the same line `SetInlineStyleGroupCommand` and `StyleSnapshotCommand`
   * draw ("the captured elements have to be the same ones"), reached from the
   * other side — those two ask it of their own targets, this one has to read it
   * out of the markup, because a `SetInnerHtmlCommand` names one element and
   * carries the whole subtree underneath it.
   *
   * Deliberately asymmetric: only `next` is examined, never `this`. The size
   * field is why. Its first keystroke goes through `execCommand` and wraps the
   * run in fresh spans (a structural step); every keystroke after it only
   * re-tunes `font-size` on those same spans (`retuneSizedSpans`), and those
   * have to fold into the step the first one opened, or "30" would cost two
   * Undos. The price is that text flushed within the merge window *after* a
   * formatting press joins that press's step — the user would have to press a
   * button, type, and press another button inside 800ms to see it, and the
   * alternative (also requiring `this` to be text-only) breaks the size field,
   * which is the case that actually happens.
   *
   * `mergeKey`, the way `StyleSnapshotCommand` solves this, was
   * the first thing tried and is the better shape: the caller knows perfectly
   * well whether it is a button or a keystroke, and would not have to be
   * inferred from. It is not taken here only because every caller sits in
   * `core/editing/richText.ts`, which is being changed on another branch right
   * now. If these two ever land together, this test should become the key.
   */
  tryMerge(next: EditCommand): boolean {
    if (!(next instanceof SetInnerHtmlCommand) || next.uid !== this.uid) return false;
    if (!sameElements(next.before, next.after)) return false;
    this.after = next.after;
    return true;
  }

  #write(ctx: CommandContext, html: string): void {
    const element = ctx.stage?.resolve(this.uid);
    if (!element) return;
    element.innerHTML = html;
    // New nodes arrived, so uids have to be handed out before anything can
    // address them.
    ctx.stage?.reindex();
    ctx.stage?.commit();
  }
}

/**
 * Applies inline style properties as an override on top of whatever the deck's
 * own stylesheets say, rather than editing those stylesheets. Reverting
 * restores the exact previous inline value, including its absence, so an undo
 * leaves no residue behind.
 */
export class SetInlineStyleCommand implements EditCommand {
  #before = new Map<string, string>();

  constructor(
    private readonly uid: string,
    private properties: Record<string, string>,
    /** Overridden where the undo button's tooltip can say something more specific. */
    readonly label = t('command.changeStyle'),
  ) {}

  apply(ctx: CommandContext): void {
    const element = styleableElement(ctx, this.uid);
    if (!element) return;

    if (this.#before.size === 0) {
      for (const name of Object.keys(this.properties)) {
        this.#before.set(name, element.style.getPropertyValue(name));
      }
    }
    writeInlineStyle(element, this.properties);
    ctx.stage?.commit();
  }

  revert(ctx: CommandContext): void {
    const element = styleableElement(ctx, this.uid);
    if (!element) return;
    writeInlineStyle(element, Object.fromEntries(this.#before));
    ctx.stage?.commit();
  }

  /**
   * Only a continued gesture on the same properties merges — dragging a colour
   * picker, say. Two different properties changed in quick succession stay two
   * undo steps, and `#before` keeps the values from the start of the gesture.
   */
  tryMerge(next: EditCommand): boolean {
    if (!(next instanceof SetInlineStyleCommand) || next.uid !== this.uid) return false;
    if (!sameKeys(this.properties, next.properties)) return false;
    this.properties = { ...next.properties };
    return true;
  }
}

/**
 * The same kind of override across several elements, as a single undo step.
 *
 * One visual change is not always one element. Aligning a text box has to reach
 * the `<ul>` and `<li>` inside it, and the selection can never point at those:
 * they are transparent to it by design (core/editing/listOverrides.ts). Running
 * a command per node would put one click on the stack several times over.
 *
 * Targets are uids, not elements, so a revert still finds its way home after an
 * undo further down the stack has rebuilt the markup from a string — the uid
 * travels inside the HTML.
 */
export class SetInlineStyleGroupCommand implements EditCommand {
  #before = new Map<string, Map<string, string>>();

  constructor(
    /** uid -> the override set to write on it. */
    private targets: Record<string, Record<string, string>>,
    readonly label = t('command.changeStyle'),
  ) {}

  apply(ctx: CommandContext): void {
    for (const [uid, properties] of Object.entries(this.targets)) {
      const element = styleableElement(ctx, uid);
      if (!element) continue;

      // Captured once per element, so a redo does not record the values its own
      // first apply left behind.
      if (!this.#before.has(uid)) {
        const previous = new Map<string, string>();
        for (const name of Object.keys(properties)) {
          previous.set(name, element.style.getPropertyValue(name));
        }
        this.#before.set(uid, previous);
      }
      writeInlineStyle(element, properties);
    }
    ctx.stage?.commit();
  }

  revert(ctx: CommandContext): void {
    for (const [uid, previous] of this.#before) {
      const element = styleableElement(ctx, uid);
      if (element) writeInlineStyle(element, Object.fromEntries(previous));
    }
    ctx.stage?.commit();
  }

  /**
   * Merges only when the two touch the same elements with the same properties —
   * clicking through 左 / 中央 / 右 to see which reads best. A different set of
   * nodes means the markup changed underneath, and `#before` would no longer
   * describe what to put back.
   */
  tryMerge(next: EditCommand): boolean {
    if (!(next instanceof SetInlineStyleGroupCommand)) return false;
    if (!sameKeys(this.targets, next.targets)) return false;
    for (const [uid, properties] of Object.entries(this.targets)) {
      if (!sameKeys(properties, next.targets[uid])) return false;
    }
    this.targets = { ...next.targets };
    return true;
  }
}
