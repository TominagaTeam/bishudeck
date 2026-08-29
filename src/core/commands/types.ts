/**
 * Every mutation goes through a command (docs/adr/0003-all-edits-as-commands.md).
 *
 * Undo/redo is the immediate payoff, but the same seam is what later lets
 * plugins, AI-driven rewrites and collaborative editing change the document
 * without any of them needing privileged access to internals.
 */

import type { StageBridge } from '../../stage/bridge';
import type { useDocumentStore } from '../document/store';

export type DocumentApi = ReturnType<typeof useDocumentStore.getState>;

export interface CommandContext {
  document: DocumentApi;
  /** Present only while the edit stage holds a live document. */
  stage: StageBridge | null;
}

export interface EditCommand {
  /** Shown in the tooltip of the undo and redo buttons, and in the notice
   *  raised when a command fails. */
  readonly label: string;
  apply(ctx: CommandContext): void;
  revert(ctx: CommandContext): void;
  /**
   * Folds a follow-up command into this one, for continuous gestures such as
   * typing or dragging, so a drag is one undo step rather than hundreds.
   * Returns false when the two cannot be combined.
   */
  tryMerge?(next: EditCommand): boolean;
}
