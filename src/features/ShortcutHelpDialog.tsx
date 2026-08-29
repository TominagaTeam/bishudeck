import { useEffect, useRef, useState } from 'react';

import { useUiStore } from '../app/uiStore';
import { currentKeyStyle, shortcutsByGroup, type KeyStyle } from '../shared/shortcuts';
import { ModalShell } from './ModalShell';
import { t } from '../shared/i18n';

const STYLE_TABS: { style: KeyStyle; label: string }[] = [
  { style: 'mac', label: 'Mac' },
  { style: 'pc', label: 'Windows / Linux' },
];

/**
 * The keyboard shortcut sheet.
 *
 * Every row is read out of `shared/shortcuts`, so what it lists is what the
 * handlers actually accept. The tabs are not a preference — they are here
 * because the same key is spelled ⌘⇧D on one machine and Ctrl+Shift+D on
 * another, and someone reading over a colleague's shoulder needs the other one.
 */
export function ShortcutHelpDialog() {
  const setHelpOpen = useUiStore((s) => s.setHelpOpen);
  const [style, setStyle] = useState<KeyStyle>(currentKeyStyle);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focused on open so Enter and Escape both close it — but without the scroll
  // the browser would otherwise do to bring the button into view, which starts
  // the sheet halfway down its own list.
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <ModalShell onDismiss={() => setHelpOpen(false)} className="shortcut-modal">
      <h1>{t('dialog.shortcuts.title')}</h1>

      <div className="key-style-tabs" role="group" aria-label={t('dialog.shortcuts.keyStyle')}>
        {STYLE_TABS.map((tab) => (
          <button
            key={tab.style}
            className={style === tab.style ? 'active' : ''}
            onClick={() => setStyle(tab.style)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="shortcut-sheet">
        {shortcutsByGroup(style).map((section) => (
          <section key={section.group}>
            <h2>{section.label}</h2>
            <dl>
              {section.entries.map(({ entry, label, note, keys }) => (
                <div key={entry.id}>
                  <dt>
                    {label}
                    {note && <span className="shortcut-note">{note}</span>}
                  </dt>
                  <dd>
                    <kbd>{keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <div className="modal-actions">
        <button className="primary" ref={closeRef} onClick={() => setHelpOpen(false)}>
          {t('dialog.close')}
        </button>
      </div>
    </ModalShell>
  );
}
