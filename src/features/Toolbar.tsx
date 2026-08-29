import { execute, redo, undo, useHistory } from '../core/commands/engine';
import { DuplicateSlideCommand, RemoveSlideCommand } from '../core/commands/slide';
import {
  align,
  duplicateSelection,
  insertElement,
  reorder,
} from '../core/editing/actions';
import {
  TEXT_BOX_SIZE,
  defaultPlacement,
  imageHtml,
  shapeHtml,
  type ShapeKind,
} from '../core/editing/shapes';
import { insertTextBox, settlePendingTextBox } from '../core/editing/textBox';
import { useDocumentStore } from '../core/document/store';
import { editorEvents } from '../core/events/bus';
import { useSelectionStore } from '../core/selection/store';
import { exportHtml, importHtml, startPresentation } from '../app/actions';
import { useUiStore } from '../app/uiStore';
import { chooseImageAsset } from '../shared/imagePicker';
import { shortcutHint } from '../shared/shortcuts';
import {
  AlignIcon,
  EditIcon,
  ExportIcon,
  HelpIcon,
  ImportIcon,
  InsertIcon,
  PlayIcon,
  PreviewIcon,
  RedoIcon,
  SlideIcon,
  UndoIcon,
} from './icons';
import { Menu, MenuItem, MenuSeparator } from './Menu';
import { ALIGNMENTS, ORDERING } from './arrangeItems';
import { t, type MessageKey } from '../shared/i18n';

/** Named by key rather than by text: the name is reused inside the undo label,
 *  and `t()` has to run when the menu renders rather than when this module is
 *  first read (docs/features/i18n/design.md). */
const SHAPES: { kind: ShapeKind; labelKey: MessageKey; width: number; height: number }[] = [
  { kind: 'rectangle', labelKey: 'shape.rectangle', width: 320, height: 200 },
  { kind: 'ellipse', labelKey: 'shape.ellipse', width: 260, height: 260 },
  { kind: 'triangle', labelKey: 'shape.triangle', width: 260, height: 220 },
  { kind: 'line', labelKey: 'shape.line', width: 360, height: 8 },
  { kind: 'arrow', labelKey: 'shape.arrow', width: 360, height: 24 },
];

