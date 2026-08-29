---
feature: slide-management
code: src/core/commands/slide.ts, src/features/SlideList.tsx, src/features/Toolbar.tsx（スライドメニュー）
tests: src/core/commands/slide.test.ts
status: 実装済み
updated: 2026-08-26
---

# slide-management — 機能設計

## 概要

デッキを構成するスライドの**並び・枚数**を扱う。左ペインの一覧で現在のスライドを選び、
複製・削除・ドラッグでの並べ替えを行う。スライドの**中身**は扱わない
(それは [editing-engine](../editing-engine/design.md) の担当)。

## 責務と境界

**やること**

- 一覧の表示(実レンダリングのサムネイル)と現在スライドの選択
- 複製 / 削除 / 並べ替えを Command として実行する([ADR-0003](../../adr/0003-all-edits-as-commands.md))
- **操作のあと、どのスライドを画面に出すかを決める**(下記)

**やらないこと**

- 白紙スライドの追加。新規スライドは隣の体裁を引き継ぐ複製に一本化した
  ([roadmap](../../roadmap.md#phase3-dropped) の「Phase 3 で取り下げたもの」)
- スライドサイズ(デッキ全体の論理サイズ)。**エディタからは変えられない** ——
  `shared.designWidth` / `designHeight` は取り込みのときにデッキ自身の宣言から決まり、
  以後は動かさない([import-pipeline](../import-pipeline/design.md))
- サムネイルの中身の描画。`composeSlideDocument` に委ねる

## インターフェース

| 入口 | 実体 |
|---|---|
| 左ペインのクリック | `SlideList` → `useUiStore.setSlideIndex` |
| 左ペインのドラッグ&ドロップ | `SlideList` → `MoveSlideCommand` |
| ツールバー「スライド」メニュー | `Toolbar` → `DuplicateSlideCommand` / `RemoveSlideCommand` |
| ⌘M / ⌘⇧D | `App` → `DuplicateSlideCommand`(キーの正は [shortcuts](../shortcuts/design.md)) |
| ← → ↑ ↓ / Home / End | `useUiStore.step` / `setSlideIndex`(選択が無いときだけ) |
| 一覧の中での ← → ↑ ↓ | `SlideList` → `useUiStore.step`(選択の有無によらず) |

ドキュメントへの書き込みは必ず `useDocumentStore` の
`insertSlide` / `duplicateSlide` / `removeSlide` / `moveSlide` を通す。

## 一覧はキーボードでも歩ける

サムネイルは `role="option"` を持つ **roving tabindex** の listbox。
Tab は**今開いているスライド**のところで一覧に入り、そこから先は矢印が動かす。
`↑` / `↓` は `view.prevSlide` / `view.nextSlide` そのもの — キーの定義は
[shortcuts](../shortcuts/design.md) にあり、ここは押されたときに何をするかだけを持つ。

**一覧の中では、矢印は選択要素の移動(`arrange.nudge`)に渡さない。**
同じキーが 2 つの意味を持つのはアプリ全体では意図どおりだが、
一覧を触っている手にとって ↓ は「次のスライド」以外ではありえない。
`SlideList` が `stopPropagation()` して window のハンドラまで届かせない。

**フォーカスが選択を追うのは、フォーカスが既に一覧の中にあるときだけ。**
ステージで ← → を押しただけでフォーカスが左ペインへ飛ぶと、
次の矢印がスライド送りに化けて、編集中の要素が動かせなくなる。

端では**止まる**(折り返さない)。`useUiStore.step` のクランプをそのまま使うので、
一覧の矢印とステージの矢印で挙動が割れることがない。

## 操作のあと、どのスライドを出すかはコマンドが決める

**並べ替えと削除は、そのコマンド自身が `slide:focusRequest` を発火する。**
`apply` でも `revert` でも発火するので、Undo / Redo にも同じ規則が効く。

そうする理由は **Undo には呼び出し元がいない**から。並べ替えを起こしたドロップは
とうに終わっていて、そのスライドがどこへ行ったかを知っているのはコマンドだけ。
前進方向だけを呼び出し元(`SlideList` の `onDrop`、`Toolbar` の削除)が
`setSlideIndex` していたときは、Undo すると**編集していたのとは別のスライドが開いた**
([issues](../../issues.md) #11)。

`core` は `app` に依存できない([05-directory](../../basic-design/05-directory.md) の依存方向)ので、
ストアを直接触らずイベントで頼む。購読は `uiStore.ts` の末尾。

| コマンド | apply が頼む index | revert が頼む index |
|---|---|---|
| `MoveSlideCommand` | `to` | `from` |
| `RemoveSlideCommand` | 穴に詰まったスライド(`min(消した位置, 残り枚数 - 1)`) | 消した位置 |
| `DuplicateSlideCommand` | 頼まない | 頼まない |

**複製が頼まないのは、複製元の位置が動かないから。** 複製は常に現在のスライドを
**次の兄弟として**挿すので、`slideIndex` は複製元を指したままで正しい。
Undo は挿した 1 枚を消すだけなので、こちらも動かない。

### `ctx.document.project` は apply 実行前のスナップショット

`CommandContext` は `execute()` が `useDocumentStore.getState()` を 1 度読んで作る。
zustand の `set` は新しい state オブジェクトを作るので、**そのスナップショットの
`project` は書き込んだあとも古いまま**。アクション関数(`removeSlide` 等)は内部で
`get()` するので正しく動くが、**書き込んだ直後に枚数を数え直す用途には使えない**。
`RemoveSlideCommand` が残り枚数を `apply` 冒頭で捕まえた配列から数えているのはこのため。

## 受け入れ条件（EARS 記法）

- WHEN 一覧のサムネイルをクリックする THE SYSTEM SHALL そのスライドを編集ステージに開く
- WHEN 一覧にフォーカスがある状態で ↑ / ↓ を押す THE SYSTEM SHALL 1 枚ずつ隣のスライドを開き、**端では止まる**
- WHILE 一覧にフォーカスがある THE SYSTEM SHALL 矢印を選択要素の移動に渡さない
- WHEN 一覧の外からスライドが切り替わる THE SYSTEM SHALL フォーカスを一覧へ引き込まない
- WHEN サムネイルを別の位置へドロップする THE SYSTEM SHALL その順序に並べ替え、**ドロップ先のスライドを開いたままにする**
- WHEN 並べ替えを Undo する THE SYSTEM SHALL 元の順序に戻し、**同じスライドを開き直す**
- WHEN スライドを削除する THE SYSTEM SHALL 穴に詰まったスライド(無ければ末尾)を開く
- WHEN 削除を Undo する THE SYSTEM SHALL そのスライドを元の位置へ戻し、**それを開く**
- WHEN スライドを複製する THE SYSTEM SHALL 複製元の次に挿し、**複製元を開いたままにする**
- WHILE ドラッグで連続して並べ替える THE SYSTEM SHALL 1 つの Undo ステップにまとめる

## 実装タスク

- [x] 一覧・選択・サムネイル(`SlideList`)
- [x] 複製 / 削除 / 並べ替えのコマンド化
- [x] 連続した並べ替えの `tryMerge`
- [x] Undo / Redo で `slideIndex` を追従させる(issues #11)
- [ ] 複製した直後に**複製先**へ移るか(PowerPoint はそうする)。今は複製元に留まる。未検討
