---
feature: editing-engine
status: active
updated: 2026-08-26
---

# editing-engine — テスト設計

方針は [../../basic-design/08-test-policy.md](../../basic-design/08-test-policy.md)。
ケースは [design.md](design.md) の受け入れ条件と対応させる。

実体は `src/stage/bridge.test.ts` / `geometry.test.ts` / `selectionHeuristics.test.ts` /
`src/core/selection/store.test.ts` / `src/core/editing/*.test.ts` / `src/core/commands/slide.test.ts` /
`src/features/inspectorColor.test.ts` / `src/app/autosave.test.ts` / `src/app/closePrompt.test.ts` /
`src/shared/fonts.test.ts` / `src/shared/fileDrop.test.ts`。

## テストケース

### StageBridge / シリアライズ

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 1 | unit | WHEN スライドをロードする THE SYSTEM SHALL 全要素に解決可能な uid を与える | 実装済み |
| 2 | unit | WHEN 何も編集していない THE SYSTEM SHALL スライドを変えずに返す | 実装済み |
| 3 | unit | WHEN 保存する THE SYSTEM SHALL 編集モードが無効化したスクリプトとインラインハンドラを復元する | 実装済み |
| 4 | unit | WHEN 保存する THE SYSTEM SHALL エディタ属性を markup に残さない | 実装済み |
| 5 | unit | WHEN 保存する THE SYSTEM SHALL スライドだけをシリアライズし、周囲の殻を含めない | 実装済み |
| 6 | unit | WHEN 保存する THE SYSTEM SHALL `data-role` のような作者の属性はそのまま保つ | 実装済み |
| 7 | unit | WHEN トリミング中に保存する THE SYSTEM SHALL セッションの痕跡を残さない | 実装済み |
| 8 | unit | WHEN 隠れているスライドをステージに出す THE SYSTEM SHALL ステージクラスを当てて見えるようにする | 実装済み |
| 9 | unit | WHEN 保存する THE SYSTEM SHALL 足したステージクラスだけを剥がす(**作者が書いたものは剥がさない**) | 実装済み |

