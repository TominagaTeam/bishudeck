---
name: glossary
status: active
updated: 2026-08-21
---

# 用語集

ドメイン用語のブレは AI の誤解の温床。コード・ドキュメント・会話で使う言葉をここで統一する。

| 用語 | コード上の名前 | 意味 |
|---|---|---|
| デッキ | — | 取り込む HTML スライド 1 ファイル分。スライドの集合 |
| スライド | `Slide` | デッキの 1 枚。正データは `html`(自分の最外要素を含むフラグメント) |
| 共有リソース | `SharedResources` | 全スライドに共通するもの(`head` の中身、`html`/`body` 属性、殻、ステージサイズ) |
| 殻(シェル) | `slideShell` | 元の body からスライドを抜き、`SLIDE_SLOT` を残したもの。ここにスライドを差し戻して描く |
| ステージ | `stage/`, `StageSurface` | スライドを描く iframe とその周辺。編集用とプレビュー用がある |
| ステージクラス | `stageClasses` | デッキが「表示中のスライド」に付けるクラス(`is-active` 等)。**描画時にだけ当て、markup には書かない** |
| ステージサイズ | `designWidth` / `designHeight` | スライドを描く論理ピクセル数。既定 1280×720 |
| StageBridge | `stage/bridge.ts` | **iframe の DOM に触る唯一の窓口**。uid 解決・矩形取得・シリアライズを仲介する |
| uid | `data-hse-uid` | 編集用に全要素へ付ける一時 ID。**シリアライズで完全除去する**。要素は DOM 参照ではなくこれで指す |
| Command | `EditCommand` | 編集操作 1 つ。`apply` / `revert` / `tryMerge` を持つ。**すべての変更はこれを経由する** |
| 合成 | `compose.ts` | 共有リソースとスライドから 1 枚の HTML を組み立てること。編集 / プレビュー / 書き出しでモードが違う |
| Detector | `SlideDetector` | 「どこでスライドを切るか」を判定するもの。フレームワークごとにチェーンで並ぶ |
| `runtimeCss` | `runtimeCss` | デッキのランタイムが描画時に当てるはずだった CSS。共有 head の**先頭**に置く |
| デッキランタイム | `shared.deckRuntime` | デッキ自身のプレゼンスクリプト(`<deck-stage>`)。**書き出しにだけ戻す** |
| テンプレートランタイム | — | デッキを**組み立てる**スクリプト(x-dc / React)。取り込み時に**捨てて**結果を静的化する |
| 足場(スキャフォールディング) | `data-hse-injected` | エディタが共有 head に差し込む CSS / ガード。**残してよいが往復で増えてはいけない** |
| プレースホルダ | — | プレビューで index を合わせるために並べる空スライド。**preview モード限定** |
| オーバーレイ | `stage/Overlay.tsx` | 選択枠・ハンドル・ガイド。**ステージの外(ホスト側 DOM)に描く** |
| シールド | `.stage-shield` / 編集シールド | クリックを吸うための透明な層。再生中はキーを奪われないため、文字編集中はセッションを閉じるため |
| パンくず | `ancestryOf` | 選択要素の祖先チェーン(`div.container > h1`)。**スライドルートは載せない** |
| `focusUid` | `focusUid` | パンくずをホバー / フォーカスしたときのプレビュー対象。**選択(`uid`)とは別に持つ** |
| 背景(スライド面) | `chooseSelectionTarget` | スライドの四辺すべてに 4% 以内で届く要素。クリックしても選択されない |
| 枠 / 画像(トリミング) | `crop.ts` | トリミングの 2 矩形。枠は `overflow:hidden` の箱、画像はその中の絶対配置 `<img>` |
| 往復の固定点 | `roundTrip.test.ts` | 書き出し → 読み直し → 再書き出しが**バイト一致**すること |
| 書き出し先 | — | 保存 = 書き出しなので、自動保存が書き込む HTML のパス。**取り込み元を自動採用しない** |
| Artifacts standalone | `isArtifactHtml()` | Claude Artifacts の自己展開型 HTML。ローダーであってデッキではない |
