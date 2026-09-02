/**
 * Japanese interface text.
 *
 * Keys are flat and dotted so that grepping one finds both the call site and
 * the entry here; a nested shape would leave the caller's string appearing
 * nowhere in this file.
 *
 * Proper nouns are not here. Typeface names stay in `shared/fonts.ts`: the name
 * of a typeface is the same in every language, and translating it would leave
 * the reader unable to tell which one they were choosing.
 */

export const ja = {
  /* ------------------------------------------------------------- commands */
  // Shown in the tooltip of the undo and redo buttons, so they read as "what
  // would be undone" rather than as button labels.
  'command.editText': 'テキストを編集',
  'command.editList': 'リストを変更',
  'command.changeStyle': 'スタイルを変更',
  'command.duplicateSlide': 'スライドを複製',
  'command.removeSlide': 'スライドを削除',
  'command.moveSlide': 'スライドを移動',
  'command.move': '移動',
  'command.align': '整列',
  'command.reorder': '重ね順を変更',
  'command.deleteElement': '要素を削除',
  'command.duplicateElement': '要素を複製',
  'command.insertElement': '要素を挿入',
  'command.cut': '切り取り',
  'command.paste': '貼り付け',
  'command.pasteFormat': '書式を貼り付け',
  'command.cropClear': 'トリミングを解除',
  'command.cropStart': 'トリミングを開始',
  'command.cropRatio': '縦横比 {ratio}',
  'command.cropFill': '枠を塗りつぶす',
  'command.cropFit': '枠にはめ込む',
  'command.fillWithImage': '画像を入れる',

  /* ---------------------------------------------------------------- error */
  'error.commandFailed': '{label} に失敗',
  'error.undoFailed': '{label} の取り消しに失敗',
  'error.redoFailed': '{label} のやり直しに失敗',

  /* ---------------------------------------------------------------- fonts */
  // The groups, and the one entry that is not a typeface name. Names themselves
  // are proper nouns and stay in `shared/fonts.ts`.
  'font.group.default': '既定',
  'font.group.japanese': '日本語',
  'font.group.latin': '欧文',
  /* 既定スタックの見出し。{name} には「この環境で実際に当たる書体」が入る —
     先頭に書いてある Noto Sans とは限らないので、名前は実測で決める
     (shared/fonts.ts の defaultChoice)。閉じた <select> には optgroup の
     「既定」が出ないので、この 1 行だけで既定だと分かる必要がある */
  'font.defaultNamed': '既定({name})',
  /* 測る手段が無いとき(canvas が使えない環境)。名乗れる書体が決まらない */
  'font.default': '既定',

  /* ------------------------------------------------------- actions & keys */
  // `action.*` names what an operation *is*, so the menu item and the help
  // sheet's row read from one entry rather than drifting apart. Keyed by the
  // shortcut's own id, so `shared/shortcuts.ts` does not repeat the name.
  // `shortcut.group.*` heads the sections of the help sheet and is only its.
  'shortcut.group.file': 'ファイル',
  'shortcut.group.edit': '編集',
  'shortcut.group.arrange': '配置',
  'shortcut.group.slide': 'スライド',
  'shortcut.group.view': '表示',
  'shortcut.group.select': '選択とテキスト',
  'shortcut.group.present': '再生中',
  'shortcut.group.help': 'ヘルプ',

  'action.file.import': 'HTML を取り込む',
  'action.file.export': '書き出し(保存)',
  'action.file.exportAs': '名前を付けて書き出し',
  'action.edit.undo': '元に戻す',
  'action.edit.redo': 'やり直す',
  'action.edit.cut': '切り取り',
  'action.edit.copy': 'コピー',
  'action.edit.paste': '貼り付け',
  'action.edit.paste.note': '選んでいる要素の隣に入る。選択が無ければスライドの上に置かれる',
  'action.edit.duplicate': '複製',
  'action.edit.delete': '削除',
  'action.edit.copyFormat': '書式をコピー',
  'action.edit.pasteFormat': '書式を貼り付け',
  'action.arrange.front': '最前面へ',
  'action.arrange.forward': '前面へ',
  'action.arrange.backward': '背面へ',
  'action.arrange.back': '最背面へ',
  'action.arrange.nudge': '選択を動かす',
  'action.arrange.nudge.note': '1px ずつ。Shift で 10px',
  'action.slide.add': 'スライドを追加',
  'action.slide.add.note': '隣のスライドの体裁を引き継いで複製する',
  'action.view.nextSlide': '次のスライドへ',
  'action.view.nextSlide.note': 'スライド一覧の中、または選択が無いときの → ↓ キー',
  'action.view.prevSlide': '前のスライドへ',
  'action.view.prevSlide.note': 'スライド一覧の中、または選択が無いときの ← ↑ キー',
  'action.view.firstSlide': '先頭のスライドへ',
  'action.view.lastSlide': '末尾のスライドへ',
  'action.view.zoomFit': '画面に合わせる',
  'action.view.zoomIn': '拡大',
  'action.view.zoomOut': '縮小',
  'action.select.next': '次のオブジェクトへ',
  'action.select.prev': '前のオブジェクトへ',
  'action.select.editText': 'テキスト編集を開始',
  'action.select.escape': '取り消し / 選択を外へ',
  'action.select.escape.note': 'ドラッグ中は取り消し、トリミング中は終了、それ以外は選択を 1 階層外へ',
  'action.present.start': '再生を開始',
  'action.present.next': '次のスライド',
  'action.present.prev': '前のスライド',
  'action.present.first': '先頭へ',
  'action.present.last': '末尾へ',
  'action.present.end': '再生を終了',
  'action.help.shortcuts': 'キーボードショートカット',

  /* -------------------------------------------------------------- arrange */
  // The alignment menu. Ordering keys are in `features/arrangeItems.ts`.
  'action.align.left': '左揃え',
  'action.align.center': '左右中央',
  'action.align.right': '右揃え',
  'action.align.top': '上揃え',
  'action.align.middle': '上下中央',
  'action.align.bottom': '下揃え',

  /* ------------------------------------------------------------- stage menu */
  'menu.crop': 'トリミング',
  'menu.fillWithImage': '画像を入れる',
  'menu.atThisPoint': 'この位置にあるもの',

  /* --------------------------------------------------------------- shapes */
  // The name of the thing, used both as the menu item and inside the undo
  // label. Interpolated rather than concatenated: a language that puts the verb
  // first cannot be served by gluing "を挿入" onto the end.
  'shape.textBox': 'テキストボックス',
  'shape.image': '画像',
  'shape.rectangle': '四角形',
  'shape.ellipse': '楕円',
  'shape.triangle': '三角形',
  'shape.line': '直線',
  'shape.arrow': '矢印',
  'command.insertShape': '{shape}を挿入',

  /* ---------------------------------------------------------------- status */
  'status.zoomFit': '画面に合わせる ({percent}%)',
  'status.neverExported': '未書き出し(書き出し先が未設定)',
  'status.dirty': '変更あり',
  'status.exported': '書き出し済み',
  'status.exportedAt': '書き出し済み {time}',
  'status.theme': 'テーマ',
  'status.themeSystem': 'システム',
  'status.themeLight': 'ライト',
  'status.themeDark': 'ダーク',

  /* ------------------------------------------------------------------ pane */
  'pane.show': '{pane}を表示',
  'pane.hide': '{pane}を隠す',
  'pane.width': '{pane}の幅',
  'pane.slideList': 'スライド一覧',
  'pane.inspector': 'インスペクタ',
  'slideList.label': 'スライド一覧',
  'slideList.empty': 'HTML を取り込むと',
  'slideList.emptyHint': 'ここに一覧が出ます',

  /* ---------------------------------------------------------------- dialog */
  'dialog.shortcuts.title': 'キーボードショートカット',
  'dialog.shortcuts.keyStyle': 'キーの表記',
  'dialog.close': '閉じる',

  /* ------------------------------------------------------- import dialog */
  'dialog.import.title': 'スライドの分割を確認',
  'dialog.import.lead': '検出方法を選ぶと分割結果が変わります。問題なければ取り込んでください。',
  'dialog.import.slideCount': '{count} 枚',
  'dialog.import.confidence': '確信度 {percent}%',
  'dialog.import.previewTitle': '{index} 枚目',
  'dialog.import.more': 'ほか {count} 枚',
  'dialog.import.confirm': '取り込む',

  /* -------------------------------------------------------- close dialog */
  'dialog.close.title': '書き出していない変更があります',
  'dialog.close.lead1': 'このデッキはまだ HTML に書き出されていません。',
  'dialog.close.lead2': '書き出さずに終了すると、編集した内容は残りません。',
  'dialog.close.stay': '終了をキャンセル',
  'dialog.close.discard': '書き出さずに終了',
  'dialog.close.export': '書き出して終了',

  /* ------------------------------------------------------------ link dialog */
  'dialog.link.title': 'リンクを挿入',
  /* スキームの補完を先に言う。「example.com と打っても大丈夫」が分からないと、
     https:// を打ち忘れた相対リンクが書き出した HTML に残る */
  'dialog.link.lead': '選んだ文字にリンクを付けます。https:// を省いて打っても補われます。',
  'dialog.link.url': 'URL',
  'dialog.link.apply': '挿入',

  'dialog.cancel': 'キャンセル',

  /* --------------------------------------------------------------- toolbar */
  'toolbar.import': 'HTML を取り込む',
  'toolbar.export': '書き出し',
  'toolbar.exportDirty': '書き出していない変更があります',
  'toolbar.undo': '元に戻す',
  'toolbar.redo': 'やり直す',
  'toolbar.slide': 'スライド',
  'toolbar.insert': '挿入',
  'toolbar.arrange': '配置',
  'toolbar.modeEdit': '編集',
  'toolbar.modeEditHint': 'CSS はそのまま、JavaScript を停止して編集',
  'toolbar.modePreview': 'プレビュー',
  'toolbar.modePreviewHint': 'JavaScript を含め完全に再現',
  'toolbar.help': 'ヘルプ',
  'toolbar.helpHint': 'キーボードショートカット({keys})',
  'toolbar.present': '再生',
  'toolbar.imageFilter': '画像',
  'error.insertImageFailed': '画像の挿入に失敗',

  /* ----------------------------------------------------------- text tools */
  'text.bold': '太字',
  'text.italic': '斜体',
  'text.underline': '下線',
  'text.strikeThrough': '取り消し線',
  'text.activeHint': '{name}(適用中 — 押すと外す)',
  'text.superscript': '上付き',
  'text.clearFormat': '書式を解除',
  'text.clear': '解除',
  'text.color': '文字色',
  'text.colorApply': '文字色を適用',
  'text.colorPalette': '文字色を選ぶ',
  'text.highlight': '蛍光',
  'text.highlightApply': '蛍光色を適用',
  'text.highlightPalette': '蛍光色を選ぶ',
  'text.colorMore': 'その他の色',
  'text.size': 'サイズ',
  'text.font': 'フォント',
  'text.bulletList': '箇条書き',
  'text.numberedList': '番号',
  'text.link': 'リンク',
  'text.fontUnset': '指定なし',
  /* 範囲にしか効かないコントロールが無効なときの理由。パネル上部のヒントと
     同じことを言うが、そちらは段落で、こちらは押した指の下に出る */
  'text.rangeOnly': '{name}(ダブルクリックで編集を始めると使えます)',

  /* ------------------------------------------------------------ inspector */
  'inspector.previewLocked': 'プレビュー中は編集できません',
  'inspector.noSelection': '要素をクリックすると選択できます',
  'inspector.selection': '選択中',
  'inspector.textFormat': '文字書式',
  'inspector.textFormatHint': '選択した要素全体に適用。ダブルクリックで編集を始めると、文字ごとの書式も使えます',
  /* 「文字の書式は」で始まるのは、この枠に範囲を無視する操作が混ざっているから。
     行揃えは段落の性質なので範囲によらず要素全体に効く（TextFormatControls）。
     ヒント本体で例外を並べると 280px の枠で 3 行になるので、
     例外の側（行揃えの title / 太さの title）に書き分けた */
  'inspector.textFormatHintRange': '文字の書式は選んだ範囲に適用。範囲を選ばずに押すと、これから打つ文字に効きます',
  /* 選択が 1 つの値に定まらないとき、閉じたセレクトに出る読み。
     選べる項目ではない（disabled hidden） */
  'inspector.mixed': '—',
  'inspector.elementScope': '{name}(範囲によらず要素全体に効きます)',
  'inspector.weightScope': '太さ(範囲を選べばその範囲だけ、選ばなければ要素全体)',
  /* 無効なパネルの summary に出る。「なぜ使えないか」ではなく
     「何をすれば使えるか」を言う — 前者は現状の言い換えにしかならない */
  'inspector.disabledText': '文字を持つ要素を選ぶと使えます',
  /* 画像パネルは 2 つの役をひとつの席で持つ — 画像ならトリミング、
     画像でない箱なら「画像を入れる」。無効になるのは文字を持つ要素と、
     中に何も入れられない要素(svg・video)だけ (core/editing/imageFill.ts) */
  'inspector.disabledImage': '画像か、文字の入っていない箱を選ぶと使えます',
  'inspector.disabledGeometry': '文字の編集を終えると使えます',
  'inspector.color': '色',
  'inspector.weight': '太さ',
  'inspector.textAlign': '行揃え',
  'inspector.paragraph': '段落',
  'inspector.insert': '挿入',
  'inspector.alignLeft': '左',
  'inspector.alignCenter': '中央',
  'inspector.alignRight': '右',
  'inspector.box': 'ボックス',
  'inspector.padding': '余白',
  'inspector.radius': '角丸',
  'inspector.paddingPerSide': '辺ごと',
  'inspector.paddingUniform': '一括',
  'inspector.sideTop': '上',
  'inspector.sideRight': '右',
  'inspector.sideBottom': '下',
  'inspector.sideLeft': '左',
  'inspector.opacity': '不透明度',
  'inspector.image': '画像',
  'inspector.cropEnd': 'トリミングを終了',
  'inspector.cropHint': '枠の角と辺で切り取り、内側のドラッグで位置を合わせる',
  /* トリミングを始めるまでの案内。文字書式の 2 つのヒントと同じ形で、
     いま無効な行が何をすれば効くようになるかを言う */
  'inspector.cropHintIdle': '「トリミング」を押すと、枠の調整と下の操作が使えます',
  'inspector.cropDisabled': '{name}(トリミングを始めると使えます)',
  'inspector.aspectRatio': '縦横比',
  'inspector.fitToFrame': '枠に合わせ',
  'inspector.fill': '塗りつぶし',
  'inspector.fit': 'はめ込み',
  'inspector.resetImage': '元の画像に戻す',
  /* 画像を持たない箱を選んだときの画像パネル。デッキ本来の写真枠
     (取り込みで破線のプレースホルダになる)に写真を入れる経路でもある */
  'inspector.fillWithImage': '画像を入れる',
  'inspector.fillHint': '選んでいる箱の中身が画像に置き換わります',
  'inspector.background': '背景',
  /* 塗り・枠線の色も文字色と同じ分割ボタン (ColorPicker) を使う。
     文言の形も揃える —— 左は「適用」、右は「選ぶ」 */
  'inspector.backgroundApply': '塗りの色を適用',
  'inspector.backgroundPalette': '塗りの色を選ぶ',
  'inspector.transparent': '透明',
  'inspector.solid': '単色',
  'inspector.reset': '解除',
  'inspector.border': '枠線',
  'inspector.borderStyle': '種類',
  'inspector.borderColorApply': '枠線の色を適用',
  'inspector.borderColorPalette': '枠線の色を選ぶ',
  'inspector.borderNone': 'なし',
  'inspector.borderSolid': '実線',
  'inspector.borderDashed': '破線',
  'inspector.borderDotted': '点線',
  'inspector.geometry': '位置とサイズ',
  'inspector.width': '幅',
  'inspector.height': '高さ',
  'inspector.rotation': '回転',
  'command.setGeometry': '位置とサイズ',
  'command.setPadding': '余白',
  'command.setRadius': '角丸',

  /* ---------------------------------------------------------------- stage */
  'stage.empty': 'スライドがありません',
  'stage.editTitle': 'スライド編集',
  'stage.previewTitle': 'スライドプレビュー',
  'stage.loadingTitle': 'スライド読み込み中',
  // Painted by the stage into an empty text box while it is being edited, and
  // never part of the document: nothing of it reaches the saved HTML.
  'stage.textBoxPlaceholder': 'テキストを入力',
  'command.duplicateAndMove': '複製して移動',
  'command.resize': 'サイズ変更',
  'command.rotate': '回転',
  'command.crop': 'トリミング',

  /* --------------------------------------------------------------- import */
  'import.parsing': 'HTML を解析中…',
  'import.unwrapping': 'Artifacts の同梱データを展開中…',
  'import.exporting': '書き出し中…',
  'import.exported': 'HTML を書き出しました',
  'import.fontsInlined': '埋め込みフォント {kept} 件を取り込みました(未使用の {dropped} 件は除外)',
  'import.propsResolved': '変数 {count} 件を既定値に展開',
  'import.imageSlots': '写真枠 {count} 件をプレースホルダに変換',
  // The joiner and the trailing verb are grammar, not decoration: a language
  // that does not build sentences this way needs both to be its own.
  'import.listSeparator': '、',
  'import.filledSummary': '{items}しました',
  'import.detector.classSlide': 'class に slide を含む要素',
  'import.detector.dataSlide': 'data-slide 属性',
  'import.detector.section': '<section> の連続',
  'import.detector.article': '<article> の連続',
  'import.detector.fullHeight': '画面高いっぱいのブロックの連続',
  'import.detector.single': '分割なし(1 枚として扱う)',
  'import.detector.deckStage': 'Claude Artifacts のデッキ (deck-stage)',
  'import.detector.swiper': 'Swiper / カルーセル',

  /* ---------------------------------------------------------------- error */
  'error.noSlidesDetected': 'スライドを検出できませんでした',
  'error.readHtmlFailed': 'HTML の読み込みに失敗',
  'error.exportFailed': '書き出しに失敗',
  'error.presentFailed': 'プレゼンテーションを開始できませんでした',
  'error.autosaveFailed': '自動保存に失敗',
  'error.importFailed': '取り込みに失敗',
  'error.previewInitFailed': 'プレビューの初期化に失敗',
  'error.slideRenderFailed': 'スライドの表示に失敗',

} as const;
