import { useMemo } from 'react';

import { buildProject } from '../import/pipeline';
import { composeSlideDocument } from '../core/document/compose';
import { useImportStore } from '../app/importStore';
import { ModalShell } from './ModalShell';
import { t } from '../shared/i18n';

const PREVIEW_COUNT = 4;
const PREVIEW_WIDTH = 200;

/**
 * Confirmation step for slide splitting.
 *
 * Detection is a heuristic and the cost of getting it wrong is a deck that has
 * to be reassembled by hand, so the guess is always shown as a set of real
 * rendered slides before anything is committed.
 */
export function ImportDialog() {
  const analysis = useImportStore((s) => s.analysis);
  const html = useImportStore((s) => s.html);
  const chosenId = useImportStore((s) => s.chosenId);
  const choose = useImportStore((s) => s.choose);
  const confirm = useImportStore((s) => s.confirm);
  const cancel = useImportStore((s) => s.cancel);

  const preview = useMemo(() => {
    if (!html || !chosenId) return null;
    try {
      const project = buildProject(html, chosenId);
      return {
        total: project.slides.length,
        docs: project.slides
          .slice(0, PREVIEW_COUNT)
          .map((slide) => composeSlideDocument(project.shared, slide, { mode: 'edit' })),
        aspect: project.shared.designHeight / project.shared.designWidth,
        width: project.shared.designWidth,
        height: project.shared.designHeight,
      };
    } catch {
      return null;
    }
  }, [html, chosenId]);

  if (!analysis) return null;

  // Dismissing is the same as キャンセル: the file has not been touched yet, so
  // nothing is lost but the dialog.
  return (
    <ModalShell onDismiss={cancel}>
      <h1>{t('dialog.import.title')}</h1>
      <p className="modal-lead">
        {t('dialog.import.lead')}
      </p>

      <ul className="candidates">
        {analysis.candidates.map((candidate) => (
          <li key={candidate.detectorId}>
            <label>
              <input
                type="radio"
                name="detector"
                checked={candidate.detectorId === chosenId}
                onChange={() => choose(candidate.detectorId)}
              />
              <span className="candidate-name">{candidate.description}</span>
              <span className="candidate-count">{t('dialog.import.slideCount', { count: candidate.slideCount })}</span>
              <span className="candidate-confidence">
                {t('dialog.import.confidence', { percent: Math.round(candidate.confidence * 100) })}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {preview && (
        <div className="import-preview">
          {preview.docs.map((doc, index) => (
            <div
              key={index}
              className="thumb"
              style={{ width: PREVIEW_WIDTH, height: PREVIEW_WIDTH * preview.aspect }}
            >
              <iframe
                className="thumb-frame"
                title={t('dialog.import.previewTitle', { index: index + 1 })}
                srcDoc={doc}
                sandbox="allow-same-origin"
                style={{
                  width: preview.width,
                  height: preview.height,
                  transform: `scale(${PREVIEW_WIDTH / preview.width})`,
                }}
              />
            </div>
          ))}
          {preview.total > PREVIEW_COUNT && (
            <span className="more">{t('dialog.import.more', { count: preview.total - PREVIEW_COUNT })}</span>
          )}
        </div>
      )}

      <div className="modal-actions">
        <button onClick={cancel}>{t('dialog.cancel')}</button>
        <button className="primary" onClick={confirm} disabled={!preview}>
          {t('dialog.import.confirm')}
        </button>
      </div>
    </ModalShell>
  );
}
