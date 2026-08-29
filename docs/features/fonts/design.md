---
feature: fonts
code: src/shared/fonts.ts, src/shared/bundledFonts.ts, src-tauri/src/fonts.rs
tests: src/shared/fonts.test.ts, src/shared/bundledFonts.test.ts
status: 実装済み
updated: 2026-08-25
---

# fonts — 機能設計

## 概要

書体ピッカーに出す候補を決める。**カタログは macOS と Windows の書体を並べて持ち、
この機械に実在するものだけを出す**。ただし **Noto Sans / Noto Sans JP の 2 つはアプリが
同梱している**ので、この 2 つだけは機械に何が入っていようと必ず出る。既定はこの Noto Sans。

## 責務と境界

**やること**

- 候補カタログ(`FONT_CATALOG`)を持つ
- **実測で**この環境に書体があるかを判定する
- 既定スタック(`DEFAULT_FONT_STACK`)を提供する
- **同梱書体を配る** — `slides://<origin>/fonts/…` の URL を組み、
  スライドを描く 3 つの文書(アプリ窓・編集 iframe・プレビュー iframe)に `@font-face` を届ける

**やらないこと**

- 書体の適用。[inspector](../inspector/design.md) / `richText.ts` の担当
- **書き出した HTML への埋め込み。** 同梱書体は編集中の 3 面だけ。書き出したファイルは
  `font-family` に名前を書くだけで、開いた先のシステム書体に落ちる(後述)
- Web フォントの読み込み。デッキが自分で `@font-face` を持っているのは触らない

## 無い書体は「グレーアウト」ではなく「出さない」

同じデッキが macOS と Windows の両方で編集される。**無い書体を出すと、
ブラウザが黙って別の書体に差し替え、次の機械で見た目が変わる** — しかも
何も警告されない。だから候補から消す。

グレーアウトにしないのは、「選べないが在る」と「そもそも無い」を
ユーザーが区別できないため。**選べないものを見せる理由が無い。**

## 判定は「訊く」のではなく「測る」

`document.fonts.check()` は **`@font-face` で登録された書体**について答える API で、
このカタログが並べている**ローカルにインストールされた書体**については何も言わない。

代わりに、プローブ文字列を 2 通りの `font-family` で描いて**幅を比べる**。

| 定数 | 値 | なぜ |
|---|---|---|
| `PROBE_TEXT` | `WMHIiljmw10あア亜漢` | 和欧混在・字幅もばらばら。書体が変われば長さが動く |
| `PROBE_SIZE_PX` | 72 | 1% の差でも epsilon を超える大きさ |
| `WIDTH_EPSILON` | 0.5px | サブピクセルの揺れは差ではない |
| `GENERIC_BASELINES` | monospace / serif / sans-serif の 3 つ | **1 つでは足りない**(下記) |

**3 つの総称と比べるのが要点。** macOS では `sans-serif` 自体が日本語ゴシックなので、
和文の書体を `sans-serif` とだけ比べると幅が一致し、**在るのに「無い」と判定される**。

## 同梱書体 —— 測らないのは、測るのが**間違い**だから

Noto Sans と Noto Sans JP は `src-tauri/fonts/` に実体を持ち、
[README](../../../src-tauri/fonts/README.md) のとおり Fontsource から取り込んである
(どちらも OFL-1.1、wght 可変軸)。この 2 つだけプローブしない。

**手心ではなく、プローブがここでは誤答するから。** 実測はアプリ窓の canvas で行うが、
同梱書体が `@font-face` として登録されるのは**スライドを描く文書のほう**。
ステージで完璧に描ける書体が、測る側からは「無い」と見える。
そもそもプローブが答えるのは「この機械に入っているか」で、
同梱書体についてはその問いがアプリを起動する前に決着している。

`FONT_CATALOG` の `bundled: true` がその印。`probe` は名前として残っているが、
問いには使わない。

## なぜ `slides://` から配るのか

**フロント側に置くと、プレビューだけが読めない。**

| 文書 | オリジン | 同梱書体の取得 |
|---|---|---|
| アプリ窓 | `tauri://localhost` | ピッカーの各項目をその書体で描くので必要 |
| 編集ステージ(`srcdoc`) | 親と同一(`allow-same-origin`) | スライドの描画に必要 |
| プレビュー / 再生(`slides://`) | **不透明**(`allow-same-origin` 無し) | 同上 |

