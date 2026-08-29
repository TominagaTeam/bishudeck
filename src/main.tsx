import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './app/App';
import { Present } from './app/Present';
import { initLocale } from './shared/i18n';
import { applyStoredTheme } from './shared/theme';
import './app/styles.css';

// Before anything renders: command labels are read at construction time, and a
// language settled later would leave the ones already built in the old one.
initLocale();

// Same reason, one layer out: a window that paints in one palette and then
// swaps to the other has already shown the wrong one.
applyStoredTheme();

/** The presentation window opens the same bundle on `#/present`. */
function Root() {
  const hash = window.location.hash;
  if (hash.startsWith('#/present')) {
    const start = Number(new URLSearchParams(hash.split('?')[1] ?? '').get('start') ?? 0);
    return <Present startIndex={Number.isFinite(start) ? start : 0} />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
