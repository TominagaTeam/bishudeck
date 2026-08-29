---
feature: asset-pipeline
code: src/shared/assetBase.ts, src-tauri/src/protocol.rs, src-tauri/src/commands/assets.rs, src-tauri/src/state.rs
tests: src-tauri/src/protocol.rs（`cargo test`）
status: 実装済み
updated: 2026-08-25
---

# asset-pipeline — 機能設計

## 概要

デッキに差し込む画像などのファイルを取り込み、編集中もプレビューでも書き出し後でも
**同じ相対パス `assets/<名前>` で解決できる**ようにする。

## 責務と境界

**やること**

- ローカルファイルの取り込みと連番の命名(`asset_001.png`)
- バイト列をバックエンドで保持し、`slides://.../assets/<名前>` で配信する
- 書き出し時に HTML の隣の `assets/` ディレクトリへ実体を書く
- 編集ステージ用の `<base>` URL を配る

**やらないこと**

- **バイト列をフロントへ渡さない。** フロントが扱うのは生成された名前だけ
- 画像の加工。トリミングは表示の話で、元ファイルは変えない([image-crop](../image-crop/design.md))
- 外部 URL の取り込み。デッキが持っている `https://` の画像はそのまま

## 名前だけがフロントを流れる

取り込みは `import_asset(path) -> String` で、返るのは**名前 1 つ**。
挿入されるマークアップは `<img src="assets/asset_001.png">` で、
これは**素の HTML として書き出しても、そのまま隣の `assets/` を指す**。

エディタ固有の URL スキームを markup に書かないのが要点。
`slides://` を書いてしまうと**書き出した HTML が他のブラウザで壊れる**
([ADR-0001](../../adr/0001-html-as-source-of-truth.md)、不変条件 2)。

## 同じ相対パスを 3 つの文脈で成立させる

`assets/...` は相対パスなので、**何を基準に解決するか**が文脈ごとに違う。

| 文脈 | 基準 | どう与えるか |
|---|---|---|
| 編集ステージ(`srcdoc`) | 基準が無い | `assetBaseUrl()` を `<base>` として差し込む |
| プレビュー / 再生(`slides://`) | 配信元のオリジン | 何もしない。`slides://localhost/assets/x.png` に解決される |
| 書き出した HTML | HTML ファイルの場所 | 何もしない。隣に `assets/` を書く |

**プレビューと書き出しは何もしないで済むのが、この相対パスを選んだ理由。**
手当てが要るのは `srcdoc` の編集ステージだけ。

`assetBaseUrl()` は**起動時に 1 度だけ取って同期で読む**。
ドキュメントの合成はレンダリング中に走るので IPC を待てない。
届く前は base 無しで描くが、それが問題になるのは取り込んだファイルを参照するデッキだけ。

## オリジンはプラットフォームで違う

`slides://localhost`(macOS / Linux)と `http://slides.localhost`(Windows)。
**`base_url()` に集約**してあり、フロントは `previewBaseUrl()` で訊く。

## 上限

`MAX_ASSET_BYTES` = 64 MiB。超えたら取り込まずエラーを返す。
デッキ 1 枚に載せる画像として現実的な上限で、
**バイト列をメモリに持つ設計**(`HashMap<String, Vec<u8>>`)である以上、
青天井にはできない。

## 受け入れ条件（EARS 記法）

- WHEN 画像を取り込む THE SYSTEM SHALL `assets/<名前>` を指す `<img>` を挿入する
- WHEN 編集ステージで見る THE SYSTEM SHALL 取り込んだ画像を表示する
- WHEN プレビューで見る THE SYSTEM SHALL 同じ画像を `slides://` 経由で表示する
- WHEN 書き出す THE SYSTEM SHALL HTML の隣に `assets/` を作って実体を書く
- WHEN 書き出した HTML を別のブラウザで開く THE SYSTEM SHALL 画像を表示する
- IF 64 MiB を超えるファイルを取り込む THEN THE SYSTEM SHALL 取り込まずエラーを返す
- IF 存在しないアセットが要求される THEN THE SYSTEM SHALL 404 を返す

## 実装タスク

- [x] 取り込み・命名・配信・書き出し
- [x] 編集ステージ向けの `<base>`
- [ ] 使われなくなったアセットの掃除。**今は溜まる一方**
- [ ] 取り込んだアセットのプロジェクト間での永続化(今はプロセスのメモリだけ)
