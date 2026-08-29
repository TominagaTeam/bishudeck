---
feature: import-pipeline
status: active
updated: 2026-08-26
---

# import-pipeline — テスト設計

方針は [../../basic-design/08-test-policy.md](../../basic-design/08-test-policy.md) に従う。
ケースは [design.md](design.md) の受け入れ条件と対応させる。

実体は `src/import/pipeline.test.ts` / `src/import/artifact.test.ts` /
`src/core/document/compose.test.ts` / `src/core/document/roundTrip.test.ts`。

## テストケース

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 1 | unit | WHEN 素の section デッキを取り込む THE SYSTEM SHALL 分割してタイトルを報告する | 実装済み |
| 2 | unit | WHEN reveal.js と汎用パターンが両方一致する THE SYSTEM SHALL reveal.js を優先する | 実装済み |
| 3 | unit | WHEN 推測が外れうる THE SYSTEM SHALL 上書きできる別候補を提示する | 実装済み |
| 4 | unit | WHEN スライドを分離する THE SYSTEM SHALL head・body 属性・非スライド兄弟をスライドに混ぜない | 実装済み |
| 5 | unit | WHEN reveal.js デッキを取り込む THE SYSTEM SHALL 各スライドのラッパー連鎖を保持する | 実装済み |
| 6 | unit | WHEN スライドを抜く THE SYSTEM SHALL シェルに 2 枚目を残さない | 実装済み |
| 7 | unit | WHEN deck-stage デッキを取り込む THE SYSTEM SHALL コンポーネントの子で分割し汎用パターンに勝つ | 実装済み |
| 8 | unit | WHEN deck-stage デッキを取り込む THE SYSTEM SHALL そのスクリプトをシェルから抜いて保持する | 実装済み |
| 9 | unit | WHEN deck-stage がサイズを宣言している THE SYSTEM SHALL 16:9 既定ではなくそれを採用する | 実装済み |
| 10 | unit | WHEN ランタイムが無い THE SYSTEM SHALL コンポーネントが当てるはずだった geometry を供給する | 実装済み |
| 11 | unit | WHEN 書き出す THE SYSTEM SHALL 全スライドを 1 つのステージに積む | 実装済み |
| 12 | unit | WHEN 表示中スライドを示すクラスがある THE SYSTEM SHALL それを検出して記録する | 実装済み |
| 13 | unit | IF 全スライドが同じクラスを持つ THEN THE SYSTEM SHALL それを記録しない | 実装済み |
| 14 | unit | WHEN スライドをステージに描く THE SYSTEM SHALL そのクラスを当てる | 実装済み |
| 15 | unit | WHEN スライドを描く THE SYSTEM SHALL **元の markup にはそのクラスを書き込まない** | 実装済み |
| 16 | unit | WHEN 書き出す THE SYSTEM SHALL active スライドの決定をデッキ自身に委ねる | 実装済み |
| 17 | unit | WHEN 書き出す THE SYSTEM SHALL 元の body 構造を再現する | 実装済み |
| 18 | unit | WHEN プレビューモードで合成する THE SYSTEM SHALL スタイルとスクリプトを再現する | 実装済み |
| 19 | unit | WHEN 編集モードで合成する THE SYSTEM SHALL CSS は保ちつつ**すべてのスクリプトを無効化する** | 実装済み |
| 20 | unit | WHEN 編集モードで合成する THE SYSTEM SHALL スライドルートに印を付ける(**書き出しでは付けない**) | 実装済み |
| 21 | unit | WHEN 相対アセット参照がある THE SYSTEM SHALL slides オリジンへ向ける | 実装済み |
| 22 | unit | WHEN Artifacts の standalone を渡す THE SYSTEM SHALL ローダーが描くはずのデッキに置き換える | 実装済み |
| 23 | unit | WHEN **エディタ自身が書き出した** HTML を渡す THE SYSTEM SHALL Artifacts と誤認しない | 実装済み |
| 24 | unit | WHEN 普通のデッキを渡す THE SYSTEM SHALL 手を触れない | 実装済み |
| 25 | unit | WHEN x-dc ラッパーを展開する THE SYSTEM SHALL 素の HTML に平坦化する | 実装済み |
| 26 | unit | WHEN テンプレートランタイムがある THE SYSTEM SHALL 捨てる | 実装済み |
| 27 | unit | WHEN プレゼンランタイムがある THE SYSTEM SHALL 保持する | 実装済み |
| 28 | unit | WHEN manifest に画像がある THE SYSTEM SHALL data URL としてインライン化する | 実装済み |
| 29 | unit | WHEN `{{ 変数 }}` を解決する THE SYSTEM SHALL 宣言された既定値を入れる | 実装済み |
| 30 | unit | IF 変数を解決できない THEN THE SYSTEM SHALL `{{ }}` のまま残す | 実装済み |
| 31 | unit | WHEN 変数が解決済みになる THE SYSTEM SHALL ロジックブロックを捨てる | 実装済み |
| 32 | unit | WHEN 空の image-slot がある THE SYSTEM SHALL 目に見えるボックスに変える | 実装済み |
| 33 | unit | WHEN src 付きの image-slot がある THE SYSTEM SHALL 表示していた画像に変える | 実装済み |
| 34 | unit | WHEN 展開結果を出力する THE SYSTEM SHALL 読み直しても同じに読める markup を出す | 実装済み |
| 35 | unit | WHEN バンドラが逃がした表の markup がある THE SYSTEM SHALL 本来の table を組み直す | 実装済み |
| 36 | unit | WHEN その table を出力する THE SYSTEM SHALL 再パースに耐える形で出す | 実装済み |
| 37 | unit | WHEN camelCase 属性が退避されている THE SYSTEM SHALL 元の名前に戻す | 実装済み |
| 38 | unit | WHEN helmet が退避されている THE SYSTEM SHALL helmet として読む | 実装済み |
| 39 | unit | WHEN フォントをサブセットする THE SYSTEM SHALL デッキが表示する文字を覆うフェイスだけ残す | 実装済み |
| 40 | unit | WHEN `unicode-range` にワイルドカードがある THE SYSTEM SHALL 正しく読む | 実装済み |
| 41 | unit | WHEN 同じファイルを指すウェイト違いがある THE SYSTEM SHALL 1 本の規則にまとめる | 実装済み |
| 42 | unit | IF `@font-face` が range を宣言していない THEN THE SYSTEM SHALL 残す | 実装済み |
| 43 | unit | WHEN manifest エントリが gzip 圧縮されている THE SYSTEM SHALL gunzip してからインライン化する | 実装済み |
| 45 | unit | WHEN 空の image-slot を展開する THE SYSTEM SHALL キャプションをクリックで掴めない形にする | 実装済み |
| 44 | 手動 | WHEN 実 HTML を取り込む THE SYSTEM SHALL 検出・分割・可視性・サムネイル収まりを実物で満たす | 手で確認 |
| 46 | 手動 | WHEN 取り込んだデッキの写真枠を 1 回クリックする THE SYSTEM SHALL キャプションではなく枠そのものを選ぶ | 手で確認 |

**厄介なパターンは実物にしか出てこない。** 新しいデッキで不具合が出たら、
まずそのファイルをアプリに取り込み、**検出したパターン・分割された枚数・
各スライドが見えていること・サムネイルが枠に収まっていること**を目で確かめる。
再現したら、その形を切り出して unit のケースに足す(unit のケースはそうやって増えてきた)。

**#46 はパンくずで判定する。** 写真枠を 1 回クリックしたとき、右ペインのパンくずが
`div#cover-terminal › div`(箱 → 枠)で**止まる**こと —— その先にもう 1 階層続いていたら、
キャプションを掴んでいる。検証用デッキ(`samples/local/claude-code-basics.html`)の
表紙スライドがこの `#cover-terminal`(`<image-slot>`)を持つ。
