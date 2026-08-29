---
feature: theme
status: active
updated: 2026-08-26
---

# theme — テスト設計

方針は [../../basic-design/08-test-policy.md](../../basic-design/08-test-policy.md) に従う。ここは個別ケースのみ。
ケースは [design.md](design.md) の受け入れ条件（EARS）と対応させる。

## 種別

- `unit` — Vitest（jsdom）。`src/shared/theme.test.ts`
- `手動` — 手で確認する（[ADR-0009](../../adr/0009-drop-smoke-e2e.md)）

## テストケース

| # | 種別 | ケース（EARS 形式） | 状態 |
|---|---|---|---|
| 1 | unit | IF 好みが保存されていない THEN THE SYSTEM SHALL OS がダークでも `light` を返す | 実装済み |
| 2 | unit | WHEN 好みを保存する THE SYSTEM SHALL 次の読み出しでそれを返す | 実装済み |
| 3 | unit | IF 保存された値が 3 つのいずれでもない THEN THE SYSTEM SHALL 捨てて `light` を返す | 実装済み |
| 4 | unit | WHEN `system` を解決する THE SYSTEM SHALL `prefers-color-scheme` の答えに従う | 実装済み |
| 5 | unit | IF `matchMedia` が無い THEN THE SYSTEM SHALL `system` を `light` として解決する | 実装済み |
| 6 | unit | WHEN `light` / `dark` を解決する THE SYSTEM SHALL OS に関わらずそのまま返す | 実装済み |
| 7 | unit | WHEN テーマを適用する THE SYSTEM SHALL `data-theme` に**解決済みの値だけ**を書く（`system` を書かない） | 実装済み |
| 8 | unit | WHEN OS の外観が変わる THE SYSTEM SHALL 監視の呼び出し元に新しい配色を伝える | 実装済み |
| 9 | unit | WHEN 監視を解除する THE SYSTEM SHALL それ以降伝えない | 実装済み |

## 手で確認すること

**実ブラウザでしか見えないもの**と、**実 OS でしか起こせないもの**。
`#12` は自動化の道が無い —— **CDP のカラースキームエミュレーションは `matches` を変えるが
`change` イベントを発火しない**（2026-08-26 に計測。リスナは 1 回も呼ばれなかった）。

| # | 種別 | ケース（EARS 形式） | 状態 |
|---|---|---|---|
| 10 | 手動 | WHEN ライトで実デッキを取り込む THE SYSTEM SHALL スライド・サムネイル・選択枠・ハンドル・吸着ガイドをダークのときと同じ色で描く | 手で確認 |
| 11 | 手動 | WHEN ライトでインスペクタを一通り開く THE SYSTEM SHALL 見出し・入力欄・スライダー・色見本（特に**白い見本**）・トグルの点灯を読める状態で描く | 手で確認 |
| 12 | 手動 | WHILE `system` が選ばれている WHEN macOS の外観を切り替える THE SYSTEM SHALL 再起動なしで追従する | 手で確認 |
| 13 | 手動 | WHEN ライトで再生する THE SYSTEM SHALL 再生ウィンドウを黒のまま描く | 手で確認 |
| 14 | 手動 | WHEN テーマを変えて書き出す THE SYSTEM SHALL 書き出した HTML に配色の痕跡を残さない | 手で確認 |
| 15 | 手動 | WHEN アプリを起動し直す THE SYSTEM SHALL 前回のテーマで、**最初のフレームから**描く（一瞬だけ白い / 黒いことがない） | 手で確認 |

## 測ったこと

コントラスト比は目視ではなく計算で確認する（[rules/development](../../rules/development.md) §2）。
2026-08-26、ライトで実測した値：

| 対象 | 比 |
|---|---|
| ツールバーのボタン | 14.84 |
| モード切替（選択中） | 13.81 |
| キー表記タブ（選択中） | 13.81 |
| モーダルの既定ボタン（`--accent-fill` に白） | 5.17 |
| ステータスバー・見出しなど `--text-dim` | 5.47 |
| モード切替（非選択。`--text-dim` を窪みの上に） | 4.40 |

**キー表記タブは 1.18 だった** —— `button.active` に足した「塗りの上の白文字」が、
塗りを持たないこのタブにも降りていた。`.toolbar-modes` は自分で `color` を持っていたので無傷で、
**同じ見た目の 2 つのうち片方だけが壊れていた**。両方が自分の前景色を言うようにして解決。
