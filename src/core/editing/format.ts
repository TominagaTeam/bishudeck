/**
 * The format painter: copy one element's look, brush it onto another.
 *
 * What it carries is a fixed white list of appearance properties, and what it
 * deliberately leaves behind is everything positional — `left`, `top`, `width`,
 * `height`, `position`, `transform`, `display`, `margin`. That is the whole
 * design. Carrying position is what sank the earlier copy/paste of elements
 * (see roadmap): an element pulled out of its parent and re-placed by absolute
 * numbers arrives somewhere else, in a box the deck's CSS no longer paints.
 *
 * Painting a format has no such problem, because the target already exists
 * where it belongs — there is no "where does this go" question to get wrong.
 */

import { SetInlineStyleGroupCommand } from '../commands/element';
import { execute, getActiveStage } from '../commands/engine';
import { listTargets } from './listOverrides';
import { useSelectionStore } from '../selection/store';
import { t } from '../../shared/i18n';

export const TEXT_PROPERTIES = [
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'text-align',
  'line-height',
] as const;

export const BOX_PROPERTIES = [
  'background-color',
  'padding',
  'border-radius',
  'opacity',
  // Read per side: the shorthands come back as a four-value list the moment the
  // sides differ, and `rgb(0, 0, 0) rgb(...)` cannot be split back apart safely.
  // The top side stands for the box, which is what the panel edits.
  'border-top-style',
  'border-top-width',
  'border-top-color',
] as const;

/**
 * Everything the brush carries. Geometry is not on it and must not be added:
 * that is the single rule that keeps a paste from moving what it paints.
 */
export const PAINTABLE_PROPERTIES = [...TEXT_PROPERTIES, ...BOX_PROPERTIES] as const;

/**
 * Held outside any store: it survives selection changes by design and nothing
 * renders from it except the menu item's enabled state.
 */
let copied: Record<string, string> | null = null;

export function hasCopiedFormat(): boolean {
  return copied !== null;
}

/** Reads the *computed* look, so an inherited value paints as what it looks like. */
export function copyFormat(): boolean {
  const bridge = getActiveStage();
  const uid = useSelectionStore.getState().uid;
  if (!bridge || !uid) return false;

  const element = bridge.resolve(uid);
  const view = element?.ownerDocument.defaultView;
  if (!element || !view) return false;

  const computed = view.getComputedStyle(element);
  const picked: Record<string, string> = {};
  for (const property of PAINTABLE_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (value) picked[property] = value;
  }

  copied = picked;
  return true;
}

export function pasteFormat(): boolean {
  const bridge = getActiveStage();
  const uid = useSelectionStore.getState().uid;
  if (!bridge || !uid || !copied || !bridge.resolve(uid)) return false;

  // One command, so one undo step — and `apply` does the writing, which is why
  // this needs no `alreadyApplied`. Most of what the brush carries is inherited,
  // so painting onto a box that holds a list meets the wall the list puts in
  // front of an inherited declaration: the spread is what gets
  // it past, and collapses to a single target when the painted box holds no
  // list — or when the deck says nothing about its own lists.
  execute(new SetInlineStyleGroupCommand(listTargets(uid, copied), t('command.pasteFormat')));
  return true;
}

/** Test seam: the brush is module state, so it has to be resettable. */
export function clearCopiedFormat(): void {
  copied = null;
}
