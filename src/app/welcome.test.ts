import { beforeEach, describe, expect, it } from 'vitest';

import { composeDocument } from '../core/document/compose';
import { useDocumentStore } from '../core/document/store';
import { analyzeHtml } from '../import/pipeline';
import { WELCOME_DECK_HTML, buildWelcomeProject, openWelcomeDeck } from './welcome';

/** Slides in the bundled guide. A change here is a change to the deck. */
const SLIDE_COUNT = 11;

describe('the bundled welcome deck', () => {
  it('is claimed by the ordinary detectors and split slide by slide', () => {
    const analysis = analyzeHtml(WELCOME_DECK_HTML);

    expect(analysis.best?.detectorId).toBe('generic');
    expect(analysis.best?.slideCount).toBe(SLIDE_COUNT);
    expect(analysis.title).toBe('Bishudeck へようこそ');
  });

  it('carries no script, so it reads the same in the edit stage as in preview', () => {
    // Edit mode neutralizes scripts, so a guide that needed one to
    // draw itself would be blank in the one mode the user starts in.
    expect(WELCOME_DECK_HTML).not.toMatch(/<script/i);
  });

  it('lays out at the size the editor renders it at', () => {
    const project = buildWelcomeProject();

    expect(project?.shared.designWidth).toBe(1280);
    expect(project?.shared.designHeight).toBe(720);
  });

  it('survives the export it would be saved through', () => {
    const project = buildWelcomeProject();
    const exported = composeDocument(project!.shared, project!.slides, { mode: 'export' });

    // The guide is a deck like any other: a user who edits and exports it has
    // to get all of it back, not a document the detectors now read differently.
    expect(analyzeHtml(exported).best?.slideCount).toBe(SLIDE_COUNT);
  });
});

describe('opening it', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
  });

  it('fills an empty window, with nowhere to save and nothing to save', () => {
    expect(openWelcomeDeck()).toBe(true);

    const { project, filePath, dirty } = useDocumentStore.getState();
    expect(project.slides).toHaveLength(SLIDE_COUNT);
    // Untouched, and belonging to no file: closing the window asks nothing and
    // autosave writes nothing (app/autosave.ts).
    expect(filePath).toBeNull();
    expect(dirty).toBe(false);
  });

  it('leaves a window that already has a deck alone', () => {
    openWelcomeDeck();
    const loaded = useDocumentStore.getState().project;

    // StrictMode runs mount effects twice, and an import can land before the
    // asset origin resolves; neither may throw away what is on screen.
    expect(openWelcomeDeck()).toBe(false);
    expect(useDocumentStore.getState().project).toBe(loaded);
  });
});
