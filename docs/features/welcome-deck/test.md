---
feature: welcome-deck
status: active
updated: 2026-08-26
---

# welcome-deck — テスト設計

方針は [../../basic-design/08-test-policy.md](../../basic-design/08-test-policy.md) に従う。
ケースは [design.md](design.md) の受け入れ条件と対応する。

## テストケース

| # | 種別 | ケース（EARS 形式） | 状態 |
|---|---|---|---|
| 1 | unit | WHEN 同梱デッキを `analyzeHtml` に通す THE SYSTEM SHALL `generic` Detector が 11 スライドとして拾い、タイトルを「Bishudeck へようこそ」と読む | 実装済み |
| 2 | unit | IF 同梱デッキに `<script>` が含まれる THEN テストは落ちる（編集モードで JS は動かないため） | 実装済み |
| 3 | unit | WHEN 同梱デッキからプロジェクトを組む THE SYSTEM SHALL 1280×720 のステージサイズにする | 実装済み |
| 4 | unit | WHEN 同梱デッキを書き出して読み直す THE SYSTEM SHALL 同じ 11 スライドとして分割できる | 実装済み |
| 5 | unit | WHEN 空のウィンドウで `openWelcomeDeck()` を呼ぶ THE SYSTEM SHALL 11 スライドを読み込み、`filePath` を null・`dirty` を false にする | 実装済み |
| 6 | unit | IF すでにデッキが開かれている THEN THE SYSTEM SHALL 何もせず false を返す | 実装済み |

## 手で確認すること

jsdom では矩形がすべて 0 で、`slides://` も無い。**見え方と操作性はここでしか分からない。**

| # | 種別 | ケース（EARS 形式） | 状態 |
|---|---|---|---|
| 7 | 手動 | WHEN `npm run tauri dev` で起動する THE SYSTEM SHALL 1 枚目のガイドを表示し、スライド一覧に 11 枚のサムネイルを並べる | 手で確認 |
| 8 | 手動 | WHEN ガイドの見出しや本文をクリックする THE SYSTEM SHALL その要素だけを選択する（スライド大の要素やカード全体にならない） | 手で確認 |
| 9 | 手動 | WHEN ガイドの文をダブルクリックする THE SYSTEM SHALL その場で文字を打ち替えられる | 手で確認 |
| 10 | 手動 | WHEN 11 枚を送って見る THE SYSTEM SHALL どのスライドも枠内に収まり、文字が切れない（同梱書体で描かれる） | 手で確認 |
| 11 | 手動 | WHEN ガイドを触らずにウィンドウを閉じる THE SYSTEM SHALL 終了確認を出さない | 手で確認 |
| 12 | 手動 | WHEN ガイドを開いたまま自分の HTML を取り込む THE SYSTEM SHALL ガイドを置き換える | 手で確認 |
| 13 | 手動 | WHEN F5 で再生する THE SYSTEM SHALL ガイドを全画面で送れる | 手で確認 |