### 選択

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 10 | unit | WHEN 単語をクリックする THE SYSTEM SHALL インライン span ではなくブロックを選ぶ | 実装済み |
| 11 | unit | WHEN 祖先を遡る THE SYSTEM SHALL 最初のブロックレベル祖先で止まる | 実装済み |
| 12 | unit | WHEN スライド自身をクリックする THE SYSTEM SHALL オブジェクトではなく空白として扱う | 実装済み |
| 13 | unit | WHEN スライドを埋めるコンテナをクリックする THE SYSTEM SHALL 「何もない場所」として読む | 実装済み |
| 14 | unit | WHEN 四辺から少し内側のラッパーをクリックする THE SYSTEM SHALL 同じくスライド面として読む | 実装済み |
| 15 | unit | WHEN 全面の背景レイヤーをクリックする THE SYSTEM SHALL スライド面として読む | 実装済み |
| 16 | unit | IF コンテナが単に大きいだけ THEN THE SYSTEM SHALL 選択可能なままにする | 実装済み |
| 17 | unit | IF 要素が全面画像 / 自前のテキストを持つ THEN THE SYSTEM SHALL 大きさに関わらず選択可能にする | 実装済み |
| 18 | unit | WHEN 段落の中の画像をクリックする THE SYSTEM SHALL 段落ではなく画像を選ぶ | 実装済み |
| 19 | unit | WHEN Esc を押す THE SYSTEM SHALL 1 階層外へ出る | 実装済み |
| 20 | unit | WHEN スライドルートの手前まで来た THE SYSTEM SHALL **スライドを選ばずに選択解除する** | 実装済み |
| 21 | unit | WHEN パンくずを組む THE SYSTEM SHALL スライドルートを含めない(各項目が選択可能なため) | 実装済み |
| 22 | unit | WHEN パンくずにフォーカスする THE SYSTEM SHALL 選択に触れずプレビューだけ出す | 実装済み |
| 23 | unit | WHEN 選択が解除される THE SYSTEM SHALL プレビュー枠も落とす | 実装済み |
| 24 | unit | WHEN 自前のテキストが無い要素を指す THE SYSTEM SHALL 文字編集を提示しない | 実装済み |
| 203 | unit | WHEN 同じ点にある要素を並べる THE SYSTEM SHALL 不透明な要素の裏に回った箱も列に含める | 実装済み |
| 212 | unit | WHEN 祖先の `overflow:hidden` に切り取られた要素がある THE SYSTEM SHALL 矩形で見つけて列の後ろに足す | 実装済み |
| 213 | unit | WHEN 点を含まない要素がある THE SYSTEM SHALL 列に入れない | 実装済み |
| 214 | unit | IF デッキが `visibility:hidden` で隠している THEN THE SYSTEM SHALL 列に入れない | 実装済み |
| 215 | unit | WHEN 親子がともに点を含む THE SYSTEM SHALL 子を前に置く | 実装済み |
| 216 | unit | WHEN スライドの外(殻)がヒット判定に現れる THE SYSTEM SHALL 列に入れない | 実装済み |
| 204 | unit | WHEN 同じ要素を指す当たりが複数ある THE SYSTEM SHALL 列には 1 つだけ載せる | 実装済み |
| 205 | unit | IF 列にクリックが拒む要素(背景)が混ざる THEN THE SYSTEM SHALL 落とす | 実装済み |
| 206 | unit | WHEN 列の末尾から次へ進む THE SYSTEM SHALL 先頭へ折り返す | 実装済み |
| 207 | unit | IF 起点が列に無い THEN THE SYSTEM SHALL 先頭を返す | 実装済み |
| 208 | 手動 | WHEN Alt+クリックする THE SYSTEM SHALL 同じ点の 1 つ奥の要素を選ぶ(繰り返すとさらに奥へ) | **未確認** |
| 217 | 手動 | WHEN `overflow:hidden` の箱の外へずらした要素を Alt+クリックで拾う THE SYSTEM SHALL 選べる(確認用デッキ 12 枚目) | **未確認** |
| 223 | unit | WHEN 祖先が `overflow:hidden` を持つ THE SYSTEM SHALL 見える範囲をその矩形まで狭める | 実装済み |
| 224 | unit | WHEN スライドルートまで遡る THE SYSTEM SHALL そこで止め、スライド自身も範囲に数える | 実装済み |
| 225 | unit | IF 要素が `position:absolute` で祖先が `static` THEN THE SYSTEM SHALL その祖先では狭めない | 実装済み |
| 226 | unit | IF 片方の軸だけ overflow する THEN THE SYSTEM SHALL その軸だけ狭める | 実装済み |
| 227 | unit | WHEN 見える範囲に収まる移動 THE SYSTEM SHALL そのまま通す | 実装済み |
| 228 | unit | WHEN 範囲の外へ出る移動 THE SYSTEM SHALL 24px を残す位置で止める(手前側・奥側とも) | 実装済み |
| 229 | unit | IF 要素が範囲より大きい THEN THE SYSTEM SHALL 止めずにポインタに従う | 実装済み |
| 230 | 手動 | WHEN 要素をカード(またはスライド)の外へドラッグする THE SYSTEM SHALL 端で止め、見えたまま・掴めたままにする | **未確認** |
| 231 | 手動 | WHEN すでに外へ出ている要素の枠を少し引く THE SYSTEM SHALL 見える位置まで引き戻す | **未確認** |
| 219 | unit | WHEN 選択中で編集中でない THE SYSTEM SHALL 選択枠の四辺に掴みしろを描く | 実装済み |
| 220 | unit | WHILE テキストを編集している THE SYSTEM SHALL 掴みしろを描かない | 実装済み |
| 221 | unit | WHEN 掴みしろとハンドルが角で重なる THE SYSTEM SHALL ハンドル(リサイズ)を勝たせる | 実装済み |
| 222 | 手動 | WHEN ポインタで触れない要素を選び、選択枠の辺をドラッグする THE SYSTEM SHALL その要素を動かし、⌘Z 1 回で戻す | **未確認** |
| 209 | 手動 | WHEN Alt を押しながらドラッグする THE SYSTEM SHALL これまでどおり複製する(奥へ潜らない) | **未確認** |
| 210 | 手動 | WHEN 重なった要素を右クリックする THE SYSTEM SHALL 「この位置にあるもの」に列を並べ、選ぶとその要素を選択してパンくずも差し替える | **未確認** |
| 218 | 手動 | WHEN 一覧の項目を指す THE SYSTEM SHALL その要素を破線の枠で示し、メニューを閉じたら落とす | **未確認** |
| 211 | 手動 | IF その位置に 1 つしか無い THEN THE SYSTEM SHALL 一覧を出さない | **未確認** |

