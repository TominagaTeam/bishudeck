---
feature: welcome-deck
code: src/app/welcome.ts, src/app/welcomeDeck.html, src/app/App.tsx
tests: src/app/welcome.test.ts
status: 実装済み
updated: 2026-08-26
---

# welcome-deck — 機能設計

## 概要

**アプリを起動したとき、使い方を説明するサンプルデッキを開いた状態にする。**
同梱した 1 枚の HTML（11 スライド）を、取り込みと同じパイプラインに通して
プロジェクトとして読み込む。

## なぜ要るか

起動直後の画面には**スライドが 1 枚も無かった**。キャンバスは空、スライド一覧は空、
インスペクタは「要素をクリックすると選択できます」とだけ出る。
**そこから何をすればいいかは、画面のどこにも書いていない。**

このアプリでできることは「デッキを開いて触る」ことなので、
**説明そのものをデッキとして配れば、読むことと試すことが同じ操作になる。**
書いてある文はすべて選べて、動かせて、打ち替えられる —— 説明が例示を兼ねる。

## 責務と境界

**やること**

- 同梱デッキ（`welcomeDeck.html`）を持ち、**空のウィンドウに限って**開く
- 開いた結果を、**取り込んだデッキと見分けのつかない状態**にする
  （書き出し先なし・未変更・履歴なし）

**やらないこと**

- **初回だけ出す / 二度と出さない、といった記憶を持つこと。** 判定材料は
  「いま開いているデッキがあるか」だけ（[decisions.md](decisions.md) #2）
- **自分でファイルを書くこと。** 書き出し先を持たないので、自動保存の対象にならず
  （[persistence](../persistence/design.md)）、終了時にも何も聞かれない
- **専用の取り込み経路を持つこと。** Detector も分割も本番と同じものを通る
- **デッキの中身を i18n カタログに載せること。** カタログは UI 文言のためのもので、
  デッキはドキュメント（[decisions.md](decisions.md) #4）

## どう開くか

```
App の起動エフェクト
  └ initAssetBase()          … slides:// の origin を確定させる
      └ attachBundledFonts() … アプリ窓に同梱書体を張る
      └ openWelcomeDeck()    … ここで初めてデッキを composeできる状態になる
```

**`initAssetBase()` の後に置いてある**のが要点。合成は同期的に走るので、
origin が決まる前に開くと同梱書体の `<link>` が書かれず、ガイドだけが
その環境の既定書体で描かれる（[asset-pipeline](../asset-pipeline/design.md)）。

`openWelcomeDeck()` は**開いているデッキがあれば何もしない**。
StrictMode がマウント時のエフェクトを 2 度走らせるため、**冪等でなければならない**。

## デッキ側の決まり

`welcomeDeck.html` は**普通の HTML デッキ**として書く。エディタ専用の印は 1 つも持たない。

| 決まり | 理由 |
|---|---|
| スライドは `<main class="deck">` 直下の `<section class="slide">` | `generic` Detector が最も高い確度（0.95）で拾う形 |
| 1 スライド = 1280×720 ちょうど | 取り込みが宣言サイズを見つけないときの既定値と一致させる（`DEFAULT_DESIGN_WIDTH/HEIGHT`） |
| `.deck` に padding も gap も置かない | 編集ステージはシェルごと 1 枚を描くので、シェルの余白がそのままステージのずれになる |
| スライドの区切り線は `outline` で描く | `border` はボックスの内側を削り、ステージの端に 1px の線として出てしまう |
| `<script>` を持たない | 編集モードでは JS が動かない（[ADR-0002](../../adr/0002-edit-preview-separation.md)）。動かないと読めないガイドは、最初に開く画面としては成立しない |
| `active` / `current` などの状態クラスを使わない | `detectStageClasses` がデッキの状態クラスと誤認する |

## 受け入れ条件（EARS 記法）

- WHEN 編集ウィンドウが起動し、デッキが 1 つも開かれていない THE SYSTEM SHALL
  同梱デッキを 11 スライドのプロジェクトとして読み込む
- WHEN 同梱デッキを読み込む THE SYSTEM SHALL 書き出し先を持たず、未変更の状態にする
- IF すでにデッキが開かれている THEN THE SYSTEM SHALL 同梱デッキを読み込まない
- IF どの Detector も同梱デッキを拾えない THEN THE SYSTEM SHALL 空のまま起動する
  （起動そのものは失敗させない）
- WHEN ユーザーが自分の HTML を取り込む THE SYSTEM SHALL 同梱デッキを置き換える
  （取り込みの既存経路そのまま）

## 実装タスク

- [x] `welcomeDeck.html`（11 スライド・Claude 配色）を追加する
- [x] `welcome.ts`（`buildWelcomeProject` / `openWelcomeDeck`）を追加する
- [x] `App.tsx` の起動エフェクトから呼ぶ
- [x] 取り込み・往復・冪等の回帰テストを書く（[test.md](test.md)）
- [ ] 手で触って確認する（[test.md](test.md) の `手動` 行）
