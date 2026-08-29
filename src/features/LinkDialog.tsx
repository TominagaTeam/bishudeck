import { useState } from 'react';

import { ModalShell } from './ModalShell';
import { t } from '../shared/i18n';

/**
 * Asks for the address a run of text should point at.
 *
 * It replaces the app's last `window.prompt`. Two things were wrong with that
 * one, and the smaller is that it looked nothing like the rest of the app.
 * The larger is that a prompt is not the web platform's to give: in a WKWebView
 * it only appears if the embedder implements the text-input panel delegate, so
 * whether pressing リンク did anything at all was a property of the shell the
 * editor happened to be running in rather than of this code. A dialog the app
 * draws itself behaves the same in `npm run dev` and in `tauri dev`.
 *
 * It is deliberately rendered *inside* the 文字書式 panel rather than portalled
 * to `<body>`, even though it paints as a full-window overlay. The panel is what
 * carries `data-hse-text-tools`, and EditStage closes the text session on any
 * pointerdown that does not land under that marker — so a portalled dialog would
 * end the very session it is collecting a URL for the moment the user clicked
 * into the field. `.color-popup` sits where it does for the same reason
 * (app/styles.css). `position: fixed` still escapes the pane's `overflow`,
 * because nothing between here and the root carries a transform.
 */
export function LinkDialog({
  onCancel,
  onSubmit,
}: {
  onCancel(): void;
  onSubmit(href: string): void;
}) {
  const [value, setValue] = useState('');
  const href = normalizeHref(value);

  return (
    <ModalShell onDismiss={onCancel} className="narrow">
      <h1>{t('dialog.link.title')}</h1>

      <form
        className="link-fields"
        onSubmit={(event) => {
          event.preventDefault();
          if (href) onSubmit(href);
        }}
      >
        {/* The lead sits *under* the field rather than above it, which is both
            where the sentence is read — it is about what happens to what was
            just typed — and what gives the row above the buttons its 16px of
            air, since `.modal-lead` already carries that margin and
            `.field.compact` carries none. */}
        <label className="field compact">
          <span>{t('dialog.link.url')}</span>
          {/* `type="text"`, not `type="url"`: the native validation that comes
              with `url` rejects a bare `example.com`, which is the input this
              dialog is meant to accept and complete. `inputMode` still asks a
              touch keyboard for the right layout.

              Focused on open so the URL can be typed and Enter pressed without
              touching the mouse. Taking focus costs the frame its selection —
              which is precisely what the range snapshot exists to survive
              (core/editing/richText.ts), and EditStage took that snapshot on
              the pointerdown that opened this. */}
          <input
            type="text"
            inputMode="url"
            autoFocus
            value={value}
            placeholder="https://example.com"
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <p className="modal-lead">{t('dialog.link.lead')}</p>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t('dialog.cancel')}
          </button>
          {/* Disabled rather than accepting and doing nothing: an empty box and
              a `javascript:` URL both land here, and both would otherwise be
              answered by a dialog that closes as if it had worked. */}
          <button type="submit" className="primary" disabled={!href}>
            {t('dialog.link.apply')}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/**
 * Schemes that may be written as typed. Everything else on this list resolves
 * somewhere a slide can reasonably point.
 */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The one scheme that is refused outright.
 *
 * The editor's own frame runs no scripts (ADR-0002), so nothing here could be
 * made to fire — but the deck is *exported* as an HTML file and *previewed* in
 * a frame that does run scripts, and a link in the markup is a link the deck's
 * next reader clicks. Writing one is not something the リンク button needs to
 * be able to do.
 */
const SCRIPT_SCHEME = /^javascript:/i;

/**
 * What goes into `href`, or `null` for input that must not be written.
 *
 * A bare `example.com` is a *relative* path in HTML, and a deck is exported as
 * a file — so the link would resolve against that file's own directory and lead
 * nowhere, silently, on someone else's machine. Anything already carrying a
 * scheme (`https:`, `mailto:`), an in-page `#anchor`, or the protocol-relative
 * `//host` form is left exactly as typed; anything else is completed with
 * `https://`, which is what every address bar does with the same input.
 */
export function normalizeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (SCRIPT_SCHEME.test(value)) return null;
  if (SCHEME.test(value) || value.startsWith('#') || value.startsWith('//')) return value;
  return `https://${value}`;
}
