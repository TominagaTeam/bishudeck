/** File-level actions wired to the toolbar and keyboard shortcuts. */

import { open, save } from '@tauri-apps/plugin-dialog';

import { composeDocument } from '../core/document/compose';
import { useDocumentStore } from '../core/document/store';
import { editorEvents } from '../core/events/bus';
import { isArtifactHtml, unwrapArtifact } from '../import/artifact';
import { analyzeHtml } from '../import/pipeline';
import { backend } from '../shared/backend';
import { useImportStore } from './importStore';
import { useUiStore } from './uiStore';
import { t } from '../shared/i18n';

const HTML_FILTER = { name: 'HTML', extensions: ['html', 'htm'] };

export async function importHtml(): Promise<void> {
  const selected = await open({ multiple: false, filters: [HTML_FILTER] });
  if (typeof selected !== 'string') return;

  const ui = useUiStore.getState();
  ui.setBusy(t('import.parsing'));
  try {
    const html = await prepare(await backend.readTextFile(selected), ui);
    const analysis = analyzeHtml(html);
    if (!analysis.best) {
      ui.notify('error', t('error.noSlidesDetected'));
      return;
    }
    // The split is always confirmed before it is applied: a wrong guess is the
    // one import failure that is painful to undo by hand.
    useImportStore.getState().begin(html, analysis, selected);
  } catch (cause) {
    editorEvents.emit('error', { message: t('error.readHtmlFailed'), cause });
  } finally {
    ui.setBusy(null);
  }
}

/**
 * Turns a Claude Artifacts download into the plain HTML it renders to. Every
 * other deck is handed to the detectors exactly as it was written: an import
 * that rewrites markup it did not have to touch is how decks get quietly
 * damaged.
 */
async function prepare(html: string, ui: ReturnType<typeof useUiStore.getState>): Promise<string> {
  if (!isArtifactHtml(html)) return html;

  ui.setBusy(t('import.unwrapping'));
  const unwrapped = await unwrapArtifact(html);
  if (unwrapped.fontsDropped > 0) {
    ui.notify(
      'info',
      t('import.fontsInlined', { kept: unwrapped.fontsInlined, dropped: unwrapped.fontsDropped }),
    );
  }
  // The deck's own script is gone, so what it would have drawn was written into
  // the markup instead. That is a rewrite of the author's HTML, so it is said
  // out loud rather than left for the user to notice.
  const filled = [
    unwrapped.propsResolved > 0 ? t('import.propsResolved', { count: unwrapped.propsResolved }) : null,
    unwrapped.imageSlots > 0 ? t('import.imageSlots', { count: unwrapped.imageSlots }) : null,
  ].filter(Boolean);
  if (filled.length > 0) ui.notify('info', t('import.filledSummary', { items: filled.join(t('import.listSeparator')) }));
  return unwrapped.html;
}

/**
 * Writes the deck back out as one HTML file. Every slide is wrapped in the
 * original shell, so a deck that came in as reveal.js goes out as reveal.js.
 *
 * The HTML file is the only thing that persists — there is no separate project
 * format — so this is also the path ⌘S and autosave take. The first write asks
 * for a location and the deck remembers it; later writes overwrite it in place.
 * An imported deck deliberately starts without a location: silently rewriting
 * the file the user dragged in is not a decision the editor gets to make.
 */
export async function exportHtml(forceDialog = false): Promise<void> {
  const doc = useDocumentStore.getState();
  const ui = useUiStore.getState();

  let path = doc.filePath;
  if (!path || forceDialog) {
    const chosen = await save({
      filters: [HTML_FILTER],
      defaultPath: `${doc.project.meta.title || 'presentation'}.html`,
    });
    if (typeof chosen !== 'string') return;
    path = chosen;
  }

  ui.setBusy(t('import.exporting'));
  try {
    const html = composeDocument(doc.project.shared, doc.project.slides, { mode: 'export' });
    await backend.exportHtml(path, html);
    doc.markSaved(path);
    ui.notify('info', t('import.exported'));
  } catch (cause) {
    editorEvents.emit('error', { message: t('error.exportFailed'), cause });
  } finally {
    ui.setBusy(null);
  }
}

export async function startPresentation(): Promise<void> {
  const { project } = useDocumentStore.getState();
  if (project.slides.length === 0) return;
  try {
    await backend.setLiveProject(project);
    await backend.openPresentationWindow(useUiStore.getState().slideIndex);
  } catch (cause) {
    editorEvents.emit('error', { message: t('error.presentFailed'), cause });
  }
}
