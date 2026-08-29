---
feature: import-pipeline
code: src/import/**, src/core/document/compose.ts
tests: src/import/*.test.ts, src/core/document/compose.test.ts, src/core/document/roundTrip.test.ts
status: 実装済み
updated: 2026-08-26
---

# import-pipeline — 機能設計

## 概要

HTML ファイルを読み込み、スライドの境界を検出して `Project` に変換する。
書き出し(= 保存)側の再合成もこの機能の責務で、**取り込みと書き出しは往復で固定点になる**必要がある。

## 責務と境界

**やること**

- 自己展開型アーカイブ(Claude Artifacts の standalone HTML)を素の HTML に戻す
- スライド境界の検出(Detector チェーン)と、**分割の確認**(確信度によらず必ず通す。下記)
- 共有リソース(`head` / `body` 属性 / スライドの殻)とスライド本体の分離
- 書き出し時の再合成(元の構造で戻す)

**やらないこと**

- 編集操作(→ [editing-engine](../editing-engine/design.md))
- ファイルの読み書き自体(→ Rust 側 `commands/project.rs`。この機能は文字列を受け取り文字列を返す)
- **アセット参照の書き換え**(→ 下記「アセットの扱い」。取り込みは著者が書いた参照に触らない)

## インターフェース

| 入口 | 場所 |
|---|---|
| 取り込みパイプライン | `src/import/pipeline.ts` |
| Detector 群 | `src/import/detectors/`(`deckStage` / `frameworks` / `generic`) |
| Artifacts 展開 | `src/import/artifact.ts`(`isArtifactHtml()` を通ったファイルのみ) |
| 再合成 | `src/core/document/compose.ts` |
| 確認 UI | `src/features/ImportDialog.tsx` |

## スライド境界 Detector

表の並びは `pipeline.ts` の `DETECTORS` と同じ。**Detector 名は実装の `id` そのもの**なので、
この名前で grep すれば実体に辿り着く。

| Detector(`id`) | 対象パターン |
| --- | --- |
| `reveal` | reveal.js。`.reveal .slides` の直下 `<section>`。子が `<section>` だけの縦スタックは平坦化して中身を 1 枚ずつ数える |
| `deck-stage` | Claude Artifacts のデッキ。`deck-stage` / `x-import[component-from-global-scope="deck-stage"]` の直下要素 |
| `impress` | impress.js(`#impress .step, .impress-enabled .step`) |
| `swiper` | Swiper / カルーセル系(`.swiper-wrapper > .swiper-slide`) |
| `generic` | 既知のクラス・タグの直列。`section.slide` / `div.slide` / `[class*="slide"]` / `.page` / `[data-slide]` / `section` / `article` の **7 パターン**を試し、最も確信度の高いものを採る |
| `fullpage` | 画面高いっぱいのブロックの連続。インラインの `height:100vh` / `100%` / `100dvh` か、`h-screen` / `min-h-screen` / `fullscreen` / `full-page` / `vh-100` のクラス名で判定する(**タグは問わない**) |
| `single` | 分割なし(1 枚スライド扱い)。常に一致する最後の砦 |

**採用されるのは並び順ではなく確信度の最も高い候補**(`analyzeHtml` が降順に並べ替える)。
表の並びは、同点のときの安定性と読みやすさのためのもの。

検出結果は「分割セレクタ + フレームワーク種別」として `shared.framework` に記録し、
書き出し時の再合成に使う(reveal.js で入ってきたものは reveal.js 構造で出す)。
`generic` だけは採ったパターンまで含めて `generic:<セレクタ>` の形で残す。

Detector は「どこで切るか」に加えて次の 2 つを返せる。

- **デッキが自分で宣言しているステージサイズ** → `shared.designWidth/Height`
- **デッキのランタイムが描画時に当てるはずだった CSS**(`runtimeCss`) → 共有 head の**先頭**に置く。
  デッキ自身の CSS が後に来て勝つので、**スライドの markup には一切触れずに**
  「ランタイムが無い状態」を埋められる

### 分割は確信度によらず必ず確認する

`ImportDialog` は**どの候補がどれだけ確信を持っていても必ず開く**。
閾値を超えたら黙って確定する経路は無い。

**失敗の重さが非対称だから。** 確認を 1 枚挟むコストは数秒だが、
**間違った分割は手で戻すのが最も苦しい種類の取り込み失敗**で、
スライドをまたいで切れた markup を人力で継ぎ直すことになる(`actions.ts` の `importHtml`)。
確信度が高くても確認するのは臆病さではなく、この非対称性の帰結。

確信度が担うのは**候補の並べ替えと初期選択**だけ(`analyzeHtml` の降順ソート)。
ダイアログは全候補をラジオで並べ、それぞれの確信度をパーセントで見せ、
先頭 4 枚を実際にレンダリングしたサムネイルを添えて選び直せるようにする。
**手動でセレクタを打ち込む欄は無い**(候補から選ぶだけ)。

## スクリプトの扱い

**取り込みは `<script>` に触らない。** 種類を見分けることも印を付けることもせず、
書かれたまま `headHtml` / `slideShell` に載せる(`pipeline.ts` の `extractShared`)。
判定不能なスクリプトを消すと再現性が壊れるので、**安全側 = 保持して再現**する。

無効化は**合成側**の責務。`compose.ts` の `neutralizeScripts` が、
**edit モードのときだけ**文書内の全 `<script>` を一律に処理する。種類での出し分けはしない。

| モード | 扱い |
|---|---|
| プレビュー | 著者が書いたまま実行する |
| 編集 | `type` を `application/hse-disabled` に差し替え、元の `type` は `data-hse-type` に退避する。`on*` 属性も `data-hse-on*` へ逃がす。**消さないので保存時にそのまま戻せる**([ADR-0002](../../adr/0002-edit-preview-separation.md)) |
| 書き出し | 著者が書いたまま戻す |

編集モードではフレームワークのページ送りも止まるので、スライドの移動はエディタ側 UI が代行する。

取り込み側で `<script>` に手を入れる唯一の例外が `<deck-stage>` のランタイムで、
これはシェルから抜いて `shared.deckRuntime` に持つ(下記)。捨ててはいない。

## アセットの扱い

**取り込みはアセット参照に手を触れない。** `file://` も相対パスも `https://` も、
著者が書いたまま `headHtml` / `slideShell` / スライド markup に残る
(`buildProject` が返す `assets` は常に空)。

触らないのは未実装だからではなく、**方針として採らないから**。
触らなくてよい markup を取り込みが書き換えるのは、
[development.md §0](../../rules/development.md) の「他人の HTML を壊さない」に正面から反する
—— 参照の書き換えはデッキを静かに壊す典型で、`actions.ts` の `prepare()` は
Artifacts のローダー展開**だけ**を例外に、他は一切書き換えずに Detector へ渡す。
デッキが使うアセットは、そのデッキが元から持っていた形(相対パス・`https://`・`data:`)のまま
再現するのが最も確実で、往復でも失われない。

`assets/` に入るのは**ユーザーがエディタから挿入した画像だけ**。
`Toolbar.tsx` が `backend.importAsset()` で Rust 側のアセットストアに預け、
書き出し時に `commands/project.rs` の `write_deck` が HTML の隣の `assets/` へ吐く。
参照は `assets/<name>` の相対パスで、ステージ上では `compose` の `baseUrl` が
`slides://` オリジンへ解決する。

外部 URL を「オフライン用に取り込む」ことだけは、**ユーザーが明示的に選んだときに限り**あり得る
(未実装。「実装タスク」参照)。既定では取り込まない。

Artifacts の standalone だけは事情が違い、フォントと画像が uuid でバンドルされているので
`data:` URL としてインライン化する(下記)。これはローダー展開の一部で、通常のデッキには走らない。

## 自己展開型アーカイブの展開(Claude Artifacts)

Artifacts の「standalone」書き出しは、デッキそのものではなく**ローダー**。
body はスピナーで、本体の HTML は `<script type="__bundler/template">` に JSON 文字列として、
参照するフォント・画像・スクリプトは `<script type="__bundler/manifest">` に uuid をキーとして
(gzip + base64 で)入っている。開くと JS が blob URL を作って uuid を差し替え、
`document.documentElement` ごと差し替える。

**編集モードでは JS を実行しない([ADR-0002](../../adr/0002-edit-preview-separation.md))以上、
スライドは取り込み時点では存在しない。** そこで `src/import/artifact.ts` が
同じ差し替えを**文字列処理として先に**行う。

| 対象 | 扱い | 理由 |
| --- | --- | --- |
| フォント・画像 | `data:` URL としてインライン化 | 永続化する形は HTML 1 枚だけなので、往復しても失われない形に落とす |
| テンプレートランタイム(x-dc / React / image-slot) | **捨てる**。ただし描くはずだった結果は下の 2 行で静的に補う | エディタがこれから引き取る DOM を組み立てるためのもので、残すとエディタの下でデッキが自分を再描画する |
| `<deck-stage>` のランタイム | **捨てずに取っておき、書き出しにだけ戻す** | これは DOM を作るのではなく**与えられた子要素をプレゼンする**コンポーネント。捨てると書き出した HTML が全スライドを縦に並べただけの別物になる |
| `{{ 変数 }}`(x-dc の補間) | コンポーネントが `data-props` で宣言している **`default` に置換**し、`script[data-dc-script]` ごと捨てる | 補間は `renderVals()` の戻り値を差し込むだけの置換で、テキストにも属性値にも効く。その `renderVals()` を**実行する**のは ADR-0002 が禁じているので、値は宣言された既定値から取る。**宣言の無い変数は空にせず `{{ }}` のまま残す** — 空にすると何が入るはずだったか読めなくなる |
| `<image-slot>`(写真枠) | 未入力なら**同じ見た目のプレースホルダ**(薄い下地・破線枠・`placeholder` のキャプション)に、`src` 付きなら `<img>` に置き換える | shadow DOM を持つカスタム要素なので、ランタイムが無いと**ボックスを持たない未知のインライン要素**になる。空要素として残るのではなく画面から消え、選択もできない。持ち越す属性は `id` だけ(`shape` は `border-radius` に、`fit` は `object-fit` に畳む)。スタイルはインライン — 共有 head に規則を足すと以後の書き出し全部に載る。**キャプションは `pointer-events:none`** で置く(下記)。**ドロップで写真を受け取るのはコンポーネントの機能で、ランタイムと一緒に失われる**([issues](../../issues.md) #100)。代わりの経路はエディタ側が持つ([editing-engine](../editing-engine/design.md) の「箱に画像を入れる」) |
| `<x-dc>` / `<helmet>` / `<x-import>` | 素の HTML に展開(helmet の中身は `<head>` へ、x-import は `<deck-stage>` へ) | ランタイムが無い以上、これらを定義するものが無い |
| `<sc-raw-table>` 等のタグ別名・`sc-camel-*` 属性 | 本来の名前に戻す(DOM 上で要素を作り直す) | テンプレートは文字列として HTML パーサを通るので、バンドラは**パーサが勝手に直してしまう markup を退避している**。`<td>` は `<table>` の外では捨てられ、`<table>` の中の想定外要素は foster parenting で外へ追い出され、属性名は小文字化される(SVG の `viewBox` が死ぬ)。戻し忘れると表は未知のインライン要素の山になって崩れる |

### 写真枠のキャプションはクリックを通す

プレースホルダのキャプションは `position:absolute; inset:0` で**枠全面を覆う**。
そのままだと**枠のどこを押してもキャプションに当たり**、キャプションは自分の文字を持つので
選択はそこで止まる([editing-engine](../editing-engine/design.md) の「選択モデル」)。
結果、枠そのものへはパンくずでしか行けず、ダブルクリックは
**写真枠のプレースホルダ文言にテキストセッションを開く**という妙なことをしていた。

そこで `pointer-events:none` を付ける。破線のリングには最初から付いている。

**これは元の挙動に戻す変更**でもある。`<image-slot>` はキャプションを **shadow DOM の中**に
描いていたので、外から掴めないのが元の姿だった。取り込みがそれを素の `<div>` に開いたことで、
掴めるようになってしまっていた。

不変条件 2 の判定: ①見た目は変わらない(変わるのは**エディタが作った箱の中**のテキスト選択だけで、
元は掴めなかったもの) ②同じ宣言が 1 つ増えるだけで往復で増えない
③この markup はデッキの CSS / JS が知らない要素なので当たり方は変わらない。

### フォントはサブセットして取り込む

日本語ファミリは `unicode-range` で ~120 分割された 7MB として届き、
共有 head はサムネイル 1 枚ごと・自動保存 1 回ごとに再シリアライズされる。そこで:

- (a) デッキが表示しない文字しか覆わない `@font-face` は捨てる
- (b) ウェイト違いだけで同じファイルを指す規則(可変フォントを Google Fonts が
  ウェイトごとに宣言するため起きる)は `font-weight: 400 900` の 1 本にまとめる

実測で **7.67MB → 1.12MB**。

## デッキ自身のプレゼンランタイム(`shared.deckRuntime`)

`<deck-stage>` は**デッキを組み立てるのではなく、与えられた子要素をプレゼンする**コンポーネント
(`<slot>` / `assignedElements` で light DOM の `<section>` をそのまま見せ、
1 枚表示・左サムネイルレール・矢印/PageDown 送り・印刷 CSS を提供する。React 非依存の自己完結スクリプト)。
テンプレートランタイムと違い、**エディタの編集結果を作り直さない**。

そこで取り込み時に捨てず、**シェルからは抜いて `shared.deckRuntime` に持ち、
書き出しを合成するときだけ body の末尾に戻す**。

| モード | ランタイム | 見え方 |
| --- | --- | --- |
| 編集 | 出さない | Detector の `runtimeCss` で縦に流す。キャンバスは 1 枚を描き、サムネイルは左ペインが持つ |
| プレビュー | 出さない | 同上。レールがワークスペースのサムネイルと二重に出るのを避ける |
| 書き出し | 戻す | 元の standalone と同じ体験(1 枚表示・レール・キー送り) |

- **モードで出し分けるのではなく、そもそも編集用のモデルから外して持つ**
- 見つけ方は自前のマーカーではなく `customElements.define('deck-stage', …)` の**実体**。
  書き出した HTML は「インライン script を持つ普通の `<deck-stage>` デッキ」で、手書きのデッキと区別が付かない
- 書き出す `<script>` では `</script` を `<\/script` に退避する。ランタイムの usage コメントに
  `</script>` が含まれており、script 要素はソースのどこであれ最初のそれで終わる
- 併せて `deck-stage:not(:defined){visibility:hidden}` を head に出す。element が定義されるまでは
  取り込みが入れた flow CSS が効くので、大きいデッキだと**全スライドを縦に描いてから 1 枚に畳む**のが見えてしまう
- コンポーネント内部の `::slotted(*){ … !important }` は、外側の通常宣言である `runtimeCss` に勝つ
  (Shadow DOM のカスケードは *通常宣言は外側・重要宣言は内側* が勝つ)。両方が同じ文書にあっても衝突しない

## 書き出しに残してよいもの

判定基準は「エディタ由来かどうか」ではなく、**書き出したものを壊さないかどうか**。
次の 3 つを満たすなら、エディタが入れたものが残っていてよい。

1. **見た目と挙動を変えない** — そのマークアップが無い場合とブラウザでの結果が同じ
2. **往復が固定点** — 書き出した HTML を読み直すと同じプロジェクトに戻り、もう一度書き出すと**バイト一致**する。
   開くたびに増えるものは不可
3. **デッキ自身の CSS / JS の当たり方を変えない** — セレクタ・`:nth-child`・`[data-*]` の一致、
   スクリプトが数える要素数を動かさない

| もの | 残す/落とす | 理由 |
| --- | --- | --- |
| スライド markup の `data-hse-uid` / `contenteditable` / ステージが足したクラス | **落とす**(`cleanElement`) | uid は要素の数だけ増えて ②③ に反し、`contenteditable` は開いた人の画面でページが編集できてしまい(①)、ステージのクラスは全スライドを同時に表示させる(①) |
| 共有 head の足場 CSS(Detector の `runtimeCss`) | **残す** | ランタイムを持たない deck-stage デッキでは**これが無いとスライドが潰れる**。ランタイムが戻る場合も `::slotted !important` に負けるだけで無害(①) |
| `deck-stage:not(:defined)` のガード | **残す** | 定義済みの element には当たらないので、スクリプトが動いた後は無いのと同じ(①) |

②を満たすための仕掛けは**印を 1 つ**だけ。

- エディタが共有シェルに差し込む要素には `data-hse-injected="stage-css" | "deck-guard"` を付ける
  (`compose.ts` の `INJECTED_ATTRIBUTE`)
- 取り込み時、`headHtml` を読む前に `[data-hse-injected]` を文書から除去する
  (`pipeline.ts` の `dropEditorScaffolding`)。次の合成で必ず作り直されるので失うものは無い
- 印が無い時代に書き出したファイルのために、`stageCss(width, height)` の出力と**完全一致**する `<style>`、
  およびガードの固定文字列とも照合する。生成は決定的なので一致すればそれはエディタが書いたもの。
  **一致しないものには触らない**

**スライドの間の空白も固定点の対象。** スライドを抜いた跡にインデントが残ると、
シェルが持つ空白と合成が挟む改行が二重になり、開いて保存するたびに 1 文字ずつ太る。
抜くスライドの直前の空白テキストノードも一緒に落とす(`dropLeadingWhitespace`)。

## 受け入れ条件(EARS 記法)

- WHEN 素の `<section>` デッキを取り込む THE SYSTEM SHALL スライドを分割し、タイトルを報告する
- WHEN reveal.js と汎用パターンの両方に一致する THE SYSTEM SHALL reveal.js を優先し、**別候補も提示する**
- WHEN スライドを分離する THE SYSTEM SHALL head・body 属性・スライド以外の兄弟要素をスライドに混ぜない
- WHEN reveal.js デッキを取り込む THE SYSTEM SHALL 各スライドを包むラッパー連鎖を保持する
- WHEN `<deck-stage>` デッキを取り込む THE SYSTEM SHALL コンポーネントの子要素で分割し、
  宣言されたステージサイズ(16:9 既定ではなく)を採用し、**そのスクリプトをシェルから抜いて保持する**
- WHEN 表示中スライドを示すクラスを持つデッキを取り込む THE SYSTEM SHALL そのクラスを検出して
  `stageClasses` に記録し、**スライドの markup には書き込まない**
- IF 全スライドが同じクラスを持つ THEN THE SYSTEM SHALL それを `stageClasses` として記録しない
- WHEN Artifacts の standalone HTML を取り込む THE SYSTEM SHALL ローダーを、それが描くはずだったデッキに置き換える
- WHEN `{{ 変数 }}` を解決する THE SYSTEM SHALL コンポーネントが宣言する既定値を入れ、
  **解決できない変数はそのまま残す**
- WHEN 空の `<image-slot>` を展開する THE SYSTEM SHALL 目に見えるボックスに変換する
- WHEN 空の `<image-slot>` を展開する THE SYSTEM SHALL そのキャプションをクリックで掴めない形にする
- WHEN **エディタ自身が書き出した** HTML を渡す THE SYSTEM SHALL Artifacts と誤認せず再展開しない
- WHEN 書き出す THE SYSTEM SHALL 元の body 構造を再現し、編集モードでのみスライドルートに印を付ける

## 実装タスク

- [x] Detector チェーン + 確認 UI
- [x] Artifacts 展開・フォントサブセット
- [x] `deckRuntime` の退避と書き出し時の復帰
- [x] 往復固定点(`dropEditorScaffolding` / `dropLeadingWhitespace`)
- [ ] 外部 URL アセットの「オフライン用に取り込む」オプション(未実装)
