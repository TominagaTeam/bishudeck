---
feature: asset-pipeline
status: active
updated: 2026-08-25
---

# asset-pipeline — テスト設計

方針の正は [basic-design/08-test-policy.md](../../basic-design/08-test-policy.md)。

**この機能は境界をまたぐので、担保も二層になる。**
配信は `cargo test`、見え方は手で確認する。

## テストケース

### `slides://` のルーティング（Rust）

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 1 | rust | WHEN アセットが要求される THE SYSTEM SHALL バイト列と推測した MIME を返す | 実装済み |
| 2 | rust | IF 存在しないアセットが要求される THEN THE SYSTEM SHALL 404 を返す | 実装済み |
| 3 | rust | IF 解釈できないパスが要求される THEN THE SYSTEM SHALL 404 を返す | 実装済み |

実体は `src-tauri/src/protocol.rs` の `#[cfg(test)]`。

**ケース 3 は `/../../etc/passwd` も見ている。** ルーティングが
`["assets", name]` の 2 セグメントにしか一致しないので、
**パスがファイルシステムに触れる経路そのものが無い** — 名前は `HashMap` の
キーとしてしか使われない。これはセキュリティ上の性質なので、
実装を変えるときに真っ先に壊れていないか確かめるところ。

### 見え方（手で確認）

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 4 | 手動 | WHEN 画像を挿入する THE SYSTEM SHALL 編集ステージに表示する | 手で確認 |
| 5 | 手動 | WHEN 書き出す THE SYSTEM SHALL 相対パスのまま書く | 手で確認 |

**ケース 4 は `slides://` が実際に読めているかを見ている。** 取り込み側の unit は
参照の書き換えまでしか見ないので、**画像が出ているかどうかは目で確かめるしかない。**

### 書き出し（Rust）

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 6 | rust | WHEN 書き出す THE SYSTEM SHALL HTML の隣に `assets/` を作って実体を書く | 実装済み |

実体は `src-tauri/src/commands/project.rs::assets_are_written_next_to_the_html`。

### 空白

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 7 | rust | IF 64 MiB を超える THEN THE SYSTEM SHALL 取り込まない | **未実装** |
| 8 | rust | WHEN 名前が衝突する THE SYSTEM SHALL 空きが出るまで番号を進める | **未実装** |

**ケース 8 は `next_asset_name` のループが本当に空きを見つけるかを見る。**
`assets.len() + 1` から始めるので、途中の番号が空いていると
**最初の候補が必ず衝突する**。ループが無ければ上書きになる。