### 幾何 / ジェスチャ

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 25 | unit | WHEN transform を書く THE SYSTEM SHALL 読み書きが往復する | 実装済み |
| 26 | unit | IF 元から transform が書かれている THEN THE SYSTEM SHALL それを基底として保つ | 実装済み |
| 27 | unit | IF オフセットが 0 になる THEN THE SYSTEM SHALL プロパティごと削除する | 実装済み |
| 28 | unit | WHEN エディタのオフセットを消す THE SYSTEM SHALL 作者の transform だけを残す | 実装済み |
| 29 | unit | WHEN 回転していない箱の外接矩形を取る THE SYSTEM SHALL 箱と完全に一致させる | 実装済み |
| 30 | unit | WHEN 回転した箱の外接矩形を取る THE SYSTEM SHALL 中心を動かさずに包含する | 実装済み |
| 31 | unit | WHEN 近い辺へドラッグする THE SYSTEM SHALL 正確な位置へ吸着させる | 実装済み |
| 32 | unit | IF 対象が遠い THEN THE SYSTEM SHALL 吸着させない | 実装済み |
| 33 | unit | WHEN スライド中央へ寄せる THE SYSTEM SHALL 手作業でも正確に中央へ吸着させる | 実装済み |
| 34 | unit | IF 候補が複数ある THEN THE SYSTEM SHALL 最も近いものを選ぶ | 実装済み |
| 64 | unit | WHEN 吸着させる線を指定しない THE SYSTEM SHALL 指定前と同じ結果を返す(後方互換) | 実装済み |
| 65 | unit | IF 差し出していない辺が候補に近い THEN THE SYSTEM SHALL 吸着させない | 実装済み |
| 66 | unit | WHEN 差し出した辺が候補に近い THE SYSTEM SHALL その辺を吸着させる | 実装済み |
| 67 | unit | IF ある軸に線を 1 本も差し出さない THEN THE SYSTEM SHALL その軸を動かさない | 実装済み |
| 68 | unit | WHEN 回転していないハンドルのカーソルを求める THE SYSTEM SHALL styles.css と同じ値を返す | 実装済み |
| 69 | unit | WHEN 要素が回転している THE SYSTEM SHALL カーソルを回転に追従させる | 実装済み |
| 70 | unit | WHEN 半回転する THE SYSTEM SHALL 同じカーソルに戻る(リサイズカーソルは双方向) | 実装済み |
| 71 | unit | IF 角度が 1 周を外れる THEN THE SYSTEM SHALL 正規化してから丸める | 実装済み |
| 72 | unit | WHEN 移動中の値を出す THE SYSTEM SHALL 外接矩形の左上をデザイン px で返す | 実装済み |
| 73 | unit | WHEN リサイズ中の値を出す THE SYSTEM SHALL 幅 × 高さを返す | 実装済み |
| 74 | unit | WHEN 回転中の値を出す THE SYSTEM SHALL 角度を 0〜359° に収めて返す | 実装済み |
| 78 | unit | WHEN 次 / 前の兄弟へ進む THE SYSTEM SHALL 同じ親の中で移動する | 実装済み |
| 79 | unit | WHEN 端に達する THE SYSTEM SHALL 反対の端へ折り返す | 実装済み |
| 80 | unit | IF 兄弟をクリックしても選ばれない THEN THE SYSTEM SHALL その兄弟を飛ばす | 実装済み |
| 81 | unit | IF 選択できる兄弟が無い THEN THE SYSTEM SHALL 何も返さない | 実装済み |
| 85 | unit | WHEN ⌘D で複製する THE SYSTEM SHALL 次の兄弟として 16px ずらして挿す | 実装済み |
| 85a | unit | WHEN 選択のある状態で貼り付ける THE SYSTEM SHALL その要素の次の兄弟として、同じ親の中に置く | 実装済み |
| 85b | unit | WHEN 選択の無い状態で貼り付ける THE SYSTEM SHALL スライドルート直下に置く | 実装済み |
| 85c | unit | WHEN 自分で位置を持つ要素を続けて 3 回貼り付ける THE SYSTEM SHALL 16px・32px・48px と段にずらす | 実装済み |
| 85c2 | unit | WHEN 親が位置を決める要素(grid のセル)を貼り付ける THE SYSTEM SHALL ずらさず親の決めた場所に置く | 実装済み |
| 85d | unit | WHEN 切り取ったものを貼り付ける THE SYSTEM SHALL ずらさず元の位置に置く | 実装済み |
| 85e | unit | WHEN 貼り付ける THE SYSTEM SHALL コピー元の uid も足場も持ち込まない | 実装済み |
| 85f | unit | WHEN コピーする THE SYSTEM SHALL 履歴に 1 手も積まない | 実装済み |
| 85g | unit | WHEN スライドルートを選んでコピーする THE SYSTEM SHALL 何もしない | 実装済み |
| 85h | unit | WHEN 切り取る THE SYSTEM SHALL 履歴のラベルを「切り取り」にする | 実装済み |
| 85i | unit | WHEN 貼り付けを Undo する THE SYSTEM SHALL 1 手で貼り付け前に戻す | 実装済み |
| 86 | unit | WHEN Alt を押しながらドラッグする THE SYSTEM SHALL 開始位置にコピーを残し、元の要素を動かす | 実装済み |
| 87 | unit | WHEN Alt ドラッグを終える THE SYSTEM SHALL 履歴を 1 段だけ積む | 実装済み |
| 88 | unit | WHEN Alt ドラッグを Undo する THE SYSTEM SHALL コピーごと取り消す | 実装済み |
| 89 | unit | WHILE Alt ドラッグが続く THE SYSTEM SHALL コピーを 1 つしか作らない | 実装済み |
| 90 | unit | IF Alt を押してもポインタが動かない THEN THE SYSTEM SHALL 複製しない | 実装済み |
| 91 | unit | WHEN Alt ドラッグを取り消す THE SYSTEM SHALL コピーを消し、履歴に載せない | 実装済み |
| 92 | unit | WHEN Alt なしでドラッグする THE SYSTEM SHALL 従来どおり「移動」として記録する | 実装済み |
| 134 | unit | IF 押した位置から画面上 4px を越えない THEN THE SYSTEM SHALL 要素を動かさず履歴にも積まない | 実装済み |
| 135 | unit | WHEN しきい値を越える THE SYSTEM SHALL 押した位置からの移動量そのままで追従させる(始点基準) | 実装済み |
| 136 | unit | WHEN ズームを縮小する THE SYSTEM SHALL しきい値をステージ px 側で広げる | 実装済み |
| 137 | unit | IF Alt ドラッグがしきい値を越えない THEN THE SYSTEM SHALL 複製しない | 実装済み |
| 139 | unit | IF リサイズハンドルの press がしきい値を越えない THEN THE SYSTEM SHALL `style` 属性を書かず履歴にも積まない | 実装済み |
| 140 | unit | WHEN リサイズを Undo する THE SYSTEM SHALL ピン留めした `width` / `height` も一緒に戻す | 実装済み |
| 141 | unit | IF 回転ハンドルの press がしきい値を越えない THEN THE SYSTEM SHALL 角度を書かず履歴にも積まない | 実装済み |
| 162 | unit | WHEN Shift を押しながらドラッグする THE SYSTEM SHALL 移動量の大きいほうの軸だけに動かす | 実装済み |
| 163 | unit | WHEN 軸を固定したまま反対の軸へより大きく動かす THE SYSTEM SHALL 固定軸を入れ替える | 実装済み |
| 164 | unit | WHEN ドラッグの途中で Shift を離す THE SYSTEM SHALL 両方の軸への移動に戻す | 実装済み |
| 165 | unit | WHILE 軸が固定されている THE SYSTEM SHALL 止まっているほうの軸を吸着の候補に出さない | 実装済み |
| 142 | unit | WHEN 回転の press がしきい値を越える THE SYSTEM SHALL 回転として記録する | 実装済み |
| 143 | unit | WHEN ズームを縮小する THE SYSTEM SHALL ハンドル側のしきい値もステージ px 側で広げる | 実装済み |

