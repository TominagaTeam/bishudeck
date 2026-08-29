/**
 * The deck the editor opens with.
 *
 * An editor that starts on an empty canvas asks the user to already know what
 * it does: there is nothing to click, and the one thing that would help — a
 * deck — is what they came here to make. So the app ships one, and the first
 * window opens on it. It is a guide to the editor written as slides, which
 * makes it demonstrate what it explains: every sentence on it can be selected,
 * dragged and rewritten.
 *
 * It is imported through the ordinary pipeline rather than being handed to the
 * store as a ready-made project. The file is a plain `section.slide` deck with
 * no editor-specific markup, so whatever the detectors do to an imported deck
 * they do to this one too — including breaking, which a unit test then catches
 * (welcome.test.ts) rather than a user meeting an empty window.
 */

import welcomeDeckHtml from './welcomeDeck.html?raw';

import { clearHistory } from '../core/commands/engine';
import { useDocumentStore } from '../core/document/store';
import { analyzeHtml, buildProject } from '../import/pipeline';
import type { Project } from '../core/document/model';

/** The bundled deck's source, exported for the test. */
export const WELCOME_DECK_HTML = welcomeDeckHtml;

/**
 * Runs the bundled deck through detection, or `null` if nothing claimed it.
 *
 * The detector is not named here on purpose: the deck is written so that the
 * ordinary guess is the right one, and pinning it would hide the day that
 * stops being true.
 */
export function buildWelcomeProject(): Project | null {
  const analysis = analyzeHtml(welcomeDeckHtml);
  if (!analysis.best) return null;
  return buildProject(welcomeDeckHtml, analysis.best.detectorId, analysis.title);
}

/**
 * Opens the welcome deck, unless the window already has a deck in it.
 *
 * The emptiness check is what makes this safe to call more than once — React's
 * StrictMode runs mount effects twice in development, and a second call would
 * otherwise throw away whatever the first one loaded.
 *
 * The project is loaded with no file path and not dirty, exactly as if it had
 * just been imported: nothing is written anywhere until the user asks for it,
 * and closing the window on an untouched guide asks no questions (autosave.ts).
 */
export function openWelcomeDeck(): boolean {
  const doc = useDocumentStore.getState();
  if (doc.project.slides.length > 0 || doc.filePath !== null) return false;

  const project = buildWelcomeProject();
  if (!project) {
    // A bundled file that no detector claims is a build-time mistake, not
    // something the user can act on, so the editor just starts empty.
    console.warn('[welcome] the bundled deck was not recognized as slides');
    return false;
  }

  doc.loadProject(project, null);
  // Nothing that happened before the deck was opened is undoable.
  clearHistory();
  return true;
}
