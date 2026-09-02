/** Typed wrappers around the Rust commands. The only place `invoke` is called. */

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

import type { Project } from '../core/document/model';
import { detectPlatform, type Platform } from './platform';

/**
 * A file dragged in from outside the window.
 *
 * `paths` are absolute and may name directories as well as files; they arrive
 * on `enter` and `drop` only. `x` / `y` are viewport pixels — the same space
 * `getBoundingClientRect()` answers in — and mean nothing on `leave`.
 */
export interface FileDrag {
  kind: 'enter' | 'over' | 'drop' | 'leave';
  paths: string[];
  x: number;
  y: number;
}

/**
 * What Tauri calls a physical position, made into CSS pixels.
 *
 * The type says `PhysicalPosition` on both platforms and the two disagree about
 * what that means. macOS reads the point off `NSDraggingInfo.draggingLocation`
 * and the view's `frame`, which are AppKit *points* — already CSS pixels — and
 * hands them over unconverted. Windows runs `ScreenToClient`, which is device
 * pixels for real. So dividing everywhere would halve every coordinate on a
 * Retina display, and dividing nowhere would double them on a scaled Windows
 * desktop.
 *
 * The platform and the ratio are arguments rather than reads so that the rule
 * itself can be checked without a window to run in: this is a coordinate
 * conversion, and those get tests.
 */
export function toCssPixels(
  position: { x: number; y: number },
  platform: Platform,
  ratio: number,
): { x: number; y: number } {
  if (platform === 'mac') return { x: position.x, y: position.y };
  const scale = ratio || 1;
  return { x: position.x / scale, y: position.y / scale };
}

export const backend = {
  /** Publishes a composed document and returns the URL the iframe should load. */
  publishPreview(id: string, html: string): Promise<string> {
    return invoke<string>('publish_preview', { id, html });
  },

  clearPreviews(): Promise<void> {
    return invoke('clear_previews');
  },

  previewBaseUrl(): Promise<string> {
    return invoke<string>('preview_base_url');
  },

  readTextFile(path: string): Promise<string> {
    return invoke<string>('read_text_file', { path });
  },

  exportHtml(path: string, html: string): Promise<void> {
    return invoke('export_html', { path, html });
  },

  setLiveProject(project: Project): Promise<void> {
    return invoke('set_live_project', { project });
  },

  getLiveProject(): Promise<Project | null> {
    return invoke<Project | null>('get_live_project');
  },

  importAsset(path: string): Promise<string> {
    return invoke<string>('import_asset', { path });
  },

  putAssetBytes(extension: string, bytes: number[]): Promise<string> {
    return invoke<string>('put_asset_bytes', { extension, bytes });
  },

  listAssets(): Promise<string[]> {
    return invoke<string[]>('list_assets');
  },

  openPresentationWindow(startIndex: number): Promise<void> {
    return invoke('open_presentation_window', { startIndex });
  },

  closePresentationWindow(): Promise<void> {
    return invoke('close_presentation_window');
  },

  /**
   * Asks the backend to make this window's webview the first responder.
   *
   * Going fullscreen changes the window's style mask, which hands the keyboard
   * to the native view the webview sits in; until this is called back, nothing
   * the presentation listens for ever arrives (see `commands/window.rs`). It is
   * called from the presentation window itself because the command identifies
   * the webview by who invoked it.
   *
   * Only macOS has that style mask, so only macOS does anything here: the
   * command is a deliberate no-op elsewhere, and `commands/window.rs` holds the
   * reason — including why Windows must not make the underlying call at all.
   * The presentation asks unconditionally so the platform rule lives in one
   * place rather than being restated on this side.
   *
   * A failure is not worth surfacing — outside the app there is no webview to
   * focus, and inside it the presentation is still on screen either way.
   */
  async focusPresentationWebview(): Promise<void> {
    try {
      await invoke('focus_presentation_webview');
    } catch {
      /* not running under Tauri, or the window went away */
    }
  },

  /**
   * Fires in the presentation window when the editor starts a presentation and
   * the window is already built. Resolves to a teardown.
   *
   * The window is reused rather than closed (see `commands/window.rs`), so
   * every run after the first arrives as an event instead of a page load.
   */
  /**
   * Files dragged onto this window from the OS. Resolves to a teardown.
   *
   * Not the HTML5 `drop` event, and it cannot be: Tauri registers its own
   * handler on the native view and that handler always reports the drag as
   * consumed, so the WebView never sees a drag session at all — on macOS and
   * Windows both. Turning it off (`dragDropEnabled: false`) would give the
   * page its events back, but the payload would then be a `File` with no path
   * behind it, and `importAsset` takes a path. It would also hand Windows'
   * HTML5 drag-and-drop back to the slide list, which reorders with it
   * (features/SlideList.tsx) — a change with its own risk and no bearing on
   * this one.
   */
  async onFileDrag(handler: (event: FileDrag) => void): Promise<() => void> {
    try {
      return await getCurrentWindow().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'leave') {
          handler({ kind: 'leave', paths: [], x: 0, y: 0 });
          return;
        }
        // `devicePixelRatio` stands in for the window's scale factor: same
        // number, and synchronous, where `scaleFactor()` is a round trip to
        // the backend for a value that cannot have moved since layout.
        const point = toCssPixels(payload.position, detectPlatform(), window.devicePixelRatio);
        handler({
          kind: payload.type,
          // 'over' carries no paths: the OS says where the pointer is, not what
          // is under the cursor, until the drag either enters or lands.
          paths: 'paths' in payload ? payload.paths : [],
          x: point.x,
          y: point.y,
        });
      });
    } catch {
      return () => {};
    }
  },

  async onPresentStart(handler: (startIndex: number) => void): Promise<() => void> {
    try {
      // Window-scoped rather than global: the editor window has no business
      // hearing this. In a plain browser there is no window to listen on.
      return await getCurrentWindow().listen<number>('present:start', (event) => {
        handler(event.payload);
      });
    } catch {
      return () => {};
    }
  },
};
