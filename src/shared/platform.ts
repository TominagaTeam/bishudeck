/**
 * Which keyboard convention this build is running under.
 *
 * Shortcuts are *matched* the same way everywhere (see `shortcuts.ts`); this is
 * only about how they are spelled — ⌘⌥⇧ on macOS, `Ctrl+Alt+Shift+` elsewhere.
 * Reading it from `navigator` rather than an OS plugin keeps the answer
 * available in the browser too, where `npm run dev` runs outside Tauri.
 */
export type Platform = 'mac' | 'windows' | 'linux';

/** Modern Chromium hands the OS over here; everything else falls back. */
interface UserAgentData {
  platform?: string;
}

export function classifyPlatform(raw: string): Platform {
  const value = raw.toLowerCase();
  if (value.includes('mac') || value.includes('iphone') || value.includes('ipad')) return 'mac';
  if (value.includes('win')) return 'windows';
  return 'linux';
}

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'linux';
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  return classifyPlatform(data?.platform ?? navigator.platform ?? navigator.userAgent ?? '');
}
