---
feature: fonts
status: active
updated: 2026-08-25
---

# fonts — テスト設計

方針の正は [basic-design/08-test-policy.md](../../basic-design/08-test-policy.md)。

## テストケース

### 実在判定

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 1 | unit | WHEN 幅が総称と変わらない THE SYSTEM SHALL その書体を「無い」と判定する | 実装済み |
| 2 | unit | WHEN 総称と差が出る THE SYSTEM SHALL 「在る」と判定する | 実装済み |
| 3 | unit | IF 測定値が 0 THEN THE SYSTEM SHALL 判定の根拠にしない | 実装済み |

**ケース 3 は「測れなかった」と「同じ幅だった」の区別。**
レイアウト前など幅が 0 で返る場面があり、それを「一致」と読むと全滅する。

### 候補リストの組み立て

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 4 | unit | IF この機械に無い書体がある THEN THE SYSTEM SHALL 候補に出さない | 実装済み |
| 5 | unit | WHEN 候補を組む THE SYSTEM SHALL 既定スタックを測らずに常に出す | 実装済み |
| 5a | unit | WHEN 何も入っていない機械で候補を組む THE SYSTEM SHALL 既定 + 同梱 2 件だけを出す | 実装済み |
| 5b | unit | WHEN 同梱書体を候補に出す THE SYSTEM SHALL プローブしない | 実装済み |
| 6 | unit | WHEN 同じ書体の macOS 名と Windows 名が両方在る THE SYSTEM SHALL 1 エントリにまとめる | 実装済み |
| 7 | unit | IF 測定手段が無い THEN THE SYSTEM SHALL カタログをそのまま出す | 実装済み |
| 8 | unit | WHEN computed 値を渡す THE SYSTEM SHALL 対応するカタログ項目を返す | 実装済み |
| 9 | unit | IF 提供していない書体を渡す THEN THE SYSTEM SHALL null を返す | 実装済み |

実体は `src/shared/fonts.test.ts`。

**ケース 5a が候補リストの「床」。** ここに並ぶ他の書体は OS のもので、無いこともある。
同梱書体だけは無くならないので、**一覧がいちばん短くなったときの中身**がこれになる。

**ケース 6 は「游ゴシック」が `YuGothic`(macOS)と `Yu Gothic`(Windows)の
2 エントリでカタログに載っていることから来る。** 同じラベルは 1 つに畳み、
**在るほうの `stack` が残る**(Windows だけなら `'Yu Gothic'` が残る)。

**ケース 7 はテストのための分岐ではなく本番の保険。** 測定手段が無い環境で
候補が空になると、書体を一切選べなくなる。

### 既定の名乗り(`firstResolvableFamily`)

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 13 | unit | WHEN スタックの先頭が同梱書体 THE SYSTEM SHALL 測らずにその名前を返す | 実装済み |
| 14 | unit | WHEN 複数が実在する THE SYSTEM SHALL スタックの**前にあるほう**を返す | 実装済み |
| 15 | unit | IF 先頭が無い THEN THE SYSTEM SHALL 次に実在するものへ進む | 実装済み |
| 16 | unit | IF どれも名乗れない THEN THE SYSTEM SHALL undefined を返す(「既定」とだけ出る) | 実装済み |

**ケース 14 はブラウザの順序そのもの。** 一番良いものではなく**先に解決できたもの**が
描かれるので、名乗る側も同じ歩き方をしないと嘘になる。

### 同梱書体の配達

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 17 | unit | WHEN 編集・プレビューを合成する THE SYSTEM SHALL `slides://…/fonts/fonts.css` を差す | 実装済み |
| 18 | unit | WHEN 書き出す THE SYSTEM SHALL その `<link>` を差さない | 実装済み |
| 19 | unit | IF オリジンが分からない THEN THE SYSTEM SHALL 何も差さない | 実装済み |
| 20 | unit | WHEN 差す THE SYSTEM SHALL デッキ自身の head より**前**に置く | 実装済み |
| 21 | unit | WHEN 印付きの `<link>` を含む HTML を取り込む THE SYSTEM SHALL それを落とす | 実装済み |
| 22 | rust | WHEN `/fonts/<name>` を要求する THE SYSTEM SHALL バイト列と正しい MIME を返す | 実装済み |
| 23 | rust | WHEN 同梱書体を返す THE SYSTEM SHALL `Access-Control-Allow-Origin: *` を付ける | 実装済み |
| 24 | rust | WHEN `fonts.css` が参照する URL を全部たどる THE SYSTEM SHALL すべて同梱済みである | 実装済み |

実体は `src/core/document/compose.test.ts` / `src/shared/bundledFonts.test.ts` /
`src/core/document/roundTrip.test.ts` / `src-tauri/src/{fonts,protocol}.rs`。

**ケース 23 がプレビューの生命線。** プレビュー iframe は `allow-same-origin` を持たない
=不透明オリジンなので、ワイルドカード以外の許可では読めない。
**ケース 24 は「CSS には書いてあるが実体が無い」を防ぐ** —— それが起きても
ブラウザは黙って別の書体に落ちるだけで、何も言わない。

### 実環境での見え方(手で確認)

実測も書体の描画も実ブラウザでしか効かない(jsdom はどの文字列も同じ幅で返し、
`@font-face` も読まない)ので、**下の 6 件は起動して目で確かめる。**

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 10 | 手動 | WHEN ピッカーを開く THE SYSTEM SHALL 先頭に `既定(Noto Sans)` を出す | 手で確認 |
| 11 | 手動 | WHEN ピッカーを開く THE SYSTEM SHALL この環境にある欧文書体を出す | 手で確認 |
| 12 | 手動 | IF この環境に無い書体がある THEN THE SYSTEM SHALL 出さない | 手で確認 |
| 25 | 手動 | WHEN Noto Sans を選ぶ THE SYSTEM SHALL 編集ステージで Noto Sans として描く | 手で確認 |
| 26 | 手動 | WHEN 同じスライドをプレビュー / 再生で見る THE SYSTEM SHALL 編集と同じ字形で描く | 手で確認 |
| 27 | 手動 | WHEN 和文を Noto Sans JP で描く THE SYSTEM SHALL ヒラギノとは違う字形になる | 手で確認 |

**ケース 12 は「走っている側に無いはずの書体」で判定する。**
Windows ならヒラギノ、macOS ならメイリオ。
**「在るものが出る」だけを見ると、常に全部出す実装でも通ってしまう** —
落とすべきものが落ちていることを確かめないと意味が無い
([rules/development](../../rules/development.md) §2)。

**ケース 26 が今回いちばん壊れやすいところ。** 編集ステージとプレビューは
オリジンが違い、**プレビューだけ CORS で弾かれても画面は何も言わない** ——
ヒラギノで普通に描かれるだけなので、2 つを並べて字形を見比べるしかない。
和文の見分け方は**「あ」の払いと「ゴ」の濁点**あたりが分かりやすい。
