import { useCallback, useEffect } from 'react';

import {
  align,
  deleteSelection,
  duplicateSelection,
  insertElement,
  reorder,
} from '../core/editing/actions';
import {
  copySelection,
  cutSelection,
  hasClipboardElement,
  pasteClipboard,
} from '../core/editing/clipboard';
import { useCropSession } from '../core/editing/crop';
import { copyFormat, hasCopiedFormat, pasteFormat } from '../core/editing/format';
import { fillSelectionFromPicker } from '../core/editing/imageFill';
import { TEXT_BOX_SIZE, defaultPlacement, shapeHtml } from '../core/editing/shapes';
import { insertTextBox, settlePendingTextBox } from '../core/editing/textBox';
import { useDocumentStore } from '../core/document/store';
import { useSelectionStore } from '../core/selection/store';
import { useStageContextMenu } from '../stage/contextMenuStore';
import { useSelectRequest } from '../stage/selectRequest';
import { useTextEditRequest } from '../stage/textEditRequest';
import { useUiStore } from '../app/uiStore';
import { ALIGNMENTS, ORDERING } from './arrangeItems';
import { ContextMenu } from './ContextMenu';
import { MenuItem, MenuLabel, MenuSeparator } from './Menu';
import { t } from '../shared/i18n';

/** Only the two that read as "put it in the middle"; the six edges stay in the toolbar. */
const CENTRING: typeof ALIGNMENTS = ALIGNMENTS.filter(
  ({ edge }) => edge === 'center' || edge === 'middle',
);

const RECTANGLE = { width: 320, height: 200 };

/**
 * The stage's right-click menu.
 *
 * Every item calls something that already exists and is already a command; this
 * only puts the operations where the pointer already is. The stage decides what
 * was clicked (see `stage/contextMenuStore.ts`) and this decides what to offer.
 */
export function StageContextMenu() {
  const target = useStageContextMenu((s) => s.target);
  const close = useStageContextMenu((s) => s.close);
  const focusOn = useSelectionStore((s) => s.focusOn);
  const mode = useUiStore((s) => s.mode);
  const hasSlides = useDocumentStore((s) => s.project.slides.length > 0);
  const shared = useDocumentStore((s) => s.project.shared);

  const place = useCallback(
    (width: number, height: number) =>
      defaultPlacement(shared.designWidth, shared.designHeight, width, height),
    [shared.designWidth, shared.designHeight],
  );

  // A preview must not outlive the menu that asked for it. Taking a row closes
  // the menu without a `pointerleave`, and Escape closes it without either, so
  // the dashed outline would be left on the stage with nothing pointing at it.
  useEffect(() => {
    if (!target) focusOn(null);
  }, [target, focusOn]);

  if (!target || mode !== 'edit' || !hasSlides) return null;

  // Narrowed once, so the item handlers below close over a plain string.
  const uid = target.uid;
  const stack = target.stack;

  return (
    <ContextMenu at={target.at} onClose={close}>
      {uid ? (
        <>
          {target.textEditable && (
            <MenuItem
              label={t('command.editText')}
              shortcut="select.editText"
              onSelect={() => useTextEditRequest.getState().request(uid)}
            />
          )}
          {target.croppable && (
            <MenuItem label={t('menu.crop')} onSelect={() => useCropSession.getState().start()} />
          )}
          {/* Next to トリミング because the two are the same question read at
              two moments — what to do about this box's picture — and never
              both true at once (`isFillable` refuses what `isCroppable`
              accepts). The inspector's image panel seats them the same way
              (features/inspector/decisions.md #66).

              Not awaited: the dialog is the OS's, and the click that opened
              this menu is over. The right-click already selected the box, so
              `fillSelectionFromPicker` finds what the pointer was on. */}
          {target.fillable && (
            <MenuItem
              label={t('menu.fillWithImage')}
              onSelect={() => void fillSelectionFromPicker()}
            />
          )}
          {/* Only worth listing when the point holds more than the one thing a
              plain click already gives. Pointing at a row outlines it on the
              stage, exactly as the breadcrumb does — `div.card` says nothing
              on its own about which box it means. */}
          {stack.length > 1 && (
            <>
              <MenuSeparator />
              <MenuLabel text={t('menu.atThisPoint')} />
              {stack.map((entry) => (
                <MenuItem
                  key={entry.uid}
                  label={entry.label}
                  disabled={entry.uid === uid}
                  onSelect={() => useSelectRequest.getState().request(entry.uid)}
                  onPreview={(on) => focusOn(on ? entry.uid : null)}
                />
              ))}
            </>
          )}
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

          {CENTRING.map(({ edge, label }) => (
            <MenuItem key={edge} label={label} onSelect={() => align(edge)} />
          ))}
          <MenuSeparator />

          <MenuItem label={t('action.edit.cut')} shortcut="edit.cut" onSelect={cutSelection} />
          <MenuItem label={t('action.edit.copy')} shortcut="edit.copy" onSelect={copySelection} />
          <MenuItem
            label={t('action.edit.paste')}
            shortcut="edit.paste"
            disabled={!hasClipboardElement()}
            onSelect={pasteClipboard}
          />
          <MenuSeparator />

          <MenuItem label={t('action.edit.copyFormat')} shortcut="edit.copyFormat" onSelect={copyFormat} />
          <MenuItem
            label={t('action.edit.pasteFormat')}
            shortcut="edit.pasteFormat"
            disabled={!hasCopiedFormat()}
            onSelect={pasteFormat}
          />
          <MenuSeparator />

          <MenuItem label={t('action.edit.duplicate')} shortcut="edit.duplicate" onSelect={duplicateSelection} />
          <MenuItem label={t('action.edit.delete')} shortcut="edit.delete" onSelect={deleteSelection} />
        </>
      ) : (
        <>
          <MenuItem
            label={t('shape.textBox')}
            onSelect={() => insertTextBox(place(TEXT_BOX_SIZE.width, TEXT_BOX_SIZE.height))}
          />
          <MenuItem
            label={t('shape.rectangle')}
            onSelect={() => {
              // As in the toolbar: the unused box is taken back while its
              // insertion is still revocable (core/editing/textBox.ts).
              settlePendingTextBox();
              insertElement(
                shapeHtml('rectangle', place(RECTANGLE.width, RECTANGLE.height)),
                t('command.insertShape', { shape: t('shape.rectangle') }),
              );
            }}
          />
          {/* Right-clicking the bare slide is how a paste is aimed at the slide
              itself rather than beside something (core/editing/clipboard.ts). */}
          {hasClipboardElement() && (
            <>
              <MenuSeparator />
              <MenuItem
                label={t('action.edit.paste')}
                shortcut="edit.paste"
                onSelect={pasteClipboard}
              />
            </>
          )}
        </>
      )}
    </ContextMenu>
  );
}
