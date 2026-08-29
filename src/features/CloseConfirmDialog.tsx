import { useClosePromptStore } from '../app/closePrompt';
import { ModalShell } from './ModalShell';
import { t } from '../shared/i18n';

/**
 * What to do about a deck that has never been written anywhere, asked as the
 * window is closing.
 *
 * Three answers, not two: the OS dialog this replaces had room for "write" and
 * "do not write", so a mis-hit × had no way out that did not either throw the
 * session away or write a file to a location the user had not chosen.
 */
export function CloseConfirmDialog() {
  const respond = useClosePromptStore((s) => s.respond);

  // Escape and the backdrop both mean "never mind": of the three answers, the
  // only one that loses neither the session nor an unasked-for file.
  return (
    <ModalShell onDismiss={() => respond('cancel')} className="narrow">
      <h1>{t('dialog.close.title')}</h1>
      <p className="modal-lead">
        {t('dialog.close.lead1')}
        <br />
        {t('dialog.close.lead2')}
      </p>

      <div className="modal-actions">
        <button onClick={() => respond('cancel')}>{t('dialog.close.stay')}</button>
        <button className="destructive" onClick={() => respond('discard')}>
          {t('dialog.close.discard')}
        </button>
        {/* Focused on open, so Enter takes the answer that loses nothing. */}
        <button className="primary" onClick={() => respond('export')} autoFocus>
          {t('dialog.close.export')}
        </button>
      </div>
    </ModalShell>
  );
}
