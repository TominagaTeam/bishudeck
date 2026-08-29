/**
 * Coarse-grained commands that restore a captured state.
 *
 * Direct manipulation changes the DOM continuously while the pointer moves, so
 * describing each gesture as a precise delta would mean reimplementing the
 * gesture in reverse. Capturing the before and after state instead makes undo
 * exact for every gesture, at the cost of holding a little markup per step.
 */

import { useSelectionStore } from '../selection/store';
import type { CommandContext, EditCommand } from './types';

/** Inline styles of a set of elements, keyed by uid. */
export type StyleSnapshot = Map<string, string>;

export class StyleSnapshotCommand implements EditCommand {
  constructor(
    readonly label: string,
    private readonly before: StyleSnapshot,
    private after: StyleSnapshot,
    /**
     * Names the run this command belongs to, and folding is opt-in on it.
     *
     * A gesture already arrives as one command — the pointer moves the DOM and
     * only `end()` records anything — so the snapshots it leaves must stay
     * separate steps: two drags of the same box a moment apart are two things
     * the user did. A field that applies on every keystroke is the opposite
     * case, and hands over a key so its run collapses into the one step the
     * user means by "幅を 900 にした".
     */
    private readonly mergeKey: string | null = null,
  ) {}

  apply(ctx: CommandContext): void {
    restoreStyles(ctx, this.after);
  }

  revert(ctx: CommandContext): void {
    restoreStyles(ctx, this.before);
  }

  /**
   * Folds a continued run, keeping the *first* `before`: that is what makes an
   * undo land on the state from before the first keystroke rather than one
   * digit back — and, for the fields that pin `width` / `height` on an element
   * that had none, what stops the pinned size being left behind (issues #24).
   *
   * The captured elements have to be the same ones, for the same reason
   * `SetInlineStyleGroupCommand` checks: `before` describes a set of elements,
   * and a set that changed underneath is no longer what it would put back.
   */
  tryMerge(next: EditCommand): boolean {
    if (!(next instanceof StyleSnapshotCommand)) return false;
    if (this.mergeKey === null || next.mergeKey !== this.mergeKey) return false;
    if (!sameTargets(this.after, next.after)) return false;
    this.after = next.after;
    return true;
  }
}

/** Whether two snapshots describe the same elements, order aside. */
function sameTargets(a: StyleSnapshot, b: StyleSnapshot): boolean {
  return a.size === b.size && [...a.keys()].every((uid) => b.has(uid));
}

function restoreStyles(ctx: CommandContext, snapshot: StyleSnapshot): void {
  for (const [uid, cssText] of snapshot) {
    const element = ctx.stage?.resolve(uid) as HTMLElement | null;
    if (!element) continue;
    if (cssText) element.style.cssText = cssText;
    else element.removeAttribute('style');
  }
  ctx.stage?.commit();
}

export function captureStyles(
  ctx: { resolve(uid: string): Element | null },
  uids: Iterable<string>,
): StyleSnapshot {
  const snapshot: StyleSnapshot = new Map();
  for (const uid of uids) {
    const element = ctx.resolve(uid) as HTMLElement | null;
    if (element) snapshot.set(uid, element.getAttribute('style') ?? '');
  }
  return snapshot;
}

/**
 * Restores the whole slide's markup. Used for changes that move nodes around —
 * inserting, deleting, reordering — where a style diff cannot express the edit.
 * The captured HTML still carries the editor's uids, so a selection made before
 * the change is still resolvable after undoing it.
 *
 * The selection is restored along with the markup: undoing a delete has to give
 * the element back *selected*, or the user has to hunt for what they just got
 * back before they can do anything with it.
 */
export class HtmlSnapshotCommand implements EditCommand {
  /**
   * Captured on the way into an undo, so redo returns to where the user was.
   * `undefined` means "never undone"; `null` is a real value — nothing selected.
   */
  #selectionAfter: string | null | undefined;

  constructor(
    readonly label: string,
    private readonly before: string,
    private readonly after: string,
    private readonly selectionBefore: string | null = null,
  ) {}

  apply(ctx: CommandContext): void {
    this.#restore(ctx, this.after);
    if (this.#selectionAfter !== undefined) restoreSelection(ctx, this.#selectionAfter);
  }

  revert(ctx: CommandContext): void {
    this.#selectionAfter = useSelectionStore.getState().uid;
    this.#restore(ctx, this.before);
    restoreSelection(ctx, this.selectionBefore);
  }

  #restore(ctx: CommandContext, html: string): void {
    const stage = ctx.stage;
    if (!stage) return;
    stage.replaceSlideContent(html);
    stage.commit();
  }
}

/** Drops a uid the markup no longer contains, so the overlay never chases a ghost. */
function restoreSelection(ctx: CommandContext, uid: string | null): void {
  useSelectionStore.getState().select(uid && ctx.stage?.resolve(uid) ? uid : null);
}
