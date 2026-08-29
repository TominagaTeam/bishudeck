---
feature: shortcuts
status: active
updated: 2026-08-26
---

# shortcuts — テスト設計

方針は [../../basic-design/08-test-policy.md](../../basic-design/08-test-policy.md) に従う。ここは個別ケースのみ。
ケースは [design.md](design.md) の受け入れ条件（EARS）と対応させる。

## EARS 記法（ケースの書き方）

- `WHEN <イベント/操作> THE SYSTEM SHALL <期待する動作>` — トリガー起点
- `IF <状態/条件> THEN THE SYSTEM SHALL <期待する動作>` — 条件分岐
- `WHILE <継続状態> THE SYSTEM SHALL <期待する動作>` — 継続動作

## 分担

キーの照合と表記は**文字列の生成・解析**なので unit(`src/shared/shortcuts.test.ts`)。
ハンドラ・モーダル・メニューが同時に keydown を聞いている状態で本当に効くかは
実描画でしか見えないので、**手で確認する**。

**自動で守られているのは #1〜#12 だけ。** #13 以降は結線そのものを見る話なので、
アプリを起動して実際にキーを押す。

## テストケース

| # | 種別 | ケース（EARS 形式） | 状態 |
|---|---|---|---|
| 1 | unit | WHEN Command または Control が押される THE SYSTEM SHALL どちらも同じショートカットとして扱う | 実装済み |
| 2 | unit | IF ストロークが名指ししない修飾キーが押されている THEN THE SYSTEM SHALL 一致しない（⌘D と ⌘⇧D の分離） | 実装済み |
| 3 | unit | WHEN JIS 配列で括弧キーが押される THE SYSTEM SHALL `event.code` で照合して一致させる | 実装済み |
| 4 | unit | WHILE Shift が度合いだけを変えるキー（矢印） THE SYSTEM SHALL Shift の有無にかかわらず一致させる | 実装済み |
| 5 | unit | WHEN Tab に Shift が付く THE SYSTEM SHALL 「前へ」として別のショートカットに一致させる | 実装済み |
| 6 | unit | WHEN 他系統の表記のキーが押される THE SYSTEM SHALL 照合では受け、その系統の一覧には出さない（Ctrl+Y） | 実装済み |
| 7 | unit | WHEN ストロークを整形する THE SYSTEM SHALL mac は `⇧⌘]`、pc は `Ctrl+Shift+]` を返す | 実装済み |
| 8 | unit | WHEN テンキーの別名ストロークがある THE SYSTEM SHALL 照合はするが一覧には出さない | 実装済み |
| 9 | unit | IF カタログに id の重複がある THEN THE SYSTEM SHALL テストを失敗させる | 実装済み |
| 10 | unit | IF 同一ハンドラ内でキーが衝突し `contextual` の宣言が無い THEN THE SYSTEM SHALL テストを失敗させる | 実装済み |
| 11 | unit | WHEN 全エントリを整形する THE SYSTEM SHALL mac・pc の両方で空でない表記を返す | 実装済み |
| 12 | unit | WHEN `navigator` の値を分類する THE SYSTEM SHALL MacIntel/Win32/Linux を正しく振り分ける | 実装済み |
| 12b | unit | WHEN ⌘C / ⌘V が押される THE SYSTEM SHALL 要素のクリップボードに一致させ、書式（⌥⌘C / Ctrl+⇧V）とは一致させない | 実装済み |
| 13 | 手動 | WHEN 上バーにヘルプボタンがある THE SYSTEM SHALL 説明に実行環境の表記でキーを出す | 手で確認 |
| 14 | 手動 | WHEN ヘルプボタンを押す THE SYSTEM SHALL 一手でショートカット一覧を開く | 手で確認 |
| 15 | 手動 | WHEN Windows タブを選ぶ THE SYSTEM SHALL `Ctrl+` 表記に差し替え、⌘ を残さない | 手で確認 |
| 16 | 手動 | WHILE 一覧が開いている THE SYSTEM SHALL 編集キー（⌘⇧D）を無視する | 手で確認 |
| 17 | 手動 | WHEN 一覧が開いている状態で Escape が押される THE SYSTEM SHALL 一覧だけを閉じる | 手で確認 |
| 18 | 手動 | WHEN ⌘/ が押される THE SYSTEM SHALL 一覧を開き、もう一度で閉じる | 手で確認 |
| 19 | 手動 | WHEN ⌘⇧D または Ctrl+M が押される THE SYSTEM SHALL スライドを 1 枚追加し、Undo で戻せる | 手で確認 |
| 20 | 手動 | WHEN Home / End が押される THE SYSTEM SHALL 先頭 / 末尾のスライドを選ぶ | 手で確認 |
| 21 | 手動 | WHEN ⌘C → ⌘V を押す THE SYSTEM SHALL WebView がネイティブのコピー / ペーストを横取りせず、要素が増える | 手で確認 |
| 22 | 手動 | WHILE テキストを編集している THE SYSTEM SHALL ⌘C / ⌘V を文字のコピー / 貼り付けのまま通す | 手で確認 |

**ケース 16 と 17 は対で見る。** 一覧を開いたまま ⌘⇧D を押しても増えないこと（16）と、
Escape が一覧だけを閉じて選択を巻き込まないこと（17）。片方だけだと、
「モーダルが全部のキーを食う」実装でも「何も食わない」実装でも通ってしまう。

## 未カバー

- **Windows / Linux 実機での表記と照合。** 判定は unit（#12）、表記は #15 のタブ切替までで、
  実際の WebView2 上での確認はしていない
- **WKWebView / WebView2 が ⌘C・⌘X・⌘V を先に食わないか。** ⌘Z はネイティブの undo に勝てない
  ([../../issues.md](../../issues.md) #89)ので、同じことがクリップボードの 3 つで起きないかは
  **実ウィンドウでしか分からない**（ケース 21・22）
- **⌘O / F5・⇧⌘Return。** どちらもネイティブのダイアログ・ウィンドウを開くので、
  ブラウザ（`npm run dev`）では意味のある確認にならない。`npm run tauri dev` の実ウィンドウで見る
