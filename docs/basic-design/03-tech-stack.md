---
name: tech-stack
status: active
updated: 2026-08-25
---

# 技術スタック

選定理由が重要なものは ADR([../adr/](../adr/))に切り出してここからリンクする。

## 一覧

| レイヤ | 採用技術 | バージョン | 選定理由 / ADR |
|---|---|---|---|
| アプリ基盤 | **Tauri** | v2 | 指定。軽量・Rust バックエンド・カスタムプロトコルでスライド配信可能 |
| 言語(フロント) | **TypeScript** | ~5.8.3 | `strict` 前提。`any` を使わない |
| 言語(バックエンド) | **Rust** | edition 2021 | Tauri の要請 |
| フレームワーク | **React** | ^19.1.0 | エコシステムの広さ。パネル型 UI・プラグイン UI の資産が多い |
| ビルド | **Vite** | ^7.0.4 | 開発サーバがそのまま `npm run tauri dev` の土台になる |
| 状態管理 | **Zustand** | ^5.0.2 | ストアを小さく分割でき、React 外(コマンドエンジン)からも読み書きしやすい |
| スライド描画 | **iframe(モード別に構成を変える)** | — | 本設計の中核。[ADR-0002](../adr/0002-edit-preview-separation.md) |
| HTML パース | ブラウザネイティブ **DOMParser** | — | 実ブラウザと同一のパース結果 = 忠実性の保証。[ADR-0001](../adr/0001-html-as-source-of-truth.md) |
| DB | なし | — | 永続化する形式は HTML だけ。[06-data-model](06-data-model.md) |
| ホスティング | なし(デスクトップアプリ) | — | — |

## 主要ライブラリ・ツール

### フロント(`package.json`)

| 用途 | パッケージ |
|---|---|
| Tauri 連携 | `@tauri-apps/api` v2、`@tauri-apps/plugin-dialog` v2、`@tauri-apps/plugin-opener` v2 |
| ID 生成 | `ulid` ^3.0.0 |
| テスト | `vitest` ^4.1.10、`jsdom` ^29.1.1 |

### Rust(`src-tauri/Cargo.toml`)

| 用途 | crate |
|---|---|
| Tauri 本体 | `tauri` 2、`tauri-plugin-dialog` 2、`tauri-plugin-opener` 2 |
| シリアライズ | `serde` 1(derive)、`serde_json` 1 |
| アセット配信の MIME 判定 | `mime_guess` 2 |
| エラー型 | `thiserror` 2 |

> 旧 `docs/basic-design.md` §2 は Rust 側主要 crate を「serde / **zip** / **tokio** / **notify**」と
> 記載していたが、この 3 つは依存にもコードにも存在しない(2026-08-21 時点)。
> `zip` は同じ文書の §5.2 が「専用のプロジェクト形式(zip コンテナ)は持たない」と明示的に否定しており、
> 構想段階の記述が §2 に残っていたもの。移送にあたり実態に合わせた。
> `CLAUDE.md` の「cargo test(zip 往復・slides:// ルーティング)」という説明も同じ理由で古い。

## このアプリ自身のライセンス

**MIT**([../../LICENSE](../../LICENSE))。著作権者は TominagaTeam。

自分のライセンスを先に決めておかないと、下の「依存を増やす基準」が問う
**「商用配布可能か」を判断する基準がそもそも無い**。依存のライセンスは
自分のライセンスと両立する必要があるので、順序としてこちらが先に要る。

**書体は 2 つだけバンドルする。** Noto Sans と Noto Sans JP を `src-tauri/fonts/` に置き、
`slides://` で配っている([../features/fonts/design.md](../features/fonts/design.md))。
どちらも **OFL-1.1**(MIT の配布物に同梱可。ライセンス本文を同じディレクトリに置いてある)。
合計 6.2MB / 140 ファイルで、実体はバイナリに埋め込まれる。

**以前は「バンドルしない」だった。** 既定の Noto Sans をスタックに書くだけにして、
ライセンスを配布物に持ち込まずに済ませていた —— が、その結果**既定が指す書体が
機械ごとに変わり、ピッカーからも Noto Sans が消えた**。「どの環境でも同じ書体で描く」を
取るなら実体を持つしかなく、2026-08-25 にこちらへ倒した。
**他の書体は今後もバンドルしない。**

## 依存を増やす基準

[../rules/development.md](../rules/development.md) §6 を参照。
現状フロントは React + zustand + Tauri プラグインのみで足りている。

## バージョン・環境の制約

- **Node**: v24.11.0 で動作確認(明示的な固定はしていない)
- **対応 OS**: macOS / Windows / Linux(Tauri がサポートする範囲)
- バージョン番号は `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` の **3 箇所**にある。上げるときは 3 つとも変える

## 導入予定

| 技術 | 用途 | 時期 |
|---|---|---|
| CodeMirror 6 | HTML / CSS 直接編集ビュー | F14 に着手する時点 |
