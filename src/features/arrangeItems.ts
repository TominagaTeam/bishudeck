/**
 * The arrange commands, named once.
 *
 * They appear in the toolbar's 配置 menu and again in the stage's context menu;
 * keeping the list in one place is what stops the two from drifting apart.
 * The keys themselves live in `shared/shortcuts` — this only points at them.
 *
 * Reordering has a keyboard shortcut, so its name comes from the same catalog
 * entry the help sheet reads (`action.<id>`): the menu and the sheet are naming
 * one operation, and two entries would eventually word it two ways.
 */

import type { AlignEdge, OrderChange } from '../core/editing/actions';
import { t } from '../shared/i18n';
import type { ShortcutId } from '../shared/shortcuts';

export const ALIGNMENTS: { edge: AlignEdge; label: string }[] = [
  { edge: 'left', label: t('action.align.left') },
  { edge: 'center', label: t('action.align.center') },
  { edge: 'right', label: t('action.align.right') },
  { edge: 'top', label: t('action.align.top') },
  { edge: 'middle', label: t('action.align.middle') },
  { edge: 'bottom', label: t('action.align.bottom') },
];

export const ORDERING: { change: OrderChange; label: string; shortcut: ShortcutId }[] = [
  { change: 'front', label: t('action.arrange.front'), shortcut: 'arrange.front' },
  { change: 'forward', label: t('action.arrange.forward'), shortcut: 'arrange.forward' },
  { change: 'backward', label: t('action.arrange.backward'), shortcut: 'arrange.backward' },
  { change: 'back', label: t('action.arrange.back'), shortcut: 'arrange.back' },
];
