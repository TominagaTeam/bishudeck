---
feature: presentation
code: src/app/Present.tsx, src/stage/PreviewStage.tsx, src-tauri/src/commands/window.rs
tests: なし（自動テストは無く、手で確かめる）
status: 実装済み
updated: 2026-08-25
---

# presentation — 機能設計

## 概要

デッキを全画面で再生する(F10)。専用ウィンドウを 1 枚だけ持ち、
編集ウィンドウとは**別の webview / 別の JS コンテキスト**で動く。

## 責務と境界

**やること**

- 再生ウィンドウの表示 / 非表示と simple fullscreen の出し入れ
- 現在のプロジェクトをバックエンド経由で取り寄せ、ページ送りする
- キーボードの掌握(← → Esc)とクリックでのページ送り

**やらないこと**

- スライドの合成。`composeSlideDocument` / `PreviewStage` に委ねる
  ([import-pipeline](../import-pipeline/design.md))
- **ウィンドウのライフサイクルの決定。正は
  [basic-design/04-architecture](../../basic-design/04-architecture.md)**
  ([rules/development](../../rules/development.md) §3 の対応表)。ここでは要約しか書かない
- 編集。再生中のステージは読み取り専用

## インターフェース

| 入口 | 実体 |
|---|---|
| ツールバー「再生」/ F5 | `backend.openPresentationWindow(slideIndex)` |
| 2 回目以降の再生 | `present:start` イベント(ウィンドウは作り直さない) |
| 終了 | Esc → `backend.closePresentationWindow()` |
| デッキの取得 | `backend.getLiveProject()`(編集側が `set_live_project` で鏡を置く) |

編集側のストアは共有しない。**別コンテキストなので共有できない**のが理由で、
プロジェクトは Rust 側に置いた鏡を経由して渡る。

## 壊してはいけない約束(要約)

詳細と理由は [04-architecture](../../basic-design/04-architecture.md)。ここは索引。

| # | 約束 | 破ると |
|---|---|---|
| 16 | 再生ウィンドウを `close()` しない。終了は simple fullscreen 解除 + hide | WebKit の layer-tree コミット中に webview を壊し、アプリごと SIGSEGV |
| 16 | ネイティブ fullscreen ではなく **simple fullscreen** | 退出アニメーションの途中で hide が滑り、空のウィンドウが残る |
| 17 | simple fullscreen のあと webview へ first responder を返す | ←/→/Esc が全部無反応になり警告音が鳴る |
| 18 | 再生中はステージの上にクリックシールドを敷く | クリックでフォーカスが別オリジンの iframe に落ち、以降キーが届かない |
| 20 | ウィンドウ / webview を触る Rust コマンドは `async fn` | Windows で invoke が WebView2 のイベントハンドラから WebView2 を呼び直し、再入して固まる。再生ボタンでデッキが停止し、キーもマウスも効かなくなる |

**17 と 18 は同じ症状(キーが効かない)を別の原因で起こす。** 片方だけ直しても直らない。
**17 は macOS 固有**で、`focus_presentation_webview` は macOS 以外では意図的に何もしない。
**20 は逆に Windows でしか表に出ない**(macOS は同期コマンドでも動いてしまう)。

## 受け入れ条件（EARS 記法）

- WHEN 再生を開始する THE SYSTEM SHALL 編集中のスライドから全画面で始める
- WHEN ← / → を押す THE SYSTEM SHALL 前後のスライドへ移動する
- WHEN スライドをクリックする THE SYSTEM SHALL 右半分で次へ、左半分で前へ移動する
- WHILE 再生中 THE SYSTEM SHALL キーボードのフォーカスを再生ウィンドウに保つ
- WHEN スライドをクリックした後で → を押す THE SYSTEM SHALL 変わらずページを送る
- WHEN Esc を押す THE SYSTEM SHALL 再生を終了し、**ウィンドウは閉じずに隠す**
- WHEN 2 回目の再生を始める THE SYSTEM SHALL 同じウィンドウを再利用する

## 実装タスク

- [x] 再生ウィンドウの生成と再利用
- [x] simple fullscreen とフォーカスの取り戻し
- [x] クリックシールド
- [ ] 発表者ビュー(ノート・次スライド・タイマー)。未着手
