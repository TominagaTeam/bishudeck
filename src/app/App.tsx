import { useEffect } from 'react';

import { execute, redo, undo } from '../core/commands/engine';
import { DuplicateSlideCommand } from '../core/commands/slide';
import { useDocumentStore } from '../core/document/store';
import {
  deleteSelection,
  duplicateSelection,
  nudge,
  reorder,
  type OrderChange,
} from '../core/editing/actions';
import { copySelection, cutSelection, pasteClipboard } from '../core/editing/clipboard';
import { copyFormat, pasteFormat } from '../core/editing/format';
import { activeTextSession } from '../core/editing/richText';
import { useSelectionStore } from '../core/selection/store';
import { initAssetBase } from '../shared/assetBase';
import { attachBundledFonts } from '../shared/bundledFonts';
import { matchesShortcut, type ShortcutId } from '../shared/shortcuts';
import { EditStage } from '../stage/EditStage';
import { PreviewStage } from '../stage/PreviewStage';
import { useFitScale } from '../stage/useFitScale';
import { CloseConfirmDialog } from '../features/CloseConfirmDialog';
import { ImportDialog } from '../features/ImportDialog';
import { Inspector } from '../features/Inspector';
import { PaneDivider } from '../features/PaneDivider';
import { SlideList } from '../features/SlideList';
import { ShortcutHelpDialog } from '../features/ShortcutHelpDialog';
import { StageContextMenu } from '../features/StageContextMenu';
import { StatusBar } from '../features/StatusBar';
import { Toolbar } from '../features/Toolbar';
import { backend } from '../shared/backend';
import { exportHtml, importHtml, startPresentation } from './actions';
import { startAutosave } from './autosave';
import { useClosePromptStore } from './closePrompt';
import { useImportStore } from './importStore';
import { ZOOM_STEPS, useUiStore } from './uiStore';
import { openWelcomeDeck } from './welcome';