### テキスト編集 / インスペクタ

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 35 | unit | WHEN ホストのコントロールに選択を奪われる THE SYSTEM SHALL 退避した Range を復元する | 実装済み |
| 36 | unit | WHEN select → 適用を 2 回続ける THE SYSTEM SHALL 使える退避を保ち続ける | 実装済み |
| 37 | unit | IF 要素内に生きた選択がある THEN THE SYSTEM SHALL 退避よりそちらを優先する | 実装済み |
| 38 | unit | WHEN 意図して置いたキャレットがある THE SYSTEM SHALL キャレットとして復元する | 実装済み |
| 39 | unit | WHEN 2 つ目のフォントを適用する THE SYSTEM SHALL 選択を作り直さずに効かせる | 実装済み |
| 40 | unit | IF セッションが無い THEN THE SYSTEM SHALL 何もしない | 実装済み |
| 40a | unit | WHEN 蛍光を当てる THE SYSTEM SHALL `backColor` ではなく `hiliteColor` を使う | 実装済み |
| 40b | unit | WHEN 蛍光を当てる前に選択を奪われる THE SYSTEM SHALL 退避した Range を復元する | 実装済み |
| 41 | unit | WHEN 未設定 / キーワード / alpha 0 の背景色を読む THE SYSTEM SHALL 「塗りなし」と判定する | 実装済み |
| 42 | unit | WHEN computed の色をカラー入力に渡す THE SYSTEM SHALL 受け付ける形式に変換する | 実装済み |
| 97 | unit | WHEN 書式でテキストが `<b>` / `<span>` に包まれる THE SYSTEM SHALL その要素をテキスト編集可のまま保つ | 実装済み |
| 98 | unit | WHEN 全幅の要素のテキストが書式で包まれる THE SYSTEM SHALL 背景扱いに落とさない | 実装済み |
| 99 | unit | IF 箱の中身がブロック要素だけ THEN THE SYSTEM SHALL その箱をテキスト編集可にしない | 実装済み |
| 100 | unit | WHEN 書式を当ててセッションを閉じる THE SYSTEM SHALL 履歴に 1 件だけ積み、Undo 1 回で戻す | 実装済み |
| 101 | unit | WHEN 入力だけしてセッションを閉じる THE SYSTEM SHALL その変更を 1 件記録する | 実装済み |
| 102 | unit | WHEN セッション中に Undo してから閉じる THE SYSTEM SHALL 取り消した変更を積み直さず Redo を残す | 実装済み |
| 103 | unit | WHEN 箇条書きを当てる THE SYSTEM SHALL 生まれた `<ul>` / `<li>` に uid を配り、uid で解決できるようにする | 実装済み |
| 104 | unit | WHEN 書式が新しいノードを作る THE SYSTEM SHALL そのノードに uid を配る | 実装済み |
| 105 | unit | WHEN 箇条書きの行をクリックする THE SYSTEM SHALL リストを持つ要素のほうを選ぶ | 実装済み |
| 106 | unit | IF リストがスライド直下 THEN THE SYSTEM SHALL `<ul>` で止まる(スライドルートまで登らない) | 実装済み |
| 107 | unit | WHEN リストを持つ要素を見る THE SYSTEM SHALL テキスト編集可と判定する | 実装済み |
| 108 | 手動 | WHEN 箇条書きを当てた行を再度編集して同じボタンを押す THE SYSTEM SHALL リストを解除する | 手で確認 |
| 109 | unit | WHEN リストを解除する THE SYSTEM SHALL エンジンが焼き付けたサイズの span を剥がす | 実装済み |
| 110 | unit | IF span が以前からある宣言を言い直しているだけ THEN THE SYSTEM SHALL 残す | 実装済み |
| 111 | unit | IF span がデッキの属性(class 等)を持つ THEN THE SYSTEM SHALL 触らない | 実装済み |
| 112 | unit | WHEN span を剥がす THE SYSTEM SHALL 選択を同じ文字の上に戻す | 実装済み |
| 113 | unit | WHEN キャレット位置の書式を引く THE SYSTEM SHALL エンジンの返す状態をそのまま公開する | 実装済み |
| 114 | unit | WHEN セッションが閉じる THE SYSTEM SHALL 書式の状態表示を空に戻す | 実装済み |
| 115 | 手動 | IF 見出しが既に太字 THEN THE SYSTEM SHALL B を点灯させ、外したら消灯させる | 手で確認 |
| 116 | 手動 | WHEN 箇条書きの行に入り直す THE SYSTEM SHALL テキストボックス側(`<li>` ではない)を編集する | 手で確認 |
| 117 | 手動 | WHEN 箇条書きを解除する THE SYSTEM SHALL 文字サイズを焼き付けず、要素の uid も変えない | 手で確認 |
| 167 | unit | IF 編集中の要素が `<ul>` / `<ol>` そのもの THEN THE SYSTEM SHALL 同じ種類のボタンでリストを外し、行を素のブロックに戻す | 実装済み |
| 168 | unit | IF 編集中の要素が `<ul>` で別の種類を押す THEN THE SYSTEM SHALL タグを差し替え、uid と項目を保つ | 実装済み |
| 169 | unit | IF 編集中の要素が `<span>` / `<p>` THEN THE SYSTEM SHALL リストを持てる要素へ建て替えてから `execCommand` に渡す | 実装済み |
| 170 | unit | IF 編集中の要素が見出しなど他のタグ THEN THE SYSTEM SHALL 建て替えずブラウザに任せる | 実装済み |
| 171 | unit | WHEN ホストを建て替える THE SYSTEM SHALL 押下を 1 つの Undo ステップにする | 実装済み |
| 172 | unit | WHEN リストを含む markup を読み直す THE SYSTEM SHALL パーサが分解する入れ子を作らない | 実装済み |
| 175 | unit | WHEN リストを外す THE SYSTEM SHALL 行頭記号のための余白・記号の置き方を落とし、行揃えは残す | 実装済み |
| 173 | 手動 | WHEN デッキが元から持つ箇条書きのボックスで箇条書き / 番号を押す THE SYSTEM SHALL 実アプリ(WKWebView)でも外す / 種類を変える | 手で確認 |
| 174 | 手動 | WHEN 建て替えたボックスを見る THE SYSTEM SHALL 押す前と同じ大きさ・書体・色に保つ | 手で確認 |
| 176 | unit | WHEN テキストセッション中の選択枠を描く THE SYSTEM SHALL 線を要素の外へ逃がし、塗りは要素の端で止める | 実装済み |
| 177 | unit | IF 編集で空になった箱 THEN THE SYSTEM SHALL 編集可能・選択可能として扱う(デッキ自身の空要素は背景のまま) | 実装済み |
| 178 | unit | WHEN 空の箱を描く THE SYSTEM SHALL 掴める最小の面積を与える | 実装済み |
| 179 | 手動 | WHEN 文字を全部消してフォーカスを外す THE SYSTEM SHALL もう一度クリックで選べて、打ち始められる | 手で確認 |
| 180 | 手動 | WHEN 空の箱にキャレットを立てる THE SYSTEM SHALL 選択枠と重ねずに見せる | 手で確認 |
| 181 | 手動 | WHEN 印の付いた箱へ ⌘Z で文字を戻す THE SYSTEM SHALL プレースホルダを文字に重ねない | 手で確認 |
| 118 | unit | WHEN 同じ範囲へ続けてサイズを当てる THE SYSTEM SHALL span を包み直さず `font-size` を差し替える | 実装済み |
| 119 | unit | WHEN 選択が動いたあとにサイズを当てる THE SYSTEM SHALL `execCommand` 経路へ戻る | 実装済み |
| 120 | unit | IF 範囲の内側が既にサイズを持つ THEN THE SYSTEM SHALL その宣言を落とす(要素は残す) | 実装済み |
| 121 | unit | WHEN 続けて桁を打つ THE SYSTEM SHALL 1 手の Undo で打つ前に戻す | 実装済み |
| 122 | unit | WHEN 本文を押して引く THE SYSTEM SHALL 押した位置から引いた先までを選択する | 実装済み |
| 123 | unit | WHEN すでに選択された範囲の上から押して引く THE SYSTEM SHALL 選択を作り直す | 実装済み |
| 124 | unit | IF ドラッグが編集中要素の外へ出る THEN THE SYSTEM SHALL 直前に枠内だった位置で止める | 実装済み |
| 125 | unit | IF 押さずに動かした THEN THE SYSTEM SHALL 何も選択しない | 実装済み |
| 126 | unit | WHEN 同じところを 2 回 / 3 回押す THE SYSTEM SHALL 単語 / 要素全体を取る | 実装済み |
| 146 | unit | WHEN ダブルクリックで編集を始める THE SYSTEM SHALL 押した位置にキャレットを置き、何も選択しない | 実装済み |
| 127 | unit | IF 押す位置が離れた / 400ms を過ぎた THEN THE SYSTEM SHALL 連打として数えない | 実装済み |
| 128 | unit | WHEN Shift を押して押す THE SYSTEM SHALL アンカーを保って向こう端だけ動かす | 実装済み |
| 148 | unit | WHEN 揃えた箱を箇条書きにする THE SYSTEM SHALL その行揃えを新しい `ul` / `li` へ配る | 実装済み |
| 149 | unit | IF 箱に行揃えが指定されていない THEN THE SYSTEM SHALL 新しいリストへ何も書かない | 実装済み |
| 150 | unit | WHEN キャレットがリストの行にある THE SYSTEM SHALL その段落ボタンの状態を報告する | 実装済み |
| 151 | unit | WHEN テキストボックスを挿入する THE SYSTEM SHALL 中身が空の箱を入れ、テキストセッションを要求する | 実装済み |
| 152 | unit | IF 挿入した箱に一文字も入らずセッションが終わる THEN THE SYSTEM SHALL 箱ごと消し、undo にも redo にも残さない | 実装済み |
| 153 | unit | IF 箱に文字が入っている THEN THE SYSTEM SHALL 挿入の記録を手放し、以後その箱を消さない | 実装済み |
| 154 | unit | IF 挿入の後に別のコマンドが積まれている THEN THE SYSTEM SHALL 削除を 1 コマンドとして積む | 実装済み |
| 155 | unit | WHEN 中身がブラウザの残した `<br>` だけである THE SYSTEM SHALL 空と判定する | 実装済み |
| 156 | unit | IF 画像だけを持つ THEN THE SYSTEM SHALL 空と判定しない | 実装済み |
| 157 | unit | WHEN キャレットが上付きの中にある THE SYSTEM SHALL 上付きボタンの状態を報告する | 実装済み |

