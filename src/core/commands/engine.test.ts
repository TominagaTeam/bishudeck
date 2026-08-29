import { beforeEach, describe, expect, it } from 'vitest';

import { editorEvents } from '../events/bus';
import { clearHistory, execute, isRestoring, redo, revoke, undo, useHistory } from './engine';
import type { EditCommand } from './types';

/**
 * A command that counts what the engine does to it, and can be told to call
 * back into the engine from the middle of it.
 *
 * The callback is the whole point: the real commands that caused the bug below
 * do not call `revoke` themselves, they move the *selection*
 * (`HtmlSnapshotCommand.revert` → `restoreSelection`), and the edit stage turns
 * that into a `revoke` while the engine is still in the middle of the step.
 * Reproducing it through a real stage would need a live iframe, a selection
 * subscription and a text box; the shape the engine has to survive is just
 * "something re-enters me from inside `apply` / `revert`", so that is what is
 * built here.
 */
class Probe implements EditCommand {
  applied = 0;
  reverted = 0;
  onApply: (() => void) | null = null;
  onRevert: (() => void) | null = null;

  constructor(readonly label = 'テスト') {}

  apply(): void {
    this.applied += 1;
    this.onApply?.();
  }

  revert(): void {
    this.reverted += 1;
    this.onRevert?.();
  }
}

const stacks = () => {
  const { undoStack, redoStack } = useHistory.getState();
  return { undo: undoStack, redo: redoStack };
};

beforeEach(() => {
  clearHistory();
});

describe('revoke: taking the newest step back', () => {
  it('reverts the step and leaves nothing to redo', () => {
    const command = new Probe();
    execute(command);

    expect(revoke(command)).toBe(true);
    expect(command.reverted).toBe(1);
    expect(stacks().undo).toEqual([]);
    // The point of revoking rather than undoing: the step is *gone*, not parked
    // where one more keypress would bring it back (decisions #75).
    expect(stacks().redo).toEqual([]);
    expect(useHistory.getState().canUndo).toBe(false);
  });

  it('refuses a step that is no longer the newest', () => {
    const first = new Probe();
    const second = new Probe();
    execute(first);
    execute(second);

    expect(revoke(first)).toBe(false);
    expect(first.reverted).toBe(0);
    expect(stacks().undo).toEqual([first, second]);
  });

  it('leaves an existing redo stack alone', () => {
    const earlier = new Probe();
    const latest = new Probe();
    execute(earlier);
    undo();
    execute(latest);

    // `execute` clears the redo stack, so this only says that revoking does not
    // put anything back on it — the caller's step vanishes, and the history
    // either side of it is untouched.
    expect(revoke(latest)).toBe(true);
    expect(stacks().redo).toEqual([]);
    expect(stacks().undo).toEqual([]);
  });
});

/**
 * The window that made 挿入 → ⌘Z → ⌘⇧Z leave an invisible box behind.
 *
 * `undo` reverts first and publishes afterwards, so for the length of the
 * revert the top of the undo stack is still the command being undone. A
 * `revoke` arriving in that window — which is exactly what an undone text box
 * insertion produces, because the revert restores the selection and the stage
 * reads that as the box having been abandoned — matched the same command and
 * reverted the same snapshot twice. The second revert captured the *post-undo*
 * selection as the one redo should return to, so the box came back unselected
 * and, its pending record already cleared, could be neither seen nor entered.
 */
describe('revoke: while the history is restoring', () => {
  it('does not revert the same command a second time during undo', () => {
    const command = new Probe();
    execute(command);

    let answer: boolean | null = null;
    command.onRevert = () => {
      answer = revoke(command);
    };
    undo();

    expect(answer).toBe(false);
    expect(command.reverted).toBe(1);
    // And the undo itself completed normally: one step back, one step to redo.
    expect(stacks().undo).toEqual([]);
    expect(stacks().redo).toEqual([command]);
  });

  it('leaves the step redoable after such an undo', () => {
    const command = new Probe();
    execute(command);
    command.onRevert = () => {
      revoke(command);
    };

    undo();
    redo();

    expect(command.applied).toBe(2);
    expect(stacks().undo).toEqual([command]);
    expect(stacks().redo).toEqual([]);
  });

  it('does not take the step underneath back during redo', () => {
    const older = new Probe('古い手');
    const command = new Probe();
    execute(older);
    execute(command);
    undo();

    // Redo republishes the stacks only after `apply` returns, so for that
    // moment `older` is still the newest recorded step — and it is not the
    // caller's to take back either.
    let answer: boolean | null = null;
    command.onApply = () => {
      answer = revoke(older);
    };
    redo();

    expect(answer).toBe(false);
    expect(older.reverted).toBe(0);
    expect(stacks().undo).toEqual([older, command]);
  });

  it('does not re-enter itself from its own revert', () => {
    const command = new Probe();
    execute(command);
    command.onRevert = () => {
      revoke(command);
    };

    expect(revoke(command)).toBe(true);
    expect(command.reverted).toBe(1);
    expect(stacks().undo).toEqual([]);
  });

  it('lets a revoke through again once the restore is over', () => {
    const command = new Probe();
    execute(command);
    command.onRevert = () => {
      revoke(command);
    };
    undo();
    redo();

    // The guard is a window, not a mode: after the redo the command is the
    // newest step again and may be taken back for real.
    command.onRevert = null;
    expect(revoke(command)).toBe(true);
    expect(stacks().undo).toEqual([]);
  });
});

/**
 * The same window, asked about rather than enforced. The edit stage needs it to
 * tell an undo moving the selection from the user moving it, which is the
 * difference between a text box being taken back by the history and one being
 * abandoned.
 */
describe('isRestoring', () => {
  it('is false when nothing is running', () => {
    expect(isRestoring()).toBe(false);
  });

  it('is true inside a revert and inside an apply', () => {
    const seen: boolean[] = [];
    const command = new Probe();
    command.onApply = () => seen.push(isRestoring());
    command.onRevert = () => seen.push(isRestoring());

    execute(command); // not a restore: the caller is applying a new step
    undo();
    redo();

    expect(seen).toEqual([false, true, true]);
  });

  it('is true inside a revoke', () => {
    const command = new Probe();
    execute(command, { alreadyApplied: true });
    let seen: boolean | null = null;
    command.onRevert = () => {
      seen = isRestoring();
    };

    revoke(command);
    expect(seen).toBe(true);
    expect(isRestoring()).toBe(false);
  });
});

describe('a command that fails mid-step', () => {
  const failing = (): EditCommand => ({
    label: 'こわれた手',
    apply() {
      throw new Error('apply');
    },
    revert() {
      throw new Error('revert');
    },
  });

  it('announces the failure and leaves the history where it was', () => {
    const problems: string[] = [];
    const off = editorEvents.on('error', ({ message }) => problems.push(message));

    const command = failing();
    execute(command, { alreadyApplied: true });
    undo();

    expect(problems).toHaveLength(1);
    expect(stacks().undo).toEqual([command]);
    expect(stacks().redo).toEqual([]);
    off();
  });

  it('lowers the guard again afterwards', () => {
    const off = editorEvents.on('error', () => {});
    execute(failing(), { alreadyApplied: true });
    undo();
    off();

    // A `finally`, not a line after the call: a throw used to be the one way
    // out that could have left the flag raised for the rest of the session,
    // and every later revoke would have been refused.
    expect(isRestoring()).toBe(false);
    const command = new Probe();
    execute(command);
    expect(revoke(command)).toBe(true);
  });
});
