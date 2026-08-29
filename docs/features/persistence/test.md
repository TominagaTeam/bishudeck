---
feature: persistence
status: active
updated: 2026-08-25
---

# persistence — テスト設計

方針の正は [basic-design/08-test-policy.md](../../basic-design/08-test-policy.md)。

## テストケース

### 自動保存のスケジューラ

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 1 | unit | WHEN 変更が連続する THE SYSTEM SHALL 収まってから 1 回だけ書く | 実装済み |
| 2 | unit | WHILE 書き込み中に変更が来る THE SYSTEM SHALL 追い越させず、その変更も後で書く | 実装済み |
| 3 | unit | WHEN flush する THE SYSTEM SHALL 待ち時間を消化せず即座に書く | 実装済み |
| 4 | unit | IF 書き込みが失敗する THEN THE SYSTEM SHALL 次の書き込みを止めない | 実装済み |
| 5 | unit | WHEN cancel する THE SYSTEM SHALL 以後何も書かない | 実装済み |

実体は `src/app/autosave.test.ts`。

**ケース 2 が一番重要。** 追い越しが起きると**古い内容が後に着く**のでファイルが巻き戻る。
debounce だけを見るケース 1 では絶対に出ない。

### 終了時の確認

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 6 | unit | WHEN 3 択のどれかを押す THE SYSTEM SHALL その答えを返す | 実装済み |
| 7 | unit | IF 2 つ目の確認が来る THEN THE SYSTEM SHALL 前の問いに「留まる」と答える | 実装済み |
| 8 | unit | IF 問いが出ていないのに答えが来る THEN THE SYSTEM SHALL 無視する | 実装済み |

実体は `src/app/closePrompt.test.ts`。

### 実際に書けること(手で確認)

スケジューラ(1〜5)とファイル I/O(14〜16)は自動で守られているが、
**その 2 つが実際につながっていること**は動かさないと見えない。

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 9 | 手動 | WHEN 編集直後 THE SYSTEM SHALL まだ書き込まない | 手で確認 |
| 10 | 手動 | WHEN 手を止める THE SYSTEM SHALL バックエンドへ 1 回だけ書く | 手で確認 |
| 11 | 手動 | WHILE 変更がある THE SYSTEM SHALL 「変更あり」と表示する | 手で確認 |
| 12 | 手動 | WHEN 自動保存が終わる THE SYSTEM SHALL 「書き出し済み HH:MM」と表示する | 手で確認 |
| 13 | 手動 | WHEN 書き出す THE SYSTEM SHALL エディタの痕跡を残さない | 手で確認 |

**ケース 13 は書き出したファイルを開いて確かめる。** `data-hse-*` /
`contenteditable` / ステージが足したクラスが 1 つも残っていないこと
(不変条件。[rules/development](../../rules/development.md) §4)。

### ファイルに届くこと（Rust）

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 14 | rust | WHEN 書き出して読み直す THE SYSTEM SHALL 同じ文字列を返す | 実装済み |
| 15 | rust | WHEN 書き出す THE SYSTEM SHALL 一時ファイルを残さない | 実装済み |
| 16 | rust | WHEN 書き出す THE SYSTEM SHALL HTML の隣に `assets/` を書く | 実装済み |

実体は `src-tauri/src/commands/project.rs` の `#[cfg(test)]`。

**ケース 15 は不変条件 12 の一部しか見ていない。** 確かめているのは
「書き終えたあと `.html.tmp` が残っていない」ことで、
**「書いている途中で落ちても前の版が残る」ほうは確かめていない** —
プロセスを本当に中断させないと書けないので、ここは構造(temp → rename)に頼っている。
テスト名から受ける印象より守備範囲は狭い。
