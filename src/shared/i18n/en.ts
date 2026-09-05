/**
 * English interface text.
 *
 * Every key here is one `ja.ts` has: the Japanese catalog is what the type is
 * built from, so an entry missing on this side is a compile error rather than
 * a blank label. Keys are flat and dotted for the same reason as there —
 * grepping one finds both the call site and the entry.
 *
 * American spelling throughout (color, center): it is the convention of the
 * software this app stands next to, and the one most readers expect on screen.
 *
 * Counts are phrased so that no entry has to agree in number with its value —
 * `Slides: {count}` rather than `{count} slides` — because the lookup has no
 * plural rules and is not getting any for the two entries that would use them.
 */

export const en = {
  /* ------------------------------------------------------------- commands */
  // Read as "what would be undone" in the tooltip of the undo and redo buttons.
  'command.editText': 'Edit text',
  'command.editList': 'Change list',
  'command.changeStyle': 'Change style',
  'command.duplicateSlide': 'Duplicate slide',
  'command.removeSlide': 'Delete slide',
  'command.moveSlide': 'Move slide',
  'command.move': 'Move',
  'command.align': 'Align',
  'command.reorder': 'Reorder',
  'command.deleteElement': 'Delete element',
  'command.duplicateElement': 'Duplicate element',
  'command.insertElement': 'Insert element',
  'command.cut': 'Cut',
  'command.paste': 'Paste',
  'command.pasteFormat': 'Paste format',
  'command.cropClear': 'Clear crop',
  'command.cropStart': 'Start crop',
  'command.cropRatio': 'Aspect ratio {ratio}',
  'command.cropFill': 'Fill frame',
  'command.cropFit': 'Fit to frame',
  'command.fillWithImage': 'Insert image',

  /* ---------------------------------------------------------------- error */
  'error.commandFailed': '{label} failed',
  'error.undoFailed': 'Could not undo {label}',
  'error.redoFailed': 'Could not redo {label}',

  /* ---------------------------------------------------------------- fonts */
  'font.group.default': 'Default',
  'font.group.japanese': 'Japanese',
  'font.group.latin': 'Latin',
  'font.defaultNamed': 'Default ({name})',
  'font.default': 'Default',

  /* ------------------------------------------------------- actions & keys */
  'shortcut.group.file': 'File',
  'shortcut.group.edit': 'Edit',
  'shortcut.group.arrange': 'Arrange',
  'shortcut.group.slide': 'Slide',
  'shortcut.group.view': 'View',
  'shortcut.group.select': 'Selection & text',
  'shortcut.group.present': 'Presenting',
  'shortcut.group.help': 'Help',

  'action.file.import': 'Import HTML',
  'action.file.export': 'Export (save)',
  'action.file.exportAs': 'Export as…',
  'action.edit.undo': 'Undo',
  'action.edit.redo': 'Redo',
  'action.edit.cut': 'Cut',
  'action.edit.copy': 'Copy',
  'action.edit.paste': 'Paste',
  'action.edit.paste.note': 'Lands beside the selected element, or on the slide when nothing is selected',
  'action.edit.duplicate': 'Duplicate',
  'action.edit.delete': 'Delete',
  'action.edit.copyFormat': 'Copy format',
  'action.edit.pasteFormat': 'Paste format',
  'action.arrange.front': 'Bring to front',
  'action.arrange.forward': 'Bring forward',
  'action.arrange.backward': 'Send backward',
  'action.arrange.back': 'Send to back',
  'action.arrange.nudge': 'Nudge selection',
  'action.arrange.nudge.note': '1px at a time; 10px with Shift',
  'action.slide.add': 'Add slide',
  'action.slide.add.note': 'Duplicates the current slide so the new one keeps its layout',
  'action.view.nextSlide': 'Next slide',
  'action.view.nextSlide.note': '→ or ↓ in the slide list, or when nothing is selected',
  'action.view.prevSlide': 'Previous slide',
  'action.view.prevSlide.note': '← or ↑ in the slide list, or when nothing is selected',
  'action.view.firstSlide': 'First slide',
  'action.view.lastSlide': 'Last slide',
  'action.view.zoomFit': 'Fit to window',
  'action.view.zoomIn': 'Zoom in',
  'action.view.zoomOut': 'Zoom out',
  'action.select.next': 'Next object',
  'action.select.prev': 'Previous object',
  'action.select.editText': 'Start editing text',
  'action.select.escape': 'Cancel / step out of the selection',
  'action.select.escape.note': 'Cancels a drag, ends cropping; otherwise moves the selection one level out',
  'action.present.start': 'Start presenting',
  'action.present.next': 'Next slide',
  'action.present.prev': 'Previous slide',
  'action.present.first': 'First slide',
  'action.present.last': 'Last slide',
  'action.present.end': 'End presentation',
  'action.help.shortcuts': 'Keyboard shortcuts',

  /* -------------------------------------------------------------- arrange */
  'action.align.left': 'Align left',
  'action.align.center': 'Center horizontally',
  'action.align.right': 'Align right',
  'action.align.top': 'Align top',
  'action.align.middle': 'Center vertically',
  'action.align.bottom': 'Align bottom',

  /* ------------------------------------------------------------- stage menu */
  'menu.crop': 'Crop',
  'menu.fillWithImage': 'Insert image',
  'menu.atThisPoint': 'Elements at this point',

  /* --------------------------------------------------------------- shapes */
  // Title case, because the name is also spliced into "Insert {shape}" and
  // that is how the undo tooltip has read in every slide editor before this
  // one ("Insert Text Box").
  'shape.textBox': 'Text Box',
  'shape.image': 'Image',
  'shape.rectangle': 'Rectangle',
  'shape.ellipse': 'Ellipse',
  'shape.triangle': 'Triangle',
  'shape.line': 'Line',
  'shape.arrow': 'Arrow',
  'command.insertShape': 'Insert {shape}',

  /* ---------------------------------------------------------------- status */
  'status.zoomFit': 'Fit to window ({percent}%)',
  'status.neverExported': 'Not exported (no destination yet)',
  'status.dirty': 'Unsaved changes',
  'status.exported': 'Exported',
  'status.exportedAt': 'Exported at {time}',
  'status.language': 'Language',
  'status.theme': 'Theme',
  'status.themeSystem': 'System',
  'status.themeLight': 'Light',
  'status.themeDark': 'Dark',

  /* ------------------------------------------------------------------ pane */
  // Pane names are lowercase because they only ever appear mid-sentence, in
  // the three entries above them.
  'pane.show': 'Show the {pane}',
  'pane.hide': 'Hide the {pane}',
  'pane.width': 'Width of the {pane}',
  'pane.slideList': 'slide list',
  'pane.inspector': 'inspector',
  'slideList.label': 'Slides',
  'slideList.empty': 'Import an HTML file',
  'slideList.emptyHint': 'and its slides appear here',

  /* ---------------------------------------------------------------- dialog */
  'dialog.shortcuts.title': 'Keyboard shortcuts',
  'dialog.shortcuts.keyStyle': 'Key labels',
  'dialog.close': 'Close',

  /* ------------------------------------------------------- import dialog */
  'dialog.import.title': 'Check how the slides are split',
  'dialog.import.lead': 'Each detector splits the file differently. Import once the split looks right.',
  'dialog.import.slideCount': 'Slides: {count}',
  'dialog.import.confidence': 'Confidence {percent}%',
  'dialog.import.previewTitle': 'Slide {index}',
  'dialog.import.more': '+{count} more',
  'dialog.import.confirm': 'Import',

  /* -------------------------------------------------------- close dialog */
  'dialog.close.title': 'You have changes that are not exported',
  'dialog.close.lead1': 'This deck has not been exported to an HTML file yet.',
  'dialog.close.lead2': 'If you quit without exporting, your edits will be lost.',
  'dialog.close.stay': 'Cancel',
  'dialog.close.discard': 'Quit without exporting',
  'dialog.close.export': 'Export and quit',

  /* ------------------------------------------------------------ link dialog */
  'dialog.link.title': 'Insert link',
  'dialog.link.lead': 'Links the selected text. You can leave out https:// and it will be added for you.',
  'dialog.link.url': 'URL',
  'dialog.link.apply': 'Insert',

  'dialog.cancel': 'Cancel',

  /* --------------------------------------------------------------- toolbar */
  'toolbar.import': 'Import HTML',
  'toolbar.export': 'Export',
  'toolbar.exportDirty': 'There are changes that are not exported',
  'toolbar.undo': 'Undo',
  'toolbar.redo': 'Redo',
  'toolbar.slide': 'Slide',
  'toolbar.insert': 'Insert',
  'toolbar.arrange': 'Arrange',
  'toolbar.modeEdit': 'Edit',
  'toolbar.modeEditHint': 'CSS stays live; JavaScript is paused while you edit',
  'toolbar.modePreview': 'Preview',
  'toolbar.modePreviewHint': 'Renders everything, JavaScript included',
  'toolbar.help': 'Help',
  'toolbar.helpHint': 'Keyboard shortcuts ({keys})',
  'toolbar.present': 'Present',
  'toolbar.imageFilter': 'Images',
  'error.insertImageFailed': 'Could not insert the image',

  /* ----------------------------------------------------------- text tools */
  'text.bold': 'Bold',
  'text.italic': 'Italic',
  'text.underline': 'Underline',
  'text.strikeThrough': 'Strikethrough',
  'text.activeHint': '{name} (on — click to remove)',
  'text.superscript': 'Superscript',
  'text.clearFormat': 'Clear formatting',
  'text.clear': 'Clear',
  'text.color': 'Color',
  'text.colorApply': 'Apply text color',
  'text.colorPalette': 'Choose a text color',
  'text.highlight': 'Highlight',
  'text.highlightApply': 'Apply highlight',
  'text.highlightPalette': 'Choose a highlight color',
  'text.colorMore': 'More colors…',
  'text.size': 'Size',
  'text.font': 'Font',
  'text.bulletList': 'Bullets',
  'text.numberedList': 'Numbers',
  'text.link': 'Link',
  'text.fontUnset': 'Not set',
  'text.rangeOnly': '{name} (double-click the text to start editing, then select a range)',

  /* ------------------------------------------------------------ inspector */
  'inspector.previewLocked': 'Switch to Edit to make changes',
  'inspector.noSelection': 'Click an element to select it',
  'inspector.selection': 'Selection',
  'inspector.textFormat': 'Text',
  'inspector.textFormatHint': 'Applies to the whole element. Double-click the text to format part of it',
  'inspector.textFormatHintRange': 'Character formatting applies to the selected range. With nothing selected, it applies to what you type next',
  'inspector.mixed': '—',
  'inspector.elementScope': '{name} (applies to the whole element, whatever is selected)',
  'inspector.weightScope': 'Weight (the selected range, or the whole element when nothing is selected)',
  'inspector.disabledText': 'Select an element that has text',
  'inspector.disabledImage': 'Select an image, or a box with no text in it',
  'inspector.disabledGeometry': 'Finish editing the text first',
  'inspector.color': 'Color',
  'inspector.weight': 'Weight',
  'inspector.textAlign': 'Align',
  'inspector.paragraph': 'List',
  'inspector.insert': 'Insert',
  'inspector.alignLeft': 'Left',
  'inspector.alignCenter': 'Center',
  'inspector.alignRight': 'Right',
  'inspector.box': 'Box',
  'inspector.padding': 'Padding',
  'inspector.radius': 'Radius',
  'inspector.paddingPerSide': 'Per side',
  'inspector.paddingUniform': 'All sides',
  'inspector.sideTop': 'Top',
  'inspector.sideRight': 'Right',
  'inspector.sideBottom': 'Bottom',
  'inspector.sideLeft': 'Left',
  'inspector.opacity': 'Opacity',
  'inspector.image': 'Image',
  'inspector.cropEnd': 'Done cropping',
  'inspector.cropHint': 'Drag the corners and edges to crop; drag inside the frame to reposition',
  'inspector.cropHintIdle': 'Press "Crop" to adjust the frame and use the controls below',
  'inspector.cropDisabled': '{name} (available while cropping)',
  'inspector.aspectRatio': 'Ratio',
  'inspector.fitToFrame': 'Frame',
  'inspector.fill': 'Fill',
  'inspector.fit': 'Fit',
  'inspector.resetImage': 'Restore the original image',
  'inspector.fillWithImage': 'Insert image',
  'inspector.fillHint': 'Replaces the contents of the selected box with an image',
  'inspector.background': 'Fill',
  'inspector.backgroundApply': 'Apply fill color',
  'inspector.backgroundPalette': 'Choose a fill color',
  'inspector.transparent': 'None',
  'inspector.solid': 'Solid',
  'inspector.reset': 'Reset',
  'inspector.border': 'Border',
  'inspector.borderStyle': 'Style',
  'inspector.borderColorApply': 'Apply border color',
  'inspector.borderColorPalette': 'Choose a border color',
  'inspector.borderNone': 'None',
  'inspector.borderSolid': 'Solid',
  'inspector.borderDashed': 'Dashed',
  'inspector.borderDotted': 'Dotted',
  'inspector.geometry': 'Position & size',
  // Row labels sit in a 56px column (36px in the geometry grid), and what
  // fits there is a word, not a phrase: "Width" is the undo label
  // (`command.setGeometry`), "W" is the row.
  'inspector.width': 'W',
  'inspector.height': 'H',
  'inspector.rotation': 'Angle',
  'command.setGeometry': 'Position & size',
  'command.setPadding': 'Padding',
  'command.setRadius': 'Corner radius',

  /* ---------------------------------------------------------------- stage */
  'stage.empty': 'No slides',
  'stage.editTitle': 'Slide editor',
  'stage.previewTitle': 'Slide preview',
  'stage.loadingTitle': 'Loading slide',
  'stage.textBoxPlaceholder': 'Type here',
  'command.duplicateAndMove': 'Duplicate and move',
  'command.resize': 'Resize',
  'command.rotate': 'Rotate',
  'command.crop': 'Crop',

  /* --------------------------------------------------------------- import */
  'import.parsing': 'Reading the HTML…',
  'import.unwrapping': 'Unpacking the Artifacts bundle…',
  'import.exporting': 'Exporting…',
  'import.exported': 'Exported the HTML',
  'import.fontsInlined': 'Kept {kept} embedded fonts and dropped {dropped} that nothing uses',
  // Noun phrases rather than sentences, so that the joined summary reads the
  // same whichever of them comes first.
  'import.propsResolved': '{count} variables expanded to their defaults',
  'import.imageSlots': '{count} photo frames turned into placeholders',
  'import.listSeparator': ', ',
  'import.filledSummary': '{items}',
  'import.detector.classSlide': 'Elements with "slide" in their class',
  'import.detector.dataSlide': 'data-slide attribute',
  'import.detector.section': 'Consecutive <section> elements',
  'import.detector.article': 'Consecutive <article> elements',
  'import.detector.fullHeight': 'Consecutive full-height blocks',
  'import.detector.single': 'No split (treat as one slide)',
  'import.detector.deckStage': 'Claude Artifacts deck (deck-stage)',
  'import.detector.swiper': 'Swiper / carousel',

  /* ---------------------------------------------------------------- error */
  'error.noSlidesDetected': 'No slides were found',
  'error.readHtmlFailed': 'Could not read the HTML',
  'error.exportFailed': 'Export failed',
  'error.presentFailed': 'Could not start the presentation',
  'error.autosaveFailed': 'Autosave failed',
  'error.importFailed': 'Import failed',
  'error.previewInitFailed': 'Could not set up the preview',
  'error.slideRenderFailed': 'Could not render the slide',

} as const;
