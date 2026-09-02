import { describe, expect, it } from 'vitest';

import { StyleSnapshotCommand, type StyleSnapshot } from './snapshot';

const snapshot = (entries: Record<string, string>): StyleSnapshot => new Map(Object.entries(entries));

const command = (
  before: Record<string, string>,
  after: Record<string, string>,
  mergeKey?: string,
) => new StyleSnapshotCommand('位置とサイズ', snapshot(before), snapshot(after), mergeKey);

/**
 * Which snapshots fold together, which is the rule that lets a field apply on
 * every keystroke without filling the history.
 *
 * Folding is opt-in on a key rather than on the label, because the same command
 * records both kinds of edit: a gesture arrives already whole — the pointer
 * moved the DOM and only `end()` recorded anything — so two drags a moment
 * apart have to stay two steps. What `tryMerge` does to the run is checked
 * where it happens, against a live stage (core/editing/geometry.test.ts).
 */
describe('StyleSnapshotCommand: what folds into a run', () => {
  it('refuses everything when no key was given', () => {
    const drag = command({ a: '' }, { a: 'transform: translate(4px, 0px)' });
    expect(drag.tryMerge(command({ a: '' }, { a: 'transform: translate(8px, 0px)' }))).toBe(false);
  });

  it('refuses a command that carries no key', () => {
    const typing = command({ a: '' }, { a: 'width: 100px' }, 'geometry:width:a');
    expect(typing.tryMerge(command({ a: '' }, { a: 'width: 200px' }))).toBe(false);
  });

  it('folds a run that carries the same key', () => {
    const typing = command({ a: '' }, { a: 'width: 100px' }, 'geometry:width:a');
    expect(typing.tryMerge(command({ a: '' }, { a: 'width: 200px' }, 'geometry:width:a'))).toBe(true);
  });

  // X, Y and 回転 all write `transform`, so only the key can tell one field's
  // run from the next one's.
  it('refuses another field on the same element', () => {
    const typing = command({ a: '' }, { a: 'width: 100px' }, 'geometry:width:a');
    expect(typing.tryMerge(command({ a: '' }, { a: 'height: 60px' }, 'geometry:height:a'))).toBe(false);
  });

  it('refuses the same field on another element', () => {
    const typing = command({ a: '' }, { a: 'width: 100px' }, 'geometry:width:a');
    expect(typing.tryMerge(command({ b: '' }, { b: 'width: 100px' }, 'geometry:width:b'))).toBe(false);
  });

  // A set of elements that changed underneath is no longer the set `before`
  // describes — the picture inside a frame appearing mid-run, say.
  it('refuses when the captured elements differ', () => {
    const typing = command({ a: '' }, { a: 'width: 100px' }, 'geometry:width:a');
    expect(
      typing.tryMerge(
        command({ a: '', b: '' }, { a: 'width: 200px', b: 'width: 300px' }, 'geometry:width:a'),
      ),
    ).toBe(false);
  });
});
