import { useDocumentStore } from '../core/document/store';
import { useSelectionStore } from '../core/selection/store';
import { ZOOM_STEPS, useUiStore } from '../app/uiStore';
import { t, type MessageKey } from '../shared/i18n';
import { THEMES, type ThemePreference } from '../shared/theme';

/** Named by key rather than by text: the catalog has to be read when the row
 *  renders rather than when this module is first loaded. */
const THEME_LABELS: Record<ThemePreference, MessageKey> = {
  system: 'status.themeSystem',
  light: 'status.themeLight',
  dark: 'status.themeDark',
};

export function StatusBar({ fitScale }: { fitScale: number }) {
  const slides = useDocumentStore((s) => s.project.slides);
  const framework = useDocumentStore((s) => s.project.shared.framework);
  const dirty = useDocumentStore((s) => s.dirty);
  const filePath = useDocumentStore((s) => s.filePath);
  const savedAt = useUiStore((s) => s.savedAt);
  const slideIndex = useUiStore((s) => s.slideIndex);
  const zoomOverride = useUiStore((s) => s.zoomOverride);
  const setZoomOverride = useUiStore((s) => s.setZoomOverride);
  const busy = useUiStore((s) => s.busy);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const ancestry = useSelectionStore((s) => s.ancestry);

  const effective = zoomOverride ?? fitScale;

  return (
    <footer className="status-bar">
      <span className="status-slot">
        {slides.length > 0 ? `${slideIndex + 1} / ${slides.length}` : '—'}
      </span>
      <span className="status-slot dim">{framework}</span>
      <span className="status-slot dim">{saveLabel(dirty, filePath, savedAt)}</span>
      <span className="status-path">{ancestry.map((s) => s.label).join(' › ')}</span>
      <span className="status-slot">{busy}</span>
      {/* Beside the zoom rather than in the toolbar: both are about how the
          workspace looks rather than about the deck, and neither belongs to a
          command. The zoom keeps the far end — it is the one that gets reached
          for mid-edit. */}
      <span className="status-slot">
        <select
          aria-label={t('status.theme')}
          title={t('status.theme')}
          value={theme}
          onChange={(e) => {
            // Narrowed by lookup rather than cast: a `value` that is not one of
            // the three is not a theme, whatever the DOM says it is.
            const next = THEMES.find((option) => option === e.target.value);
            if (next) setTheme(next);
          }}
        >
          {THEMES.map((option) => (
            <option key={option} value={option}>
              {t(THEME_LABELS[option])}
            </option>
          ))}
        </select>
      </span>
      <span className="status-slot">
        <select
          value={zoomOverride === null ? 'fit' : String(zoomOverride)}
          onChange={(e) =>
            setZoomOverride(e.target.value === 'fit' ? null : Number(e.target.value))
          }
        >
          <option value="fit">{t('status.zoomFit', { percent: Math.round(effective * 100) })}</option>
          {ZOOM_STEPS.map((step) => (
            <option key={step} value={step}>
              {step * 100}%
            </option>
          ))}
        </select>
      </span>
    </footer>
  );
}

/**
 * Writing is automatic once the deck has an HTML file, so the status bar has to
 * say where the document stands — silence would leave the user wondering
 * whether their work is on disk.
 */
function saveLabel(dirty: boolean, filePath: string | null, savedAt: number | null): string {
  if (!filePath) return dirty ? t('status.neverExported') : '';
  if (dirty) return t('status.dirty');
  if (!savedAt) return t('status.exported');
  const at = new Date(savedAt);
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return t('status.exportedAt', { time });
}
