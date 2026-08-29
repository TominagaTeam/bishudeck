/**
 * The origin `assets/...` references resolve against.
 *
 * Fetched once at startup and then read synchronously, because composing a
 * document happens during render and cannot wait on IPC. Before it arrives,
 * slides simply render without an asset base — which only matters for decks
 * that reference imported files.
 */

import { backend } from './backend';

let baseUrl = '';

export async function initAssetBase(): Promise<void> {
  try {
    baseUrl = await backend.previewBaseUrl();
  } catch {
    // Running outside Tauri (`npm run dev`): relative asset URLs still work.
    baseUrl = '';
  }
}

export function assetBaseUrl(): string {
  return baseUrl;
}
