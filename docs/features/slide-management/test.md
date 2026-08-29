---
feature: slide-management
status: active
updated: 2026-08-26
---

# slide-management — テスト設計

方針の正は [basic-design/08-test-policy.md](../../basic-design/08-test-policy.md)。ここは個別ケースだけ。

## テストケース

### 並べ替え・削除と `slideIndex`

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 1 | unit | WHEN スライドを削除する THE SYSTEM SHALL 穴に詰まったスライドを開く | 実装済み |
| 2 | unit | WHEN 削除を Undo する THE SYSTEM SHALL 元の位置へ戻し、それを開く | 実装済み |
| 3 | unit | WHEN 末尾のスライドを削除する THE SYSTEM SHALL 新しい末尾を開く | 実装済み |
| 4 | unit | WHEN 並べ替える THE SYSTEM SHALL 移動先のスライドを開いたままにする | 実装済み |
| 5 | unit | WHEN 並べ替えを Undo する THE SYSTEM SHALL 元の位置のスライドを開き直す | 実装済み |
| 6 | unit | WHEN Redo する THE SYSTEM SHALL 前進方向の index に戻す | 実装済み |

実体は `src/core/commands/slide.test.ts`。

**ケース 3 が一番重要。** 削除後の枚数は `ctx.document.project` からは読めない
(context を作った時点のスナップショットなので古い)。
ケース 1 は削除位置が中ほどなのでクランプが効かず、**間違った実装でも通ってしまう**。
末尾を消すケースだけがそこを踏む。

**#7〜#9 は欠番。** スライドサイズ変更の廃止(2026-08-26)で落とした。
残りの番号は本文から参照しているので詰めない。

### 一覧の操作(実描画が要るもの)

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 10 | 手動 | WHEN ⌘⇧D / Ctrl+M を押す THE SYSTEM SHALL スライドを 1 枚増やす | 手で確認 |
| 11 | 手動 | WHEN Home / End を押す THE SYSTEM SHALL 先頭 / 末尾のスライドへ飛ぶ | 手で確認 |
| 12 | unit | WHEN 端で送ろうとする THE SYSTEM SHALL 折り返さずその場に留まる | 実装済み |
| 13 | unit | IF スライドが 1 枚も無い THEN THE SYSTEM SHALL 何もしない | 実装済み |
| 14 | 手動 | WHEN 一覧にフォーカスがある状態で ↑ / ↓ を押す THE SYSTEM SHALL 隣のスライドを開く | **未確認** |
| 15 | 手動 | WHILE 一覧にフォーカスがあり要素も選択されている THE SYSTEM SHALL 矢印で要素を動かさない | **未確認** |

12・13 の実体は `src/app/uiStore.test.ts`。10・11 は手で確認する
([shortcuts/test.md](../shortcuts/test.md) の #19・#20 と同じもの)。

**14・15 は実描画とフォーカスが要る**ので unit では見えない。
`step` のクランプ(12・13)と[キー定義の衝突検査](../shortcuts/test.md)までは自動で守られているが、
**「一覧にフォーカスがあるとき矢印がスライド送りになる」結線そのものは未検証**。
