import { create } from 'zustand';

import { editorEvents } from '../events/bus';
import { useDocumentStore } from '../document/store';
import type { CommandContext, EditCommand } from './types';
import type { StageBridge } from '../../stage/bridge';
import { t } from '../../shared/i18n';

const HISTORY_LIMIT = 200;
/** Gestures separated by more than this are never merged into one undo step. */
const MERGE_WINDOW_MS = 800;

interface HistoryState {
  undoStack: EditCommand[];
  redoStack: EditCommand[];
  lastAt: number;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

const useHistoryStore = create<HistoryState>(() => ({
  undoStack: [],
  redoStack: [],
  lastAt: 0,
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
}));

export const useHistory = useHistoryStore;

let activeStage: StageBridge | null = null;

/** The edit stage registers itself here while it holds a live document. */
export function setActiveStage(stage: StageBridge | null): void {
  activeStage = stage;
}

export function getActiveStage(): StageBridge | null {
  return activeStage;
}

function context(): CommandContext {
  return { document: useDocumentStore.getState(), stage: activeStage };
}

function publish(undoStack: EditCommand[], redoStack: EditCommand[], lastAt: number): void {
  useHistoryStore.setState({
    undoStack,
    redoStack,
    lastAt,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoLabel: undoStack.at(-1)?.label ?? null,
    redoLabel: redoStack.at(-1)?.label ?? null,
  });
}

export interface ExecuteOptions {
  /**
   * The change is already in the DOM. Direct-manipulation gestures mutate as
   * the pointer moves so the user sees the result immediately; re-applying at
   * the end would be redundant and, for text, would destroy the caret.
   */
  alreadyApplied?: boolean;
}

export function execute(command: EditCommand, options: ExecuteOptions = {}): void {
  if (!options.alreadyApplied) {
    try {
      command.apply(context());
    } catch (cause) {
      editorEvents.emit('error', { message: t('error.commandFailed', { label: command.label }), cause });
      return;
    }
  }

  const { undoStack, lastAt } = useHistoryStore.getState();
  const now = Date.now();
  const previous = undoStack.at(-1);

  if (previous?.tryMerge && now - lastAt < MERGE_WINDOW_MS && previous.tryMerge(command)) {
    publish(undoStack, [], now);
    return;
  }

  const next = [...undoStack, command];
  // Dropping the oldest entries bounds memory; those steps become unreachable
  // rather than silently wrong, since each command still owns its own undo data.
  publish(next.slice(-HISTORY_LIMIT), [], now);
}

/**
 * Raised while the history itself is putting a captured state back: for exactly
 * as long as a command's own `apply` or `revert` runs inside `undo`, `redo` or
 * `revoke`.
 *
 * It exists because restoring a snapshot *moves the selection*. That is
 * deliberate — undoing a delete has to hand the element back selected, so
 * `HtmlSnapshotCommand.revert` calls `restoreSelection` (commands/snapshot.ts)
 * — and the edit stage watches the selection to know when a freshly inserted
 * text box has been abandoned (stage/EditStage.tsx). So undoing that very
 * insertion re-enters this module: revert → selection moves → the stage decides
 * the box is unwanted → `revoke`, while `undo` is still mid-flight.
 *
 * Which was wrong twice over. The stacks are published *after* the revert, so
 * the top of the undo stack was still the command being undone: `revoke`
 * matched it and reverted the same snapshot a second time. The damage showed up
 * on redo — the second revert captured the *post-undo* selection as the place
 * to come back to, so 挿入 → ⌘Z → ⌘⇧Z gave the box back unselected, and with the
 * pending record already cleared it could be neither seen (an empty box paints
 * nothing) nor entered.
 *
 * Publishing before reverting in `undo` would close it too, and is arguably the
 * truer fix: it is the reason the window exists at all. It was not taken here
 * because every command's `apply` / `revert` currently runs against stacks that
 * still describe where the history *is*, not where it is going, and that is the
 * engine's contract with all of them for the sake of one caller. So the guard
 * is local, and says the narrow thing it means: a revoke that arrives from
 * inside a restore is this machinery hearing its own echo, not a caller taking
 * their own step back.
 */
let restoring = false;

/**
 * Whether a captured state is being put back right now.
 *
 * For observers that have to tell "the document changed under me because the
 * user did something" from "…because the history moved". The edit stage is the
 * one so far: it watches the selection to decide when a freshly inserted text
 * box has been abandoned, and an undo of that insertion moves the selection for
 * reasons that have nothing to do with the user walking away from the box
 * (stage/EditStage.tsx).
 *
 * Deliberately a question and not an event. Anything that wants to *act* when
 * the history moves already has `useHistory` to subscribe to; this only exists
 * to be asked, inside a notification the asker is already handling, whether
 * that notification came from here.
 */
export function isRestoring(): boolean {
  return restoring;
}

/**
 * Runs one half of a command — its `apply` or its `revert` — with that guard
 * raised, and reports whether it got through.
 *
 * A failure is announced and swallowed, and the caller leaves the stacks
 * exactly as they were: a command that could not complete tells us nothing
 * about what the document now holds, and moving the history on top of that
 * would only make the next step wrong as well.
 */
function runRestore(step: () => void, message: string): boolean {
  const previous = restoring;
  restoring = true;
  try {
    step();
    return true;
  } catch (cause) {
    editorEvents.emit('error', { message, cause });
    return false;
  } finally {
    restoring = previous;
  }
}

/**
 * Takes a command back and forgets it ever ran.
 *
 * For a step that turns out to be one nobody meant to take — a text box
 * inserted and then left without a word in it. Undo is the wrong tool there: it
 * would offer the empty box back as something to redo, and cost the user a
 * keypress to be rid of a box they never asked for.
 *
 * Only the newest step can be revoked, because every step after it was recorded
 * against the state this one would remove. A caller that finds itself too late
 * has to express the change as an ordinary edit instead, and gets `false` to
 * say so — as does a caller that arrives while the history is already restoring
 * something (see `restoring`), which is the same answer for the same reason:
 * the step is not this caller's to take back.
 */
export function revoke(command: EditCommand): boolean {
  if (restoring) return false;
  const { undoStack, redoStack } = useHistoryStore.getState();
  if (undoStack.at(-1) !== command) return false;
  if (!runRestore(() => command.revert(context()), t('error.undoFailed', { label: command.label }))) {
    return false;
  }
  publish(undoStack.slice(0, -1), redoStack, 0);
  return true;
}

export function undo(): void {
  const { undoStack, redoStack } = useHistoryStore.getState();
  const command = undoStack.at(-1);
  if (!command) return;
  if (!runRestore(() => command.revert(context()), t('error.undoFailed', { label: command.label }))) {
    return;
  }
  publish(undoStack.slice(0, -1), [...redoStack, command], 0);
}

export function redo(): void {
  const { undoStack, redoStack } = useHistoryStore.getState();
  const command = redoStack.at(-1);
  if (!command) return;
  if (!runRestore(() => command.apply(context()), t('error.redoFailed', { label: command.label }))) {
    return;
  }
  publish([...undoStack, command], redoStack.slice(0, -1), 0);
}

/** Called on project load: history from a previous document must not survive. */
export function clearHistory(): void {
  publish([], [], 0);
}
