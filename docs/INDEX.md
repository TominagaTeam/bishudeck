---
name: index
updated: 2026-08-29
---

# ドキュメント地図

このファイルは全ドキュメントの入口。**タスクに着手する前に、関連する行のドキュメントを読むこと。**

状態: ✅ active(記入済) / 🚧 draft(TODO 残り) / ⚠️ 要同期(doctor がドリフト検出) / 📋 未文書化 / 📦 archived(廃止)

> **このプロジェクトは `Docs/` ではなく `docs/` を使う。**
> macOS のファイルシステムは case-insensitive で `docs` と `Docs` が同一 inode になるため
> ([ADR-0006](adr/0006-docs-driven-migration.md) 裁定 1)。

## 最初に読むもの

1. [rules/development](rules/development.md) — 開発ルール・作業フロー・**設計上の不変条件 20 項目**
2. [adr/](adr/) の 0001〜0004 — ほとんどの実装判断の根拠。**0005 は保留**(Phase 4 で再検討)、
   0006 / 0007 / 0008 はドキュメント運用と作業フローの裁定
3. [roadmap](roadmap.md) — 今どの Phase にいるか

## 基本設計(全体に関わる決め事)

| ドキュメント | 内容 | 状態 |
|---|---|---|
| [01-overview](basic-design/01-overview.md) | 何をつくるのか・機能要件 F1〜F15・スコープ外 | ✅ |
| [02-concept](basic-design/02-concept.md) | コンセプト・迷ったときの判断軸 | ✅ |
| [03-tech-stack](basic-design/03-tech-stack.md) | 技術スタック・依存の実バージョン | ✅ |
| [04-architecture](basic-design/04-architecture.md) | 全体構成・レイヤ・**再生ウィンドウのライフサイクル** | ✅ |
| [05-directory](basic-design/05-directory.md) | ディレクトリ構造・**配置ルール**・依存方向 | ✅ |
| [06-data-model](basic-design/06-data-model.md) | データモデル(正は `src/core/document/model.ts`)・ファイル形式 | ✅ |
| [07-ui-system](basic-design/07-ui-system.md) | UI レイアウト・ツールバー方針・カラー・アイコン規約 | ✅ |
| [08-test-policy](basic-design/08-test-policy.md) | テスト方針・自動テストの限界と手動確認の範囲 | ✅ |
| [09-glossary](basic-design/09-glossary.md) | 用語集 | ✅ |
| [10-security](basic-design/10-security.md) | sandbox / CSP / オリジン分離 | ✅ |
| [11-extensibility](basic-design/11-extensibility.md) | プラグイン API(Phase 4 の設計。**現状は未実装**) | ✅ |

## 機能設計(機能ごとの詳細)

| 機能 | コード | 状態 |
|---|---|---|
| [import-pipeline](features/import-pipeline/design.md) | `src/import/**`, `src/core/document/compose.ts` | ✅ |
| [editing-engine](features/editing-engine/design.md) | `src/core/{commands,editing,selection}/**`, `src/stage/**` | ✅ |
| [image-crop](features/image-crop/design.md) | `src/core/editing/crop.ts`, `src/stage/{cropGesture.ts,CropOverlay.tsx}` | ✅ |
| [presentation](features/presentation/design.md) | `src/app/Present.tsx`, `src-tauri/src/commands/window.rs` | ✅ |
| [persistence](features/persistence/design.md) | `src/app/autosave.ts`, `src/app/closePrompt.ts`, `src-tauri/src/commands/project.rs` | ✅ |
| [inspector](features/inspector/design.md) | `src/features/{Inspector,TextFormatControls,Field,LiveNumberInput,styleValues}.*` | ✅ |
| [shortcuts](features/shortcuts/design.md) | `src/shared/{shortcuts,platform}.ts`, `src/features/ShortcutHelpDialog.tsx` | ✅ |
| [slide-management](features/slide-management/design.md) | `src/core/commands/slide.ts`, `src/features/SlideList.tsx` | ✅ |
| [fonts](features/fonts/design.md) | `src/shared/{fonts,bundledFonts}.ts`, `src-tauri/src/fonts.rs`, `src-tauri/fonts/` | ✅ |
| [asset-pipeline](features/asset-pipeline/design.md) | `src/shared/assetBase.ts`, `src-tauri/src/{protocol.rs,commands/assets.rs}` | ✅ |
| [i18n](features/i18n/design.md) | `src/shared/i18n/**` | ✅ |
| [theme](features/theme/design.md) | `src/shared/theme.ts`, `src/app/styles.css`(トークン) | ✅ |
| [welcome-deck](features/welcome-deck/design.md) | `src/app/{welcome.ts,welcomeDeck.html}` | ✅ |