Tauri がフロントのファイルに付ける `Access-Control-Allow-Origin` は
**ウィンドウのオリジンそのもの**(`tauri-2.11.5/src/protocol/tauri.rs`)。
不透明オリジンはこれに一致しないので、`public/` に置いた woff2 は
**編集中は読めて、プレビューだけ黙って落ちる** —— 同じスライドの 2 つの見え方がずれる。

`slides://` の応答は前から `Access-Control-Allow-Origin: *`
(`src-tauri/src/protocol.rs`)。だから **1 本の URL で 3 面ぶん足りる**。
Rust 側は名前を受けてバイト列を返すだけで、取り込んだ画像と同じ扱い
(不変条件「Rust は HTML を解釈しない」に触れない)。

**`fonts.css` と woff2 だけは長期キャッシュする。** このスキームで配る他のものは
編集のたびに publish し直すが、同梱書体はアプリをビルドし直さない限り変わらない。
`unicode-range` を含む 100KB の CSS を 1 打鍵ごとに読み直させないため。

## 書き出したファイルには入れない

`<link>` を差すのは `mode` が `edit` / `preview` のときだけ
(`core/document/compose.ts`)。書き出した HTML はこのアプリが無い場所で開かれ、
`slides://` はそこでは何も指さない。**書き出したデッキは `font-family` に
名前を書くだけ**で、開いた先に Noto Sans が無ければ後続のシステム書体に落ちる ——
同梱前と同じ振る舞い。だから `DEFAULT_FONT_STACK` の後ろのヒラギノ・游ゴシックは
いまも意味がある。

差し込む位置は**デッキ自身の head より前**。`@font-face` は後勝ちなので、
デッキが同じ名前で自分の Web フォントを宣言していればそちらが勝つ。

## 既定はスタックであって、書体名ではない

`DEFAULT_FONT_STACK` の先頭が Noto Sans なのは、**ラテンと日本語を同じデザインで覆う
唯一の書体**だから。

以前はこの 1 件だけプローブを免除して(`probe: null`)、**名前をそのまま「Noto Sans」と
出していた**。それは「この環境に無い書体は出さない」に対する例外で、
実際この Mac に Noto Sans は入っておらず、選ぶと**ヒラギノで描かれていた** ——
**一覧の先頭だけが、当たらない名前を名乗っていた。**

そこで既定の項目を**実測で名乗る**ようにした。スタックの中の名前付き書体を順に測り、
**最初に在るもの**が実際に当たる書体なので、それを括弧で添える。
閉じた `<select>` には optgroup の「既定」が出ないので、
**この 1 行だけで既定だと分かる必要がある**。

**同梱した今、その名前は常に `既定(Noto Sans)` になる。**
名乗りが正しくなったのは、判定を緩めたからではなく**主張が本当になったから**で、
歩く処理(`firstResolvableFamily`)はそのまま残してある —— スタックの先頭を
同梱していない書体に変えた瞬間、また実測が効く。

## 受け入れ条件（EARS 記法）

- WHEN ピッカーを開く THE SYSTEM SHALL 既定のスタックを常に出し、**実際に当たる書体の名前を添える**
- WHEN ピッカーを開く THE SYSTEM SHALL 同梱書体(Noto Sans / Noto Sans JP)を測らずに常に出す
- IF 当たる書体を測れない THEN THE SYSTEM SHALL 名前を添えずに「既定」とだけ出す
- WHEN ピッカーを開く THE SYSTEM SHALL この環境にある書体だけを出す
- IF この環境に無い書体がある THEN THE SYSTEM SHALL 候補に出さない
- WHEN 和文書体を判定する THE SYSTEM SHALL 3 つの総称すべてと比べる
- WHEN 編集ステージ・プレビューを描く THE SYSTEM SHALL 同梱書体の `@font-face` を届ける
- WHEN 書き出す THE SYSTEM SHALL 同梱書体への参照を残さない

## 実装タスク

- [x] カタログと実測プローブ
- [x] 3 総称との比較
- [x] Noto Sans / Noto Sans JP の同梱と `slides://` 配信
- [ ] デッキ自身が使っている書体をカタログの先頭に出す。未着手
