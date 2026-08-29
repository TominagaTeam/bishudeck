import { create } from 'zustand';

import { clearHistory } from '../core/commands/engine';
import { useDocumentStore } from '../core/document/store';
import { editorEvents } from '../core/events/bus';
import { buildProject, type Candidate, type ImportAnalysis } from '../import/pipeline';
import { useUiStore } from './uiStore';
import { t } from '../shared/i18n';

interface ImportState {
  html: string | null;
  analysis: ImportAnalysis | null;
  sourcePath: string | null;
  chosenId: string | null;

  begin(html: string, analysis: ImportAnalysis, sourcePath: string): void;
  choose(detectorId: string): void;
  confirm(): void;
  cancel(): void;
  selected(): Candidate | null;
}

export const useImportStore = create<ImportState>((set, get) => ({
  html: null,
  analysis: null,
  sourcePath: null,
  chosenId: null,

  begin(html, analysis, sourcePath) {
    set({ html, analysis, sourcePath, chosenId: analysis.best?.detectorId ?? null });
  },

  choose(chosenId) {
    set({ chosenId });
  },

  confirm() {
    const { html, chosenId, analysis } = get();
    if (!html || !chosenId) return;
    try {
      const project = buildProject(html, chosenId, analysis?.title);
      useDocumentStore.getState().loadProject(project, null);
      clearHistory();
      // Straight into editing, even if the deck that came before was being
      // previewed: an import is the start of a working session, not the end.
      useUiStore.getState().setMode('edit');
      useUiStore.getState().setSlideIndex(0);
      set({ html: null, analysis: null, sourcePath: null, chosenId: null });
    } catch (cause) {
      editorEvents.emit('error', { message: t('error.importFailed'), cause });
    }
  },

  cancel() {
    set({ html: null, analysis: null, sourcePath: null, chosenId: null });
  },

  selected() {
    const { analysis, chosenId } = get();
    return analysis?.candidates.find((c) => c.detectorId === chosenId) ?? null;
  },
}));
