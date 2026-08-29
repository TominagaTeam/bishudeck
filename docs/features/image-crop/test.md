---
feature: image-crop
status: active
updated: 2026-08-25
---

# image-crop — テスト設計

方針は [../../basic-design/08-test-policy.md](../../basic-design/08-test-policy.md)。
ケースは [design.md](design.md) の受け入れ条件と対応させる。

幾何は `src/stage/cropGesture.test.ts`(純関数)。開始と解除の**構造**は
`src/core/editing/crop.test.ts` が実物の `StageBridge` 越しに見る
— jsdom はどの箱も 0 と測るので、そこで確かめられるのは構造だけ。
選択対象は `src/stage/selectionHeuristics.test.ts`、
シリアライズに痕跡を残さないことは `src/stage/bridge.test.ts`。

## テストケース

### 枠を切る

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 1 | unit | WHEN 手前の辺をドラッグする THE SYSTEM SHALL 画像を画面上で動かさない | 実装済み |
| 2 | unit | WHEN 奥の辺をドラッグする THE SYSTEM SHALL 画像に触れずに枠だけ動かす | 実装済み |
| 3 | unit | WHEN 角をドラッグする THE SYSTEM SHALL 2 辺を同時に動かす | 実装済み |
| 4 | unit | IF 手前の辺が画像の端に達する THEN THE SYSTEM SHALL そこで止める(何も映さない枠にしない) | 実装済み |
| 5 | unit | IF 奥の辺が画像の端に達する THEN THE SYSTEM SHALL 同じく止める | 実装済み |
| 6 | unit | THE SYSTEM SHALL 枠を決して潰さない | 実装済み |

### 画像を滑らせる

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 7 | unit | WHEN 内側をドラッグする THE SYSTEM SHALL 枠を動かさず画像だけ動かす | 実装済み |
| 8 | unit | IF 画像が枠より大きい THEN THE SYSTEM SHALL どの辺も露出させない | 実装済み |
| 9 | unit | IF 画像が枠より小さい THEN THE SYSTEM SHALL 枠の内側に留める | 実装済み |

### `object-fit` の描画矩形

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 10 | unit | WHEN `contain` の画像を測る THE SYSTEM SHALL レターボックスにして中央に置く | 実装済み |
| 11 | unit | WHEN `cover` の画像を測る THE SYSTEM SHALL はみ出させる | 実装済み |
| 12 | unit | WHEN `none` の画像を測る THE SYSTEM SHALL 固有サイズで描く | 実装済み |
| 13 | unit | WHEN `scale-down` の画像を測る THE SYSTEM SHALL **決して拡大しない** | 実装済み |
| 14 | unit | IF `object-fit` の指定が無い THEN THE SYSTEM SHALL 枠を埋める(`fill`) | 実装済み |
| 15 | unit | WHEN `object-position` が指定されている THE SYSTEM SHALL 比率でも長さでも尊重する | 実装済み |
| 16 | unit | IF 画像が固有サイズを持たない THEN THE SYSTEM SHALL 枠を埋める | 実装済み |

### シリアライズ

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 17 | unit | WHEN トリミング中に保存する THE SYSTEM SHALL セッションの痕跡(`data-hse-cropping` / `data-hse-crop-origin`)を残さない | 実装済み(`bridge.test.ts`) |

### 枠と一緒に拡縮する

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 18 | unit | WHEN 枠が横に伸びる THE SYSTEM SHALL 画像の `left` と `width` を同じ倍率で拡縮する | 実装済み |
| 19 | unit | THE SYSTEM SHALL 変えていない軸には触れない | 実装済み |

### 枠を借りる / 作る

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 20 | unit | IF 画像が単独でクリッピング箱に入っている THEN THE SYSTEM SHALL その箱を枠にし、新しい枠を作らない | 実装済み(`crop.test.ts`) |
| 21 | unit | WHEN 同じ画像で開き直す THE SYSTEM SHALL 構造も開始前の記録も変えない | 実装済み(`crop.test.ts`) |
| 22 | unit | IF 借りられる箱が無い THEN THE SYSTEM SHALL 自分の枠を作り `data-hse-crop-owned` を付ける | 実装済み(`crop.test.ts`) |
| 23 | unit | WHEN トリミング済みの画像をクリックする THE SYSTEM SHALL 枠を選ぶ | 実装済み(`selectionHeuristics.test.ts`) |
| 24 | unit | IF 枠がスライド全面を覆っている THEN THE SYSTEM SHALL 背景扱いにせず選択可能に保つ | 実装済み(`selectionHeuristics.test.ts`) |

### 解除

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 25 | unit | WHEN 借りた枠を解除する THE SYSTEM SHALL 枠を残し、枠と画像の `style` を開始前に戻す | 実装済み(`crop.test.ts`) |
| 26 | unit | WHEN 作った枠を解除する THE SYSTEM SHALL 枠を取り除き画像の `style` を戻す | 実装済み(`crop.test.ts`) |
| 27 | unit | WHEN 枠を動かしたあとに解除する THE SYSTEM SHALL translate / rotate を `<img>` に載せ替える(位置は残す) | 実装済み |
| 28 | unit | WHEN 解除を Undo する THE SYSTEM SHALL セッションの印が残らない状態で枠を戻す | 実装済み(`crop.test.ts`) |
| 29 | unit | IF 枠をデッキ自身が書いていた THEN THE SYSTEM SHALL エディタの枠として扱わない | 実装済み |

### トリミング中の枠の認識

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 30 | unit | WHILE トリミング中(クリッピングが外れている) THE SYSTEM SHALL 枠を枠として認識する | 実装済み |
| 31 | unit | THE SYSTEM SHALL セッションの印だけで枠と判定しない(絶対配置の `<img>` は依然必要) | 実装済み |
| 32 | unit | IF 要素がスライドルート THEN THE SYSTEM SHALL 構造が枠と同じでも枠と認識しない | 実装済み |
| 33 | 手動 | WHEN 全面写真のスライドで画像をダブルクリックする THE SYSTEM SHALL トリミングを開く | 手で確認 |

**ケース 33 だけが手作業。** jsdom はどの箱も 0 と測るので、
「全面写真を背景ではなく画像として掴めるか」は実描画でしか見えない
(ケース 24 が見ているのは選択の判定だけで、実際に掴めるかは別)。
開いたあとのグリップが実際にドラッグで動くこともここで一緒に確かめる —
幾何(ケース 1〜9)は純関数として固定されているが、**ポインタがグリップに当たるか**は
実寸の話なので誰も見ていない。