ケース 148〜150 の実体は `src/core/editing/richText.test.ts`、
151〜156 は `src/core/editing/textBox.test.ts`、157 は `richText.test.ts`。
**プレースホルダが実際に描かれるか(`::before` と `:has()`)は unit では見えない** —
CSS の適用は実ブラウザでしか確かめられないので、**空のテキストボックスを 1 つ作って目で確かめる**。
行揃えがリストの中まで届くかどうか自体は
[inspector/test.md](../inspector/test.md) の「行揃えとリスト」が持つので、ここでは繰り返さない。

### 箱に画像を入れる

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 182 | unit | IF 要素が文字も画像も持たず子を持てる THEN THE SYSTEM SHALL そこへ画像を入れられると判定する | 実装済み |
| 183 | unit | IF 要素が自前のテキストを持つ THEN THE SYSTEM SHALL 画像を入れられないと判定する(テキスト編集の領分) | 実装済み |
| 184 | unit | IF 要素が既に画像である THEN THE SYSTEM SHALL 画像を入れられないと判定する(トリミングの領分) | 実装済み |
| 185 | unit | IF 要素が子を持てない(`<svg>` / `<video>` 等) THEN THE SYSTEM SHALL 画像を入れられないと判定する | 実装済み |
| 186 | unit | WHEN 箱に画像を入れる THE SYSTEM SHALL 箱そのものを残し、中身だけを `<img>` 1 つに差し替える | 実装済み |
| 187 | unit | WHEN 箱に画像を入れる THE SYSTEM SHALL その箱が持っていた文字を `alt` に移す | 実装済み |
| 188 | unit | WHEN それを Undo する THE SYSTEM SHALL 元の中身をひとまとまりで戻す(キャプションごと) | 実装済み |
| 189 | unit | IF 選択が画像を受け取れない THEN THE SYSTEM SHALL 何もせず履歴にも積まない | 実装済み |
| 190 | unit | WHEN 画像を入れたあと保存する THE SYSTEM SHALL エディタ由来のものを markup に残さない | 実装済み |
| 191 | unit | WHEN mac のドロップ座標を読む THE SYSTEM SHALL Retina でもそのまま CSS ピクセルとして扱う | 実装済み |
| 192 | unit | WHEN Windows / Linux のドロップ座標を読む THE SYSTEM SHALL `devicePixelRatio` で割る | 実装済み |
| 193 | unit | IF 倍率が読めない(0) THEN THE SYSTEM SHALL 1 として扱う(座標を無限大にしない) | 実装済み |
| 194 | unit | WHEN 落としたパスを見る THE SYSTEM SHALL ファイル選択ダイアログと同じ拡張子を画像と認める(大文字表記・Windows のパス区切りを含む) | 実装済み |
| 195 | unit | IF パスが画像でない / ディレクトリ / 空 THEN THE SYSTEM SHALL 画像と認めない | 実装済み |
| 196 | 手動 | WHEN 写真枠をクリックする THE SYSTEM SHALL 1 回でその枠を選ぶ(キャプションで止まらない) | 手で確認 |
| 197 | 手動 | WHEN 写真枠を右クリックして「画像を入れる」を選ぶ THE SYSTEM SHALL ファイル選択ダイアログを開く | 手で確認 |
| 232 | 手動 | WHEN 写真枠をダブルクリックする THE SYSTEM SHALL 何もしない(ファイル選択を開かない) | 手で確認 |
| 233 | 手動 | WHEN 挿入直後の空テキストボックスを右クリックする THE SYSTEM SHALL 「テキストを編集」と「画像を入れる」を両方出す | 手で確認 |
| 198 | 手動 | WHEN 画像ファイルを写真枠に落とす THE SYSTEM SHALL その枠を選んでから画像を入れる | 手で確認 |
| 199 | 手動 | WHILE 画像ファイルを箱の上へドラッグしている THE SYSTEM SHALL 落ちる先を枠で予告する | 手で確認 |
| 200 | 手動 | IF 画像を入れられない場所に落とす THEN THE SYSTEM SHALL 何もしない(枠も出ない) | 手で確認 |
| 201 | 手動 | WHILE テキストを編集している THE SYSTEM SHALL 落ちる先を示さず、落とされても何もしない | 手で確認 |
| 202 | 手動 | WHEN 画像を入れたあと ⌘Z を 1 回押す THE SYSTEM SHALL 元の中身に戻す | 手で確認 |

