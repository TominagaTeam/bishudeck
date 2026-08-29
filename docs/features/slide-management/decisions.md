---
feature: slide-management
status: active
updated: 2026-08-29
---

# slide-management — 判断ログ

蒸し返し防止用。仕様の正は [design.md](design.md)。
全体に影響する判断は [../../adr/](../../adr/) へ。

## ログ

| # | 日付 | 判断 | 理由 | 見送った代替案 | 状態 |
|---|---|---|---|---|---|
| 1 | 2026-08-23 | **操作後にどのスライドを出すかはコマンドが決める**(`slide:focusRequest` を `apply` / `revert` の両方で発火) | Undo には呼び出し元がいない。並べ替えを起こしたドロップはとうに終わっており、そのスライドがどこへ行ったかを知っているのはコマンドだけ。前進方向だけを呼び出し元が `setSlideIndex` していたので、Undo すると編集中だったのと別のスライドが開いていた([issues](../../issues.md) #11) | コマンドから `uiStore` を直接呼ぶ(`core → app` の依存が逆流する) / 呼び出し元が revert 後の index も計算する(履歴のどこから戻るかを呼び出し元は知らない) | 反映済 |
| 2 | 2026-08-23 | **`DuplicateSlideCommand` は index を頼まない** | 複製は現在のスライドの**次の兄弟**として挿すので、複製元の index は動かない。Undo も挿した 1 枚を消すだけ。頼めば「同じ値を設定し直す」だけの空回りになる | 一律に全コマンドが頼む(意味のない再設定が入る) | 反映済 |
| 3 | 2026-08-23 | 削除後の残り枚数は **`apply` 冒頭で捕まえた配列**から数える | `ctx.document` は `execute()` が 1 度だけ読んだストアのスナップショットで、`removeSlide` のあとも `project` は古いまま。ここを `ctx.document.project.slides.length` で数えて末尾削除が 1 枚ぶんずれた(テストで検出) | 書き込み後に `useDocumentStore.getState()` を読み直す(`core` のコマンドがストアの実体に触れることになり、`CommandContext` を渡している意味が消える) | 反映済 |
| 4 | 2026-08-26 | **スライドサイズの変更機能を削除した**(ツールバーの「スライド → スライドサイズ」・`SlideSizeDialog`・`SetDesignSizeCommand`・store の `setDesignSize`・専用の i18n キーと CSS) | **必要ないものと判断したため。** `shared.designWidth` / `designHeight` は残している —— 取り込みのときにデッキ自身の宣言から決まり、ステージの fit スケールと `100vh` の解決に要るので、**値が動かなくなっただけ**で論理サイズという概念は生きている | — | 反映済 |