export function Toolbar() {
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);
  const slideIndex = useUiStore((s) => s.slideIndex);
  const setHelpOpen = useUiStore((s) => s.setHelpOpen);

  const slides = useDocumentStore((s) => s.project.slides);
  const shared = useDocumentStore((s) => s.project.shared);
  const dirty = useDocumentStore((s) => s.dirty);
  const hasSelection = useSelectionStore((s) => s.uid !== null);

  const canUndo = useHistory((s) => s.canUndo);
  const canRedo = useHistory((s) => s.canRedo);
  const undoLabel = useHistory((s) => s.undoLabel);
  const redoLabel = useHistory((s) => s.redoLabel);

  const current = slides[slideIndex];
  const editable = mode === 'edit' && Boolean(current);

  const place = (width: number, height: number) =>
    defaultPlacement(shared.designWidth, shared.designHeight, width, height);

  const insertImage = async () => {
    try {
      const src = await chooseImageAsset();
      if (!src) return;
      // The empty text box waiting to be typed into goes back first, while its
      // insertion is still the newest step and can be revoked outright
      // (core/editing/textBox.ts). Every place that asks the deck to change
      // shape has to say so; `insertElement` cannot say it for them, because
      // `textBox.ts` is the one calling `insertElement`.
      settlePendingTextBox();
      insertElement(imageHtml(src, place(480, 320)), t('command.insertShape', { shape: t('shape.image') }));
    } catch (cause) {
      editorEvents.emit('error', { message: t('error.insertImageFailed'), cause });
    }
  };

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <button onClick={importHtml}>
          <ImportIcon />
          {t('toolbar.import')}
        </button>
        <button
          onClick={() => exportHtml()}
          disabled={slides.length === 0}
          title={dirty ? t('toolbar.exportDirty') : t('toolbar.export')}
        >
          <ExportIcon />
          {t('toolbar.export')}
          {/* A dot rather than an asterisk: the same "unsaved" tell as the
              document badge in PowerPoint's title bar, and it does not push the
              label around when it appears. */}
          {dirty && <span className="dirty-dot" aria-hidden />}
        </button>
      </div>

      <div className="toolbar-group">
        <button onClick={undo} disabled={!canUndo} title={undoLabel ?? t('toolbar.undo')}>
          <UndoIcon />
          {t('toolbar.undo')}
        </button>
        <button onClick={redo} disabled={!canRedo} title={redoLabel ?? t('toolbar.redo')}>
          <RedoIcon />
          {t('toolbar.redo')}
        </button>
      </div>

      <div className="toolbar-group">
        <Menu label={t('toolbar.slide')} icon={<SlideIcon />}>
          <MenuItem
            label={t('action.edit.duplicate')}
            shortcut="slide.add"
            disabled={!current}
            onSelect={() => current && execute(new DuplicateSlideCommand(current.id))}
          />
          <MenuSeparator />
          <MenuItem
            label={t('action.edit.delete')}
            disabled={!current}
            onSelect={() => {
              if (!current) return;
              // The command says where to land, so undo lands there too.
              execute(new RemoveSlideCommand(current.id));
            }}
          />
        </Menu>

        <Menu label={t('toolbar.insert')} icon={<InsertIcon />} disabled={!editable}>
          <MenuItem
            label={t('shape.textBox')}
            onSelect={() => insertTextBox(place(TEXT_BOX_SIZE.width, TEXT_BOX_SIZE.height))}
          />
          <MenuItem label={t('shape.image')} onSelect={insertImage} />
          <MenuSeparator />
          {SHAPES.map(({ kind, labelKey, width, height }) => (
            <MenuItem
              key={kind}
              label={t(labelKey)}
              onSelect={() => {
                settlePendingTextBox();
                insertElement(
                  shapeHtml(kind, place(width, height)),
                  t('command.insertShape', { shape: t(labelKey) }),
                );
              }}
            />
          ))}
        </Menu>

        <Menu label={t('toolbar.arrange')} icon={<AlignIcon />} disabled={!editable || !hasSelection}>
          {ALIGNMENTS.map(({ edge, label }) => (
            <MenuItem key={edge} label={label} onSelect={() => align(edge)} />
          ))}
          <MenuSeparator />
          {ORDERING.map(({ change, label, shortcut }) => (
            <MenuItem
              key={change}
              label={label}
              shortcut={shortcut}
              onSelect={() => reorder(change)}
            />
          ))}
          <MenuSeparator />
          <MenuItem label={t('action.edit.duplicate')} shortcut="edit.duplicate" onSelect={duplicateSelection} />
        </Menu>
      </div>

      <div className="toolbar-group toolbar-modes">
        <button
          className={mode === 'edit' ? 'active' : ''}
          onClick={() => setMode('edit')}
          title={t('toolbar.modeEditHint')}
        >
          <EditIcon />
          {t('toolbar.modeEdit')}
        </button>
        <button
          className={mode === 'preview' ? 'active' : ''}
          onClick={() => setMode('preview')}
          title={t('toolbar.modePreviewHint')}
        >
          <PreviewIcon />
          {t('toolbar.modePreview')}
        </button>
      </div>

      <div className="toolbar-group toolbar-right">
        {/* One click, not two: the only thing behind it is the shortcut sheet,
            and a drop-down with a single item is a step that answers nothing. */}
        <button onClick={() => setHelpOpen(true)} title={t('toolbar.helpHint', { keys: shortcutHint('help.shortcuts') })}>
          <HelpIcon />
          {t('toolbar.help')}
        </button>
        <button className="primary" onClick={startPresentation} disabled={slides.length === 0}>
          <PlayIcon />
          {t('toolbar.present')}
        </button>
      </div>
    </header>
  );
}
