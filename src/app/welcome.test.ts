import { beforeEach, describe, expect, it } from 'vitest';

import { composeDocument } from '../core/document/compose';
import { useDocumentStore } from '../core/document/store';
import { analyzeHtml } from '../import/pipeline';
import { LOCALES, setLocale, type Locale } from '../shared/i18n';
import { WELCOME_DECKS, buildWelcomeProject, openWelcomeDeck } from './welcome';

/** Slides in the bundled guide. A change here is a change to the deck. */
const SLIDE_COUNT = 11;

/** What each language's guide calls itself: the one string the test reads. */
const TITLES: Record<Locale, string> = { ja: 'Bishudeck へようこそ', en: 'Welcome to Bishudeck' };

describe.each(LOCALES)('the bundled welcome deck (%s)', (locale) => {
  const html = WELCOME_DECKS[locale];

  it('is claimed by the ordinary detectors and split slide by slide', () => {
    const analysis = analyzeHtml(html);

    expect(analysis.best?.detectorId).toBe('generic');
    expect(analysis.best?.slideCount).toBe(SLIDE_COUNT);
    expect(analysis.title).toBe(TITLES[locale]);
  });

  it('carries no script, so it reads the same in the edit stage as in preview', () => {
    // Edit mode neutralizes scripts, so a guide that needed one to
    // draw itself would be blank in the one mode the user starts in.
    expect(html).not.toMatch(/<script/i);
  });

  it('lays out at the size the editor renders it at', () => {
    const project = buildWelcomeProject(locale);

    expect(project?.shared.designWidth).toBe(1280);
    expect(project?.shared.designHeight).toBe(720);
  });

  it('survives the export it would be saved through', () => {
    const project = buildWelcomeProject(locale);
    const exported = composeDocument(project!.shared, project!.slides, { mode: 'export' });

    // The guide is a deck like any other: a user who edits and exports it has
    // to get all of it back, not a document the detectors now read differently.
    expect(analyzeHtml(exported).best?.slideCount).toBe(SLIDE_COUNT);
  });

  it('says what the other language says, slide for slide', () => {
    // Two files, one guide: the same slides in the same order, with the same
    // furniture — page numbers, and as many key hints. Only the sentences
    // differ (one of the hints is a word, so the hints are counted, not read).
    const other = WELCOME_DECKS[locale === 'ja' ? 'en' : 'ja'];
    const shape = (source: string) =>
      source
        .split('<section class="slide ')
        .slice(1)
        .map((slide) => [
          slide.slice(0, slide.indexOf('"')),
          slide.match(/<span class="page">([^<]+)</)?.[1],
          (slide.match(/class="key"/g) ?? []).length,
        ]);
    expect(shape(html)).toEqual(shape(other));
  });
});

describe('opening it', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
    setLocale('ja');
  });

  it('opens the guide in the language the interface is in', () => {
    setLocale('en');
    expect(openWelcomeDeck()).toBe(true);
    expect(useDocumentStore.getState().project.meta.title).toBe(TITLES.en);
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