ケース 182〜190 の実体は `src/core/editing/imageFill.test.ts`、
191〜195 は `src/shared/fileDrop.test.ts`(座標変換とパスの拡張子判定は純関数なので単体で持てる)。

**#198〜#201 のドロップは、ブラウザ(`npm run dev`)では原理的に確かめられない。**
ドラッグは Tauri がネイティブ側で消費するので WebView には届かず、受け口も HTML5 の `drop` ではなく
Tauri のイベント購読([ADR-0011](../../adr/0011-native-file-drop.md))。
**`npm run tauri dev` で起動して、実際にファイルを掴んで落とすしかない。**
座標のプラットフォーム差(#191〜#193)も同じで、**Windows 実機での確認は別に要る** ——
mac で通っても割り算の側は一度も走っていない。

**#196 が確かめているのは取り込み側。** 写真枠のキャプションは枠全面を覆っているので、
クリックが枠に届くのは取り込みがそれに `pointer-events:none` を書いているから
([import-pipeline](../import-pipeline/test.md))。ここでは「届いた結果」だけを見る。

### コマンド / 保存

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 46 | unit | WHEN 削除を Undo する THE SYSTEM SHALL 要素を**選択された状態で**戻す | 実装済み |
| 47 | unit | IF 復元した markup が古い uid を持たない THEN THE SYSTEM SHALL その uid を選択から落とす | 実装済み |
| 48 | unit | WHEN 変更の連続が落ち着く THE SYSTEM SHALL 1 回だけ書き込む | 実装済み |
| 49 | unit | WHEN 書き込み中に変更が来る THE SYSTEM SHALL 書き込みを重ねず、その変更を次の 1 回に含める | 実装済み |
| 50 | unit | WHEN 即時フラッシュを求められる THE SYSTEM SHALL 待ち時間を使い切らずに書く | 実装済み |
| 51 | unit | IF 書き込みが失敗する THEN THE SYSTEM SHALL 動き続ける | 実装済み |
| 52 | unit | WHEN キャンセル済み THE SYSTEM SHALL 何もしない | 実装済み |
| 53 | unit | WHEN 閉じる確認に答える THE SYSTEM SHALL 押されたボタンで解決する | 実装済み |
| 54 | unit | WHEN 2 つ目の閉じる要求が来る THE SYSTEM SHALL 前の問いに "stay" を返す | 実装済み |
| 158 | unit | IF スナップショットが merge key を持たない THEN THE SYSTEM SHALL 畳まない(ジェスチャ同士は別々の手のまま) | 実装済み |
| 159 | unit | WHEN 同じ merge key のスナップショットが続く THE SYSTEM SHALL 畳む | 実装済み |
| 160 | unit | IF 欄・要素のどちらかが違う THEN THE SYSTEM SHALL 畳まない | 実装済み |
| 161 | unit | IF 捉えている要素の集合が変わる THEN THE SYSTEM SHALL 畳まない | 実装済み |

**#43〜#45 は欠番。** スライドサイズ変更の廃止(2026-08-26)で落とした。
番号は他ドキュメントからも参照するので詰めない。

158〜161 は `src/core/commands/snapshot.test.ts`。**畳んだ結果どこへ戻るか**は
実ステージが要るので [inspector/test.md](../inspector/test.md) の「位置とサイズの即時反映」が持つ
(`src/core/editing/geometry.test.ts`)。同じことを二度書かない。

### フォント

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 55 | unit | WHEN インストール済みファミリを調べる THE SYSTEM SHALL 利用可能と報告する | 実装済み |
| 56 | unit | IF 総称にフォールバックする THEN THE SYSTEM SHALL 利用不可と報告する | 実装済み |
| 57 | unit | IF 実測幅が 0 THEN THE SYSTEM SHALL 「証拠なし」として扱う | 実装済み |
| 58 | unit | WHEN 一覧を出す THE SYSTEM SHALL この環境に無いファミリを**隠す** | 実装済み |
| 59 | unit | WHEN 一覧を出す THE SYSTEM SHALL 既定スタック(Noto Sans)と同梱書体は常に出す(判定しない) | 実装済み |
| 60 | unit | WHEN 同じ書体が OS ごとに別名を持つ THE SYSTEM SHALL 1 エントリにまとめる | 実装済み |
| 61 | unit | IF 測定手段が無い THEN THE SYSTEM SHALL カタログ全体を出す | 実装済み |
| 62 | unit | WHEN computed の font-family を照合する THE SYSTEM SHALL カタログの項目に対応付ける(無ければ null) | 実装済み |

### 手で確認する(実寸・実描画・実マウス)

**ここに並ぶのは自動テストが見ていない範囲。** 実寸のレイアウト・実マウスの既定動作・
フレーム越しのフォーカスは jsdom では何も言えないので、**アプリを触って確かめる**。
そのままチェックリストとして使う。

| # | 種別 | ケース | 状態 |
|---|---|---|---|
| 63 | 手動 | 実寸・実描画が要るもの(選択枠の矩形と対象要素の矩形の突き合わせ、回転ハンドル、吸着) | 手で確認 |
| 75 | 手動 | WHEN ドラッグ中に Esc を押す THE SYSTEM SHALL 開始位置へ戻し、履歴に載せない | 手で確認 |
| 76 | 手動 | WHEN リサイズで辺を隣の要素に寄せる THE SYSTEM SHALL その辺だけを吸着させ、反対の辺を動かさない | **未確認**(unit #65〜#67 で辺の限定だけ代替) |
| 77 | 手動 | WHILE ドラッグしている THE SYSTEM SHALL 数値バッジを 1 つ出し、離すと消す | 手で確認 |
| 82 | 手動 | WHEN ⌘] を押す THE SYSTEM SHALL 選択中の要素を 1 つ前面へ動かす | 手で確認 |
| 83 | 手動 | WHEN Enter を押す THE SYSTEM SHALL 選択中のテキストの編集を始める | 手で確認 |
| 84 | 手動 | WHEN Tab を押す THE SYSTEM SHALL 選択枠を次の兄弟の矩形へ移す | 手で確認 |
| 93 | 手動 | WHEN Alt を押しながらドラッグする THE SYSTEM SHALL 要素を 1 つ増やし、元の位置にも残す | 手で確認 |
| 94 | 手動 | WHEN 要素を右クリックする THE SYSTEM SHALL その要素を選び、操作のメニューを出す | 手で確認 |
| 95 | 手動 | WHEN メニューの「最前面へ」を選ぶ THE SYSTEM SHALL 兄弟順を変える | 手で確認 |
| 96 | 手動 | WHEN 何もない場所を右クリックする THE SYSTEM SHALL 挿入の項目を出す | 手で確認 |
| 96a | 手動 | WHEN カードを ⌘C し、別のカードを選んで ⌘V する THE SYSTEM SHALL 同じ grid の中に、同じ見た目で増やす | 手で確認 |
| 96b | 手動 | WHEN 別のスライドへ移って ⌘V する THE SYSTEM SHALL 元と同じ位置に置く | 手で確認 |
| 96c | 手動 | WHEN 何もない場所を右クリックする THE SYSTEM SHALL コピー済みのときだけ「貼り付け」を出す | 手で確認 |
| 129 | 手動 | WHEN 実マウスで本文をドラッグする THE SYSTEM SHALL 選択を作る | 手で確認 |
| 130 | 手動 | WHEN すでに選択された範囲の上からドラッグする THE SYSTEM SHALL 選択を作り直す | 手で確認 |
| 131 | 手動 | WHEN 同じところを 2 回押す THE SYSTEM SHALL 単語を取る | 手で確認 |
| 147 | 手動 | WHEN ダブルクリックで編集を始める THE SYSTEM SHALL 語を選択せず、末尾にも飛ばさない | 手で確認 |
| 132 | 手動 | WHEN 本文をドラッグする THE SYSTEM SHALL セッションを閉じず、フレームで `dragstart` を起こさない | 手で確認 |
| 133 | 手動 | WHEN ドラッグで作った選択に B を押す THE SYSTEM SHALL その範囲へ書式を当てる | 手で確認 |
| 138 | 手動 | WHEN クリック相当の微小ドラッグをする THE SYSTEM SHALL 選択だけを変え、要素を動かさない | 手で確認 |
| 166 | 手動 | WHEN Shift を押しながら実マウスでドラッグする THE SYSTEM SHALL 水平 / 垂直に固定し、固定した軸だけ吸着させる | 手で確認 |
| 144 | 手動 | WHEN リサイズハンドルをクリックする THE SYSTEM SHALL 寸法を焼き付けない | 手で確認 |
| 145 | 手動 | WHEN リサイズを Undo する THE SYSTEM SHALL `width` / `height` も消す | 手で確認 |

**#129〜#133 は実マウスでしか確かめられない。** 合成イベントには既定動作が無いので
文字選択も HTML5 ドラッグも始まらず、**壊れている状態がそもそも再現しない**
([issues](../../issues.md) #17)。かつてヘッドレスの自動テストを当てていた頃も、
それが守っていたのは**置き換えたあとの経路**であって #17 そのものではなかった —
ヘッドレス Chrome は合成 press からネイティブドラッグを始めないため。

**#96a は「同じ見た目か」を目で見る。** 貼り付け先を変えた理由がそこにしか出ない —
親から切り離すと崩れるのは、grid のセルや `.container .card` のように**親が塗っている**箱だけで、
絶対配置の見出しを貼っても違いが出ない([issues](../../issues.md) の旧・要素コピーの経緯)。

**#144・#145 は書き出した HTML を見て判定する。** 「ハンドルを押しただけ」で
`width` / `height` が付いたかどうかは画面では分からない。

**確認が合わないときは、実装を疑う前に確かめ方を疑う。**
過去に、吸着の自動テストが shift を押しながらドラッグしていて(当時の shift は「吸着オフ」)
そもそも移動していなかった、という例がある。手で触るときも同じことが起きる。
**その shift は今は「軸固定」**([issues](../../issues.md) #97)なので、押したまま試すと
今度は片方の軸だけが動く —— 吸着を見たいなら Shift から指を離す。
