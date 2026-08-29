---
feature: persistence
code: src/app/autosave.ts, src/app/closePrompt.ts, src-tauri/src/commands/project.rs
tests: src/app/autosave.test.ts, src/app/closePrompt.test.ts
status: 実装済み
updated: 2026-08-25
---

# persistence — 機能設計

## 概要

デッキをディスクへ書き、ディスクから読む。**保存形式はデッキ自身の HTML ファイル 1 枚**で、
別のプロジェクトファイルは持たない([ADR-0001](../../adr/0001-html-as-source-of-truth.md))。
書き出し・自動保存・終了時の確認がこの機能。

## 責務と境界

**やること**

- HTML の読み書き(`read_text_file` / `export_html`)と**アトミックな書き込み**
- アイドル 2 秒での自動保存と、書き込みの直列化
- 閉じようとしたときの取りこぼし防止(書くか、訊くか)

**やらないこと**

- HTML の中身の組み立て。`composeDocument` の担当([import-pipeline](../import-pipeline/design.md))
- アセットのバイト列の管理([asset-pipeline](../asset-pipeline/design.md))
- **Rust 側は HTML を解釈しない**(不変条件 9)。受け取った文字列をそのまま書くだけ

## 書き込みは必ず一時ファイル経由の rename

`write_deck`(`commands/project.rs`)は `deck.html.tmp` へ書いてから rename する。
**自動保存も同じ経路**を通る(不変条件 12)。

理由は自動保存の存在そのもの。ユーザーが頼んでいない書き込みが 2 秒おきに走るので、
その 1 回が中断したときに**直前の版まで失う**なら、機能として成立しない。
rename は同一ファイルシステム内で atomic なので、途中で切れても古い版が残る。

## 自動保存が守る 3 つのこと

`AutosaveScheduler`(`app/autosave.ts`)は debounce だけの器ではない。

| 守ること | どう守るか |
|---|---|
| **書きすぎない** | アイドル `AUTOSAVE_IDLE_MS`(2000ms)。1 打鍵ごとにデッキ全体を直列化しない |
| **追い越さない** | 実行中フラグ。遅い書き込みを次の書き込みが追い越すと、**古い内容が後に着く** |
| **取りこぼさない** | 書き込み中に来た変更は `#again` で覚え、終わってから再スケジュールする |

**「保存済み」と記録するのは、書いている間にドキュメントが動いていないときだけ。**
`autosaveNow()` が `project` の同一性で判定する。動いていたら dirty のままにする —
そうしないと「保存済み」と出ているのにファイルには無い変更が生まれる。

## 場所を決めるのはユーザー

**一度も書き出していないデッキは自動保存しない。** 保存先を選ぶのはユーザーの判断で、
勝手にどこかへ書くわけにいかないため。その代わり、**閉じるときに捕まえる**。

| 状況 | 閉じようとしたとき |
|---|---|
| 変更なし | そのまま閉じる |
| 変更あり + 保存先あり | **黙って flush してから閉じる**(訊く必要が無い) |
| 変更あり + 保存先なし | ダイアログで訊く([CloseConfirmDialog](../../basic-design/07-ui-system.md)) |

ダイアログの答えは**3 つ**(書き出して終了 / 書き出さずに終了 / 終了をキャンセル)。
OS 標準の 2 択だと、**× の押し間違いに逃げ道が無い** — セッションを捨てるか、
選んでいない場所へ書くかのどちらかになってしまう。

書き出しダイアログを閉じられた場合(`dirty` が残る)は**閉じない**。
保存先を選ばなかったのは「まだ終わるつもりが無い」ということなので。

## 受け入れ条件（EARS 記法）

- WHEN 編集してから 2 秒手を止める THE SYSTEM SHALL 自動保存する
- WHEN 編集直後 THE SYSTEM SHALL まだ書き込まない
- IF 保存先が未定 THEN THE SYSTEM SHALL 自動保存しない
- WHILE 書き込み中に次の変更が来る THE SYSTEM SHALL 書き込みを追い越させず、後で書き直す
- WHEN 書き込みが中断される THE SYSTEM SHALL 直前の版を残す(一時ファイル + rename)
- WHEN 保存先のあるデッキを閉じる THE SYSTEM SHALL 訊かずに書いてから閉じる
- WHEN 保存先の無い変更ありデッキを閉じる THE SYSTEM SHALL 3 択で訊く
- WHEN 「終了をキャンセル」を選ぶ THE SYSTEM SHALL 何も書かず、閉じもしない

## 実装タスク

- [x] アトミックな書き込み
- [x] 自動保存(debounce・直列化・取りこぼし防止)
- [x] 終了時の 3 択ダイアログ
- [ ] 保存先の履歴(最近開いたデッキ)。未着手
