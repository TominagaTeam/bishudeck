---
feature: i18n
code: src/shared/i18n/**
tests: src/shared/i18n/i18n.test.ts
status: 実装済み
updated: 2026-08-25
---

# i18n — 機能設計

## 概要

UI 文言を**コードから 1 箇所のカタログへ移す**仕組み。
文言はキーで参照し、カタログが言語ごとの文面を持つ。

## なぜ要るか

一般公開を目指すと決めた([01-overview](../../basic-design/01-overview.md))ことで、
**UI 文言がすべて日本語のハードコード**であることが公開範囲の上限になった
([issues](../../issues.md) #15)。文言は `src/features/**` を中心に
**約 322 件が 36 ファイルへ散在**していて、翻訳する以前に**どこに何があるか分からない**。

## 責務と境界

**やること**

- キーから文面を引く `t()` と、言語ごとのカタログ
- 表示言語の決定(OS のロケール → 保存された設定で上書き)
- **キーの型安全**。カタログに無いキーはコンパイルが通らない

**やらないこと**

- **翻訳そのもの**。今回入れるのは日本語カタログだけで、他言語は後からファイルを足す
- 言語切替の UI。土台だけ用意し、画面は別途
- **日付・数値の書式**。`Intl` が既にある
- **デッキの中身の翻訳**。取り込んだ HTML は他人のものなので触らない([ADR-0001](../../adr/0001-html-as-source-of-truth.md))

## 今回入れる範囲

**仕組みと日本語カタログまで。** 言語は日本語 1 つだけで、英語は入れない
([decisions.md](decisions.md) #10)。英語カタログと言語切替 UI は別作業として残る
([issues](../../issues.md) #15、[decisions.md](decisions.md) #15)。

**英語を足すときに、抽出の正しさを裏書きするものはもう無い**
(当時あった smoke は廃止した。[ADR-0009](../../adr/0009-drop-smoke-e2e.md))。
**画面の文言は手で確かめる**([test.md](test.md))。

## 自作する

`i18next` を入れない。要るのは**キーを引くことと補間**だけで、複数形・文脈・名前空間・
遅延読み込みは現状どこにも要らない([rules/development](../../rules/development.md) §6
「数十行で自作できるなら自作する」、[decisions.md](decisions.md) #1)。
仕組みそのものは `index.ts` + `locale.ts` の 110 行で、残りはカタログ。

## キーの形

**ドット区切りのフラットなキー。** ネストした構造ではなく `'toolbar.import'` の形。

```ts
t('toolbar.import')                      // → HTML を取り込む
t('command.pasteFormat')                 // → 書式を貼り付け
t('error.commandFailed', { label: '移動' })  // → 移動 に失敗
```

- **フラットなのは grep で追えるようにするため**([decisions.md](decisions.md) #2)
- 前置きは画面や層で切る(`toolbar` / `inspector` / `dialog` / `menu` / `command` /
  `shortcut` / `font` / `status` / `error` / `stage` / `import`)
- 補間は **`{name}` 形式**。テンプレートリテラルで組み立てない
  ([rules/development](../../rules/development.md) §5)。
  **区切り記号と語尾もカタログの項目にする**([decisions.md](decisions.md) #12)
- 値を渡し忘れた `{name}` は**そのまま残る**([decisions.md](decisions.md) #6)

現在 **252 件**。うち 22 件が `{name}` を持つ。

## `t()` は素の関数で、フックではない

Command のラベル(`readonly label = t('command.editText')`)は「元に戻す」ボタンのツールチップに出る
**UI 文言でありながら `core/` にある**ので、フックでは引けない
([05-directory](../../basic-design/05-directory.md) の依存方向、[decisions.md](decisions.md) #3)。

`t()` は**呼ぶたびカタログを引き直す**(値をモジュール読み込み時に固定しない)ので、
言語が 2 つになったときの切替は再描画で足りる([decisions.md](decisions.md) #4)。
そのぶん **`initLocale()` は render より前**に置く —— ラベルは構築時に確定するため
(経路は [flow.md](flow.md))。

## 表示言語の決め方

1. 保存された設定(`localStorage` の `hse.locale`)があればそれ
2. 無ければ `navigator.language` が `ja` で始まるなら日本語
3. それ以外は**現状も日本語**(他のカタログがまだ無いため)

**カタログのある言語だけを候補にする**([decisions.md](decisions.md) #8)。
ペイン幅と同じ**ワークスペースの好み**なので、書き出す HTML にもプロジェクトにも入らない
([07-ui-system](../../basic-design/07-ui-system.md)、[decisions.md](decisions.md) #7)。
ストレージが読めないときの落ち方は [flow.md](flow.md) の異常系。

## カタログに入れないもの

| 対象 | 何が残るか |
|---|---|
| **書体名**(`ヒラギノ角ゴシック` / `游ゴシック` 等、約 50 件) | `src/shared/fonts.ts` に残る。カタログに入るのはグループ名(`既定` / `日本語` / `欧文`)だけ |
| `PROBE_TEXT`(`WMHIiljmw10あア亜漢`) | `src/shared/fonts.ts` に残る。書体の実在を幅で判定する和欧混在サンプル([fonts](../fonts/design.md)) |
| `TYPING_HEADROOM`(`Aa0あア`) | `src/import/artifact.ts` に残る。サブセット化で 1 script 1 字を確保するサンプル([import-pipeline](../import-pipeline/design.md)) |
| ソースコードのコメント | 元から英語([rules/development](../../rules/development.md) §5)。UI の文面を**引用**しているものは残る |

**理由は「固有名詞か、測定用か」の 2 つ**([decisions.md](decisions.md) #11)。
抽出後、`src/` に残る日本語の文字列リテラルは **17 件**(書体名 15・`PROBE_TEXT`・`TYPING_HEADROOM`)。
数えるときはこれが下限になる。

**空のテキストボックスに描くプレースホルダ**(`stage.textBoxPlaceholder` = `テキストを入力`)は**入れる**。
編集ステージが `::before` で描く chrome なので、保存する markup には一切現れない
([editing-engine/design.md](../editing-engine/design.md))。
markup の中身そのものだった頃の経緯は [decisions.md](decisions.md) #14。

## 受け入れ条件（EARS 記法）

- WHEN キーを渡す THE SYSTEM SHALL 現在の言語の文面を返す
- IF カタログに無いキーを渡す THEN THE SYSTEM SHALL コンパイルを通さない
- WHEN 補間つきのキーを渡す THE SYSTEM SHALL `{name}` を値で置き換える
- IF 値を渡し忘れる THEN THE SYSTEM SHALL プレースホルダをそのまま残す(文面ごと失わない)
- WHEN 日本語環境で起動する THE SYSTEM SHALL 日本語で表示する
- WHILE 画面が出ている THE SYSTEM SHALL キーそのものを表示しない

**最後の 1 つを守るのは型で、テストではない。** `t()` の引数は `MessageKey` なので、
カタログに無いキーはコンパイルが通らない。自動検査を足さなかった経緯は
[decisions.md](decisions.md) #13、手で見る側は [test.md](test.md) #8。

ケースの一覧は [test.md](test.md)、経路と落ち方は [flow.md](flow.md)。

## 実装タスク

- [x] `t()` とカタログ、ロケール解決(`src/shared/i18n/`)
- [x] `core` / `shared` の文言をキーへ
- [x] `features` / `app` / `stage` / `import` の文言をキーへ
- [x] [rules/development](../../rules/development.md) §5 の「UI 文言は日本語」を書き換える
- [ ] 英語カタログ。**別作業**([issues](../../issues.md) #15 で追う)
- [ ] 言語切替 UI。**別作業**
