/** Slide-level commands: the deck structure, not the contents of a slide. */

import { editorEvents } from '../events/bus';
import { settlePendingTextBox } from '../editing/textBox';
import type { Slide } from '../document/model';
import type { CommandContext, EditCommand } from './types';
import { t } from '../../shared/i18n';

/*
 * Every command here that carries a slide's markup — a copy of it, or the
 * slide itself, kept to be put back — settles a text box that was inserted and
 * never typed into first (`settlePendingTextBox`).
 *
 * An inserted box is written to the document store the moment it is placed and
 * is invisible while it is empty, so without this it is baked into whatever
 * they carry: a duplicated slide came with an unselectable empty box on it,
 * and undoing a slide removal brought one back. The stage cannot catch these
 * on its own — it watches for the selection leaving the box and for
 * `slide:changed`, and duplicating a slide emits neither (core/editing/textBox.ts).
 *
 * It goes in the constructors, not in `apply()`. Every call site builds one of
 * these and executes it in the same expression, so the constructor runs
 * exactly when the user asks for the change, and only then. `apply()` runs
 * again on every redo, where there is nothing left to settle, and where the
 * branch that cannot revoke the insertion would be pushing a delete command
 * onto the history in the middle of executing this one.
 */

/**
 * Which slide should be on screen once the deck's shape has changed.
 *
 * The commands announce this themselves rather than leaving it to whoever
 * called them, because an undo has no caller: the drop that reordered the deck
 * finished long ago, and only the command still knows where the slide went.
 * Leaving it to the call sites is what made undoing a delete or a reorder open
 * a different slide than the one that was being edited (docs/issues.md #11).
 */
function focusSlide(index: number): void {
  editorEvents.emit('slide:focusRequest', { index });
}

export class DuplicateSlideCommand implements EditCommand {
  readonly label = t('command.duplicateSlide');
  #createdId: string | null = null;

  constructor(private readonly sourceId: string) {
    settlePendingTextBox();
  }

  apply(ctx: CommandContext): void {
    this.#createdId = ctx.document.duplicateSlide(this.sourceId);
  }

  revert(ctx: CommandContext): void {
    if (this.#createdId) ctx.document.removeSlide(this.#createdId);
  }
}

export class RemoveSlideCommand implements EditCommand {
  readonly label = t('command.removeSlide');
  #removed: Slide | null = null;
  #index = 0;

  constructor(private readonly slideId: string) {
    settlePendingTextBox();
  }

  apply(ctx: CommandContext): void {
    const { slides } = ctx.document.project;
    this.#index = slides.findIndex((s) => s.id === this.slideId);
    if (this.#index === -1) return;
    this.#removed = slides[this.#index];
    ctx.document.removeSlide(this.slideId);
    // The slide that slid into the gap, or the new last one if there was none.
    // Counted from the array captured above: `ctx.document` is the store
    // snapshot taken when the context was built, so its `project` still
    // describes the deck as it was before this line ran.
    const remaining = slides.length - 1;
    focusSlide(Math.max(0, Math.min(this.#index, remaining - 1)));
  }

  revert(ctx: CommandContext): void {
    if (!this.#removed) return;
    // Re-inserting under the original id keeps any later command in the history
    // that targets this slide resolvable.
    ctx.document.insertSlide(this.#removed, this.#index);
    focusSlide(this.#index);
  }
}

export class MoveSlideCommand implements EditCommand {
  readonly label = t('command.moveSlide');

  constructor(
    private readonly from: number,
    private to: number,
  ) {
    // A reorder that ends where it started is the case that needs this most:
    // `focusSlide(to)` lands on the index already on screen, `setSlideIndex`
    // returns early, and no `slide:changed` ever reaches the stage.
    settlePendingTextBox();
  }

  apply(ctx: CommandContext): void {
    ctx.document.moveSlide(this.from, this.to);
    focusSlide(this.to);
  }

  revert(ctx: CommandContext): void {
    ctx.document.moveSlide(this.to, this.from);
    focusSlide(this.from);
  }

  tryMerge(next: EditCommand): boolean {
    // A drag reorder fires continuously; only the final resting place matters.
    if (!(next instanceof MoveSlideCommand) || next.from !== this.to) return false;
    this.to = next.to;
    return true;
  }
}