**📋 未文書化の行は、次にそのコードを触るときに `_template/` から設計書を作る**
([rules/development](rules/development.md) §3)。2026-08-23 に残っていた 5 件を埋めた
([issues](issues.md) #4)が、その約 1 時間後に足した i18n が地図から漏れていた。
**2026-08-25 に登録し、未文書化はゼロ。同日に i18n の残り 3 ファイルも起こしたので、
全 11 機能が `decisions` / `design` / `flow` / `test` の 4 点セットを持つ**([issues](issues.md) #51)。
**2026-08-26 に足した theme も 4 点セット付きで登録したので、現在 12 機能。**
**同日に足した welcome-deck(起動時に開く同梱ガイド)も 4 点セット付きで登録し、現在 13 機能。**

**再生ウィンドウのライフサイクル(不変条件 16〜18・20)の正は
[04-architecture](basic-design/04-architecture.md) のまま**で、
[features/presentation](features/presentation/design.md) はそこへの索引に徹する
([rules/development](rules/development.md) §3 の対応表に従う)。
**キーの一覧の正は [features/shortcuts](features/shortcuts/design.md)** で、
`editing-engine` は「押されたときに何をするか」だけを持つ。

## ADR(全体レベルの判断ログ)

| 番号 | タイトル | 状態 |
|---|---|---|
| [0001](adr/0001-html-as-source-of-truth.md) | Source of Truth は HTML(DOM)そのもの | 採用 |
| [0002](adr/0002-edit-preview-separation.md) | 編集モードとプレビューモードの分離 | 採用 |
| [0003](adr/0003-all-edits-as-commands.md) | すべての編集操作は Command として実行する | 採用 |
| [0004](adr/0004-style-edits-as-overrides.md) | 位置・スタイル編集は「オーバーライド」として適用する | 採用 |
| [0005](adr/0005-core-features-on-plugin-api.md) | コア機能自体をプラグイン API の上に実装する | **保留**(Phase 4 で再検討) |
| [0006](adr/0006-docs-driven-migration.md) | Docs 駆動開発への移行とドキュメント運用ルールの裁定 | 採用 |
| [0007](adr/0007-issues-md-and-task-file-rule.md) | 既知の課題の置き場を `docs/issues.md` に切り出す | 採用 |
| [0008](adr/0008-handoff-before-docs.md) | 手で触ってもらうまでを最短にする(ブランチ単位・docs はマージ単位) | 採用 |
| [0009](adr/0009-drop-smoke-e2e.md) | smoke E2E を廃止して手動確認に寄せる | 採用 |
| [0010](adr/0010-bundle-two-typefaces.md) | 書体を 2 つだけ同梱し、`slides://` から配る | 採用 |
| [0011](adr/0011-native-file-drop.md) | ファイルのドロップは Tauri のネイティブハンドラで受ける | 採用 |
| [0012](adr/0012-mirror-to-public-repo.md) | 開発は private に残し、リリースごとに公開リポへ写す | 採用 |

## その他

| ドキュメント | 内容 | 状態 |
|---|---|---|
| [rules/development](rules/development.md) | 開発ルール(検証・不変条件・規約・依存基準・セキュリティ・git) | ✅ |
| [roadmap](roadmap.md) | **Phase 進捗の正**・取り下げたもの・主要リスク | ✅ |
| [issues](issues.md) | **既知の課題**(もう起きている負債・妥協・設計書と実装のズレ) | ✅ |
| [ideas](ideas.md) | アイデア置き場(未確定の一時置き場) | ✅ |
| [features/_template](features/_template/) | 機能設計書の雛形 | — |

## 対象外の既存ドキュメント(編集・統合しない)

この設計ドキュメント群の**管轄外**にあるもの。混同・誤編集を避けるため地図には載せる。

| 場所 | 役割 | 扱い |
|---|---|---|
| `README.md` | 利用者・新規開発者向けのセットアップと画面の使い方 | 共存。設計の記述は各章へのリンクに留める |
| `CLAUDE.md` | AI 向けの入口と運用ルール。**ここ(INDEX)を指す** | 共存。ルールの正は `rules/development.md` |
| `samples/` | 動作確認用のデッキ(`generic-deck.html`) | 検証素材 |
| `src/core/document/model.ts` | **データモデルの正** | コードが正。[06-data-model](basic-design/06-data-model.md) は概念レベルの補足 |
