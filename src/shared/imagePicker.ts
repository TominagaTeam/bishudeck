/**
 * Choosing an image file and bringing it into the project's assets.
 *
 * Shared by everything that puts a picture on a slide: the toolbar's 画像
 * button, which inserts a new one, and the two doors into 画像を入れる — the
 * inspector's panel and a double-click on the box itself
 * (core/editing/imageFill.ts). They need the same three steps in the same order
 * and differ only in what they do with the reference afterwards, so the steps
 * live here and the difference stays at the call site.
 *
 * In `shared/` rather than beside the panel that first needed it: `stage/`
 * reaches for it too, and `stage → features` is the one direction the layering
 * does not have. `shared` is the crosscutting
 * layer every other one may call.
 */

import { open as openDialog } from '@tauri-apps/plugin-dialog';

import { backend } from './backend';
import { t } from './i18n';

/** What the file dialog offers, and what `importAsset` is expected to take. */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

/**
 * The reference to write into markup, or null when the dialog was dismissed.
 *
 * The path is relative on purpose: `assets/<name>` is what the export writes
 * next to the HTML file, and what `compose`'s `baseUrl` resolves against the
 * `slides://` origin while the deck is on the stage.
 */
export async function chooseImageAsset(): Promise<string | null> {
  const chosen = await openDialog({
    multiple: false,
    filters: [{ name: t('toolbar.imageFilter'), extensions: IMAGE_EXTENSIONS }],
  });
  if (typeof chosen !== 'string') return null;
  const name = await backend.importAsset(chosen);
  return `assets/${name}`;
}

/**
 * The first image among the paths a drag left behind, brought in as an asset.
 *
 * A drop hands over everything that was dragged, and what was dragged is not
 * necessarily one image: directories arrive as paths too, and selecting three
 * files and dragging them is one gesture. Taking the first image and ignoring
 * the rest is what the deck's own `<image-slot>` did with `dataTransfer.files[0]`
 * — a frame holds one picture, so a rule about the others would be inventing a
 * question the user did not ask.
 *
 * Null when nothing dragged in was an image, which is a normal outcome rather
 * than a failure: dropping a PDF on a photo frame should do nothing, quietly.
 */
export async function importDroppedImage(paths: readonly string[]): Promise<string | null> {
  const image = paths.find(isImagePath);
  if (!image) return null;
  const name = await backend.importAsset(image);
  return `assets/${name}`;
}

/** By extension only. The paths are the OS's, and reading them to find out what
 *  they hold is `import_asset`'s job — it is the side that can open the file.
 *  A directory has no extension to match, which is how those fall out. */
export function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.includes(path.slice(dot + 1).toLowerCase());
}
