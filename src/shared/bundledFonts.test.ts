import { describe, expect, it } from 'vitest';

import { attachBundledFonts, bundledFontStylesheetUrl } from './bundledFonts';

function blankDocument(): Document {
  return document.implementation.createHTMLDocument('');
}

describe('bundledFontStylesheetUrl', () => {
  it('hangs the stylesheet off the preview origin', () => {
    // Not off the app's own origin: the preview frame is sandboxed without
    // `allow-same-origin`, and Tauri only lets the window's origin read what it
    // serves the frontend. `slides://` answers everyone.
    expect(bundledFontStylesheetUrl('slides://localhost')).toBe('slides://localhost/fonts/fonts.css');
  });

  it('does not double the separator when the origin brings its own', () => {
    expect(bundledFontStylesheetUrl('http://slides.localhost/')).toBe(
      'http://slides.localhost/fonts/fonts.css',
    );
  });

  it('has nothing to point at outside Tauri', () => {
    // `npm run dev` in a plain browser, where `slides://` is not registered.
    expect(bundledFontStylesheetUrl('')).toBeNull();
  });
});

describe('attachBundledFonts', () => {
  it('registers the faces in the document it is given', () => {
    const doc = blankDocument();
    expect(attachBundledFonts(doc, 'slides://localhost')).toBe(true);

    const link = doc.head.querySelector('link[rel="stylesheet"]');
    expect(link?.getAttribute('href')).toBe('slides://localhost/fonts/fonts.css');
  });

  it('is safe to call twice', () => {
    // React runs effects twice under StrictMode, and two copies of 140
    // `@font-face` rules is not free.
    const doc = blankDocument();
    attachBundledFonts(doc, 'slides://localhost');
    attachBundledFonts(doc, 'slides://localhost');
    expect(doc.head.querySelectorAll('link')).toHaveLength(1);
  });

  it('adds nothing when there is no origin to ask', () => {
    const doc = blankDocument();
    expect(attachBundledFonts(doc, '')).toBe(false);
    expect(doc.head.querySelectorAll('link')).toHaveLength(0);
  });
});
