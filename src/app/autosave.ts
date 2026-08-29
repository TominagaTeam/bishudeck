/**
 * Autosave.
 *
 * A slide editor is used in long sessions with no natural save point, so the
 * file on disk has to follow the document without being asked. The deck's own
 * HTML file is the only thing that persists, so autosave writes exactly what
 * the 書き出し button writes, through the same atomic write as ⌘S: an autosave
 * cut off mid-write still leaves the previous version intact.
 *
 * Only a deck that has already been written once is autosaved: picking a
 * location is a decision that belongs to the user, so a deck that has never
 * been exported is instead caught when the window is closed.
 */

import { getCurrentWindow } from '@tauri-apps/api/window';

import { composeDocument } from '../core/document/compose';
import { useDocumentStore } from '../core/document/store';
import { editorEvents } from '../core/events/bus';
import { backend } from '../shared/backend';
import { exportHtml } from './actions';
import { askCloseAction } from './closePrompt';
import { t } from '../shared/i18n';

/** How long the document has to stand still before it is written. */
export const AUTOSAVE_IDLE_MS = 2000;

/**
 * Debounces writes and never lets two overlap.
 *
 * Saving serializes the whole project, so firing on every keystroke would be
 * both wasteful and racy: a slow write must not be overtaken by the next one.
 */
export class AutosaveScheduler {
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;
  #again = false;

  constructor(
    private readonly delayMs: number,
    private readonly save: () => Promise<void>,
  ) {}

  /** Called on every document change; the write happens once the user pauses. */
  schedule(): void {
    if (this.#running) {
      this.#again = true;
      return;
    }
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#run(), this.delayMs);
  }

  /** Writes whatever is waiting right now, for closing and quitting. */
  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#run();
  }

  cancel(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#again = false;
  }

  async #run(): Promise<void> {
    this.#timer = null;
    if (this.#running) {
      this.#again = true;
      return;
    }
    this.#running = true;
    try {
      await this.save();
    } catch {
      // Reporting belongs to the save callback; a failed write must not stop
      // the next one from being attempted, nor surface as an unhandled
      // rejection from the timer that fired it.
    } finally {
      this.#running = false;
    }
    // Changes made while the write was in flight are not in the file yet.
    if (this.#again) {
      this.#again = false;
      this.schedule();
    }
  }
}

/** Writes the current deck to its own HTML file, if there is anything to write. */
export async function autosaveNow(): Promise<void> {
  const { dirty, filePath, project, markSaved } = useDocumentStore.getState();
  if (!dirty || !filePath) return;

  try {
    const html = composeDocument(project.shared, project.slides, { mode: 'export' });
    await backend.exportHtml(filePath, html);
    // Anything edited while the write was in flight is not in the file, so the
    // document only counts as saved if it has not moved on since.
    if (useDocumentStore.getState().project === project) markSaved(filePath);
  } catch (cause) {
    editorEvents.emit('error', { message: t('error.autosaveFailed'), cause });
  }
}

/**
 * Wires autosave to the document. Returns a teardown for the editor shell.
 */
export function startAutosave(delayMs = AUTOSAVE_IDLE_MS): () => void {
  const scheduler = new AutosaveScheduler(delayMs, autosaveNow);

  const unsubscribe = useDocumentStore.subscribe((state, previous) => {
    if (!state.dirty || !state.filePath) return;
    if (state.project === previous.project) return;
    scheduler.schedule();
  });

  const stopCloseGuard = guardWindowClose(scheduler);

  return () => {
    unsubscribe();
    scheduler.cancel();
    stopCloseGuard();
  };
}

/**
 * Last line of defence: a close that would drop work either writes it first or
 * asks. A deck that has never been exported has nowhere to be written silently,
 * so that is the one case that interrupts the user — and the interruption
 * includes "cancel", because a close is not always meant (see closePrompt.ts).
 */
function guardWindowClose(scheduler: AutosaveScheduler): () => void {
  let unlisten: (() => void) | null = null;
  let closing = false;

  // Outside Tauri — `npm run dev` in a plain browser — there is no window to
  // guard; the scheduler itself still runs.
  let appWindow: ReturnType<typeof getCurrentWindow>;
  try {
    appWindow = getCurrentWindow();
  } catch {
    return () => {};
  }

  void appWindow
    .onCloseRequested(async (event) => {
      if (closing) return;
      const { dirty, filePath } = useDocumentStore.getState();
      if (!dirty) return;

      if (filePath) {
        event.preventDefault();
        await scheduler.flush();
        closing = true;
        await appWindow.destroy();
        return;
      }

      event.preventDefault();
      const choice = await askCloseAction();
      // "Stay" leaves the window exactly as it was: nothing written, nothing
      // closed. The × is allowed to be a mistake.
      if (choice === 'cancel') return;
      if (choice === 'export') {
        await exportHtml();
        // The save dialog was dismissed: the user is not done here after all.
        if (useDocumentStore.getState().dirty) return;
      }
      closing = true;
      await appWindow.destroy();
    })
    .then((stop) => {
      unlisten = stop;
    })
    .catch(() => {
      /* no window to guard */
    });

  return () => unlisten?.();
}