export function App() {
  const project = useDocumentStore((s) => s.project);
  const mode = useUiStore((s) => s.mode);
  const slideIndex = useUiStore((s) => s.slideIndex);
  const zoomOverride = useUiStore((s) => s.zoomOverride);
  const toast = useUiStore((s) => s.toast);
  const panes = useUiStore((s) => s.panes);
  const dismissToast = useUiStore((s) => s.dismissToast);
  const importing = useImportStore((s) => s.analysis !== null);
  const closing = useClosePromptStore((s) => s.answer !== null);
  const helpOpen = useUiStore((s) => s.helpOpen);
  const clearSelection = useSelectionStore((s) => s.clear);
  // Subscribed for the re-render alone: `t()` reads the catalog on every call,
  // so a language change needs nothing from this component except that it,
  // and everything under it, renders again.
  useUiStore((s) => s.locale);

  const { shared, slides } = project;
  const slide = slides[slideIndex] ?? null;
  const { containerRef, scale, fitScale } = useFitScale(
    shared.designWidth,
    shared.designHeight,
    zoomOverride,
  );

  useKeyboardShortcuts(slides.length, fitScale);

  // Composing a document is synchronous, so the asset origin has to be known
  // before the first slide renders. The app window's own copy of the bundled
  // typefaces hangs off the same answer: the font picker draws each option in
  // its own face, and this window is where that drawing happens.
  //
  // The welcome deck waits on the same answer rather than opening on mount: it
  // is the first document composed, and a compose that runs before the origin
  // is known writes no stylesheet link, leaving the guide in whatever face the
  // system happens to have (shared/bundledFonts.ts).
  useEffect(() => {
    void initAssetBase().then(() => {
      attachBundledFonts(document);
      openWelcomeDeck();
    });
  }, []);

  useEffect(() => startAutosave(), []);

  // Keep the backend's copy current so the presentation window always opens on
  // what the editor is actually showing. Debounced because typing changes the
  // project on every keystroke and this is only read when a window opens.
  useEffect(() => {
    const timer = setTimeout(() => {
      backend.setLiveProject(project).catch(() => {
        /* presentation is best-effort; editing must not fail because of it */
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, 4000);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  return (
    <div className="app">
      <Toolbar />
      {/* Both pane widths are state, so their grid tracks have to come from
          state too; every other track stays in the stylesheet. */}
      <div
        className="workspace"
        style={{
          gridTemplateColumns:
            `${paneTrack(panes.slideList)} var(--divider) 1fr ` +
            `var(--divider) ${paneTrack(panes.inspector)}`,
        }}
      >
        <SlideList />
        <PaneDivider pane="slideList" />
        {/* The margin around the slide is the one part of the stage no
            interaction layer covers — `.stage-interaction` is the slide
            rectangle exactly — so clicking out there used to leave the
            selection on screen with nothing under it. `.stage-viewport` is
            sized to the scaled slide, so the canvas being the direct target
            *is* "outside the slide"; anything that reached a child has already
            been dealt with by the stage. */}
        <main
          className="canvas"
          ref={containerRef}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) clearSelection();
          }}
        >
          {mode === 'edit' ? (
            <EditStage
              shared={shared}
              slide={slide}
              designWidth={shared.designWidth}
              designHeight={shared.designHeight}
              scale={scale}
            />
          ) : (
            <PreviewStage
              shared={shared}
              slide={slide}
              slideIndex={slideIndex}
              slideCount={slides.length}
              designWidth={shared.designWidth}
              designHeight={shared.designHeight}
              scale={scale}
            />
          )}
        </main>
        <PaneDivider pane="inspector" />
        <Inspector />
      </div>
      <StatusBar fitScale={fitScale} />
      <StageContextMenu />

      {helpOpen && <ShortcutHelpDialog />}
      {importing && <ImportDialog />}
      {closing && <CloseConfirmDialog />}
      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    </div>
  );
}

/** A collapsed pane keeps its width in the store — it is what reopening
 *  restores — so the track it gets is zero rather than that width. */
function paneTrack(pane: { width: number; collapsed: boolean }): string {
  return `${pane.collapsed ? 0 : pane.width}px`;
}

const NUDGE = 1;
const NUDGE_LARGE = 10;
/** Zoom levels are a fixed ladder, so compare with a little slack. */
const ZOOM_EPSILON = 0.001;

/** Stacking order, on the keys PowerPoint uses. */
const ORDER_KEYS: { id: ShortcutId; change: OrderChange }[] = [
  { id: 'arrange.front', change: 'front' },
  { id: 'arrange.forward', change: 'forward' },
  { id: 'arrange.backward', change: 'backward' },
  { id: 'arrange.back', change: 'back' },
];

/** The direction is the arrow itself; `arrange.nudge` only says "an arrow". */
const NUDGE_MOVES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function stepZoom(direction: number, fitScale: number): void {
  const { zoomOverride, setZoomOverride } = useUiStore.getState();
  if (direction === 0) {
    setZoomOverride(null);
    return;
  }
  // Stepping out of "fit" starts from whatever the window is showing.
  const current = zoomOverride ?? fitScale;
  const next =
    direction > 0
      ? ZOOM_STEPS.find((step) => step > current + ZOOM_EPSILON)
      : [...ZOOM_STEPS].reverse().find((step) => step < current - ZOOM_EPSILON);
  if (next !== undefined) setZoomOverride(next);
}

/**
 * The application-wide half of the keyboard.
 *
 * Which keys these are lives in `shared/shortcuts`, not here — the menus and
 * the help sheet spell out the same table, and they used to drift. This
 * function is only the order the questions get asked in, which is what keeps
 * ⌘D apart from ⌘⇧D and "nudge" apart from "next slide".
 */
function useKeyboardShortcuts(slideCount: number, fitScale: number) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ui = useUiStore.getState();

      if (matchesShortcut('help.shortcuts', event)) {
        event.preventDefault();
        ui.setHelpOpen(!ui.helpOpen);
        return;
      }
      // The sheet is modal. Escape is its own (capture-phase) listener; every
      // other key stops here so nothing is edited behind an open dialog.
      if (ui.helpOpen) return;

      if (matchesShortcut('file.exportAs', event)) {
        event.preventDefault();
        void exportHtml(true);
        return;
      }
      if (matchesShortcut('file.export', event)) {
        event.preventDefault();
        void exportHtml();
        return;
      }
      if (matchesShortcut('edit.redo', event)) {
        event.preventDefault();
        redo();
        return;
      }
      if (matchesShortcut('edit.undo', event)) {
        event.preventDefault();
        undo();
        return;
      }

      // Typing in a form field must not drive the editor. Text inside the
      // stage is handled by the stage itself, which lives in its own document.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (activeTextSession()) return;

      if (matchesShortcut('file.import', event)) {
        event.preventDefault();
        void importHtml();
        return;
      }
      if (matchesShortcut('present.start', event)) {
        event.preventDefault();
        void startPresentation();
        return;
      }

      const hasSelection = useSelectionStore.getState().uid !== null;
      const editing = ui.mode === 'edit';

      // PowerPoint splits this in two — Ctrl+M adds a slide, Ctrl+⇧D duplicates
      // one — but blank slides were withdrawn, so both land on the one
      // operation this app has.
      if (editing && matchesShortcut('slide.add', event)) {
        event.preventDefault();
        const slide = useDocumentStore.getState().project.slides[ui.slideIndex];
        if (slide) execute(new DuplicateSlideCommand(slide.id));
        return;
      }

      if (editing && hasSelection && matchesShortcut('edit.duplicate', event)) {
        event.preventDefault();
        duplicateSelection();
        return;
      }

      // The element clipboard. Cut and copy need something to act on; paste
      // does not — with nothing selected it puts the element on the slide
      // itself, which is how it reaches an empty slide (core/editing/clipboard.ts).
      if (editing && hasSelection && matchesShortcut('edit.cut', event)) {
        event.preventDefault();
        cutSelection();
        return;
      }
      if (editing && hasSelection && matchesShortcut('edit.copy', event)) {
        event.preventDefault();
        copySelection();
        return;
      }
      if (editing && matchesShortcut('edit.paste', event)) {
        event.preventDefault();
        pasteClipboard();
        return;
      }

      // The format painter's keys, one modifier away from the three above.
      if (editing && hasSelection && matchesShortcut('edit.copyFormat', event)) {
        event.preventDefault();
        copyFormat();
        return;
      }
      if (editing && hasSelection && matchesShortcut('edit.pasteFormat', event)) {
        event.preventDefault();
        pasteFormat();
        return;
      }

      if (editing && hasSelection) {
        const order = ORDER_KEYS.find(({ id }) => matchesShortcut(id, event));
        if (order) {
          event.preventDefault();
          reorder(order.change);
          return;
        }
      }

      if (matchesShortcut('view.zoomFit', event)) {
        event.preventDefault();
        stepZoom(0, fitScale);
        return;
      }
      if (matchesShortcut('view.zoomIn', event)) {
        event.preventDefault();
        stepZoom(1, fitScale);
        return;
      }
      if (matchesShortcut('view.zoomOut', event)) {
        event.preventDefault();
        stepZoom(-1, fitScale);
        return;
      }

      if (editing && hasSelection && matchesShortcut('edit.delete', event)) {
        event.preventDefault();
        deleteSelection();
        return;
      }

      // Arrows nudge the selection when there is one, and page the deck when
      // there is not — the same key doing the obvious thing in both contexts.
      if (editing && hasSelection && matchesShortcut('arrange.nudge', event)) {
        const [dx, dy] = NUDGE_MOVES[event.key];
        const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
        event.preventDefault();
        nudge(dx * step, dy * step);
        return;
      }

      if (slideCount === 0) return;
      if (matchesShortcut('view.firstSlide', event)) ui.setSlideIndex(0);
      else if (matchesShortcut('view.lastSlide', event)) ui.setSlideIndex(slideCount - 1);
      else if (matchesShortcut('view.nextSlide', event)) ui.step(1, slideCount);
      else if (matchesShortcut('view.prevSlide', event)) ui.step(-1, slideCount);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [slideCount, fitScale]);
}
