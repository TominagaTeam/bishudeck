---
feature: theme
code: src/shared/theme.ts, src/app/styles.css, src/app/uiStore.ts, src/features/StatusBar.tsx
tests: src/shared/theme.test.ts
status: 実装済み
updated: 2026-08-26
---

# theme — 機能設計

## 概要

**アプリ自身の chrome の配色**を選べるようにする。ライト(既定)/ ダーク / システム追従の 3 つ。
切り替え口はステータスバーの右、ズームの隣。

## なぜ要るか

初回コミットから chrome は暗色 1 つだけだった。編集対象のスライドはほぼ白なので、
**明るいスライドを暗いアプリの中で見る**構図が固定されていた。
明るい部屋・明るいスライドに合わせられる配色を足す。

## 責務と境界

**やること**

- chrome の配色トークンを 2 セット持ち、片方を document に適用する
- 好み(`system` / `light` / `dark`)を保存し、次の起動で復元する
- `system` を選んでいる間、OS の外観に追従する

**やらないこと**

- **スライドの見た目に触ること**。取り込んだ HTML は他人のもので、
  アプリの配色設定で見え方が変わってはいけない([ADR-0001](../../adr/0001-html-as-source-of-truth.md)、
  [rules/development](../../rules/development.md) §4 不変条件 2)
- **ステージのオーバーレイの配色**。選択枠・ハンドル・トリミング・吸着ガイドは
  **スライドの地色に対して**読めるように決めてあり、ウィンドウの明暗とは無関係([decisions.md](decisions.md) #3)
- **再生ウィンドウ**。`.present` の黒は投影のための黒で、chrome ではない
- **任意の色を選ばせること**。2 つの完成した配色があれば足りる

## 3 つの選択肢と既定

| 値 | 意味 |
|---|---|
| `system` | OS の外観に追従する。開いている間の変更にも追いつく |
| `light` | **既定。** 保存された好みが無いときはこれ |
| `dark` | 2026-08-26 まで唯一だった配色。同日の配色刷新で寒色側へ寄せ、値を入れ替えた([decisions.md](decisions.md) #9) |

**既定は `light` で、`system` ではない。** スライドが白いので、既定のアプリも白い方が
編集対象と地続きになる。OS 追従は**選べばできる**が、**選ばなければ与えられない**
([decisions.md](decisions.md) #1)。表示言語(`i18n/locale.ts`)が
「保存された設定 → OS の設定 → 既定」なのに対し、こちらは
**「保存された設定 → 既定」**で、OS は 3 つ目の選択肢として並ぶだけ。

## 属性には解決済みの配色しか出さない

`shared/theme.ts` が `<html data-theme>` に書くのは **`light` か `dark` だけ**で、
`system` は書かない。`system` のまま渡すと、スタイルシートに

```css
:root[data-theme='dark'] { /* 20 個のトークン */ }
@media (prefers-color-scheme: dark) {
  :root[data-theme='system'] { /* 同じ 20 個 */ }
}
```

と**同じ配色を 2 回**書くことになる。カスタムプロパティはメディアクエリを跨いで
まとめられないので、これは必ず二重管理になる([decisions.md](decisions.md) #2)。
解決を JS 側に置けば、スタイルシートは**配色 1 つにつき 1 ブロック**で済む。

## テーマが動かすもの

`src/app/styles.css` 冒頭の 2 ブロックが配色のすべて。**`:root` がライト**、
**`:root[data-theme='dark']` が動く分だけを上書き**する。

| トークン | 役割 | ライト | ダーク |
|---|---|---|---|
| `--bg` | ウィンドウの地 | `#eef0f4` | `#16181c` |
| `--panel` | ペイン・モーダルの面 | `#f9fafb` | `#1d2025` |
| `--panel-alt` | 一段沈んだ面・ボタンの地 | `#ecedf1` | `#24272d` |
| `--border` | ヘアライン | `#dcdfe6` | `#32363e` |
| `--text` / `--text-dim` | 文字 / 減光した文字 | `#14161b` / `#616875` | `#e6e8ec` / `#949aa6` |
| `--danger` | 破壊的な操作・エラー | `#c8332f` | `#ff5c5c` |
| `--hover-fill` / `--press-fill` | フラットなボタンが借りる塗り | 黒 5.5% / 11% | 白 7% / 12% |
| `--canvas-bg` | **スライドの周りの余白** | `#ccd1d9` | `#0c0d10` |
| `--sunken` | セグメンテッドコントロールの窪み | 黒 5% | 黒 24% |
| `--sheen` | 持ち上がった上端に乗る光(**ポップオーバーだけ**) | 白 70% | 白 4% |
| `--swatch-border` | 色見本の輪郭 | 黒 20% | 白 25% |
| `--scrim` | モーダルが敷く暗幕 | 黒 35% | 黒 60% |
| `--shadow-raise` / `--shadow-pop` / `--shadow-stage` | 影 3 種 | 薄い | 濃い |
| `--accent-fill` | **面として塗る**アクセント | `#2563eb` | `#3884ff` |
| `--brand` / `--brand-hover` | **再生ボタン**の地 | `#16181d` / `#2a2d35` | `#f2f4f7` / `#ffffff` |
| `--on-brand` | `--brand` の塗りに乗る文字 | `#fff` | `#16181d` |
| `color-scheme` | スクロールバー・ネイティブ UI | `light` | `dark` |

**`--canvas-bg` は両方で `--bg` より暗い。** キャンバスはスライドが落ちている井戸で、
白いスライドには縁が要る。

**ライトの `--panel` は `#fff` ではない。** 純白のペインは白いスライドと同じ明度で並び、
chrome が編集対象と明るさを取り合う。`--panel` を一段落として `--canvas-bg` を深くしたことで、
**画面で一番明るいものがスライドそのもの**になる([decisions.md](decisions.md) #9)。

**`--sheen` の消費者はポップオーバー 1 箇所だけ。** ツールバーは以前
`linear-gradient(--panel-alt, --panel)` + 上端の内側光でリボンらしさを出していたが、
下のヘアラインだけで十分に「バー」と読めるうえ、淡い配色では光が面を濁らせるので平らにした。

## テーマが動かさないもの

**どちらの配色でも同じ値**のまま。理由はどれも「スライドの上に描くから」。

| 対象 | 値 | なぜ動かさないか |
|---|---|---|
| `--accent` | `#3884ff` | **「いま選ばれている」の色**。`.overlay-selection` / `.overlay-handle` / `.overlay-rotate` / `.overlay-focus` がスライドの上に描く。アプリの設定で選択枠の色が変わるのはおかしい |
| `--on-accent` | `#fff` | `--accent-fill` の塗りに乗る文字。**塗りが両配色で同じ**なので、`--text` に従わせてはいけない。`--brand` の塗りは動くので、そちらは `--on-brand` を持つ |
| `--dirty` | `#e0a11b` | 書き出しボタンに付く未保存のドット。**`--brand` から切り離した** —— brand は片方でインク・もう片方でほぼ白になり、どちらも「未処理のものがある」とは読めない |
| `.stage-surface` / `.thumb` の背景 | `#fff` | **スライドそのもの**の地。ライトでサムネイルの輪郭が消えるので、`--border` の 1px だけ chrome 側から足した([decisions.md](decisions.md) #7) |
| `.overlay-crop-*` の白 / `#14161a` | — | トリミングの枠。「淡いスライドにも濃いスライドにも読める」ために 2 色使っている |
| `.overlay-guide` の `#ff3d81` | — | 吸着ガイド。青(選択)と赤(brand)のどちらとも違う必要がある |
| `.present` の `#000` | — | 投影のための黒 |

## 線の青と、面の青を分ける

`--accent`(`#3884ff`)は**線として**使う分には両配色で問題ないが、
**面として塗ると**ライトでは白文字とのコントラストが **3.6:1** しか出ない
(実測。`.modal-actions .primary` と `button.active`)。
そこで**塗り専用の `--accent-fill`** を分けた。ライトでは `#2563eb`(**5.2:1**)、
ダークでは `#3884ff` のまま —— **ダークの見た目は 1px も変えない**([decisions.md](decisions.md) #4)。

`--accent` を使い続けるのは、**線・枠・アウトライン・文字色**として使っている 19 箇所。
分岐の基準は「スライドの上に出るか」ではなく「**塗りつぶすか**」で、
塗りつぶす 2 箇所だけが `--accent-fill` を取る。

## 好みの置き場所

`localStorage` の **`hse.theme`**。ペイン幅(`hse.slideListPane`)や表示言語(`hse.locale`)と
同じ**ワークスペースの好み**なので、プロジェクトファイルにも書き出す HTML にも入らない
([07-ui-system](../../basic-design/07-ui-system.md))。

**ペイン幅と違って debounce を通さない。** 幅はドラッグで毎フレーム届くが、
テーマは選択 1 回につき 1 回で、しかも**次のフレームまでに document へ出ていないといけない**
([decisions.md](decisions.md) #6)。

## 切り替え口

**ステータスバーの右、ズームの左**(スロット 6。ズームが 7 で右端のまま)。
テーマもズームも「デッキではなくワークスペースの見え方」の設定で、
**どちらもコマンドではない**のでツールバーには置かない([decisions.md](decisions.md) #5)。
並びの正は [07-ui-system](../../basic-design/07-ui-system.md) の表。

## 受け入れ条件（EARS 記法）

- WHEN 好みを保存したことがない状態で起動する THE SYSTEM SHALL ライトで描く
- WHEN テーマを選ぶ THE SYSTEM SHALL その場で描き替え、次の起動でも同じ配色で開く
- IF `system` が選ばれている THEN THE SYSTEM SHALL OS の外観に合わせる
- WHILE `system` が選ばれている THE SYSTEM SHALL 起動中の OS の外観変更にも追従する
- WHEN 配色を切り替える THE SYSTEM SHALL スライドの見た目・選択枠・ハンドル・再生画面を変えない
- IF 保存された値が 3 つのいずれでもない THEN THE SYSTEM SHALL それを捨ててライトで描く

ケースの一覧は [test.md](test.md)、経路と落ち方は [flow.md](flow.md)。

## 実装タスク

- [x] `shared/theme.ts`(解決・保存・適用・OS 監視)
- [x] `styles.css` のトークンを 2 セットに割り、chrome 側の色リテラルを回収する
- [x] `uiStore` に好みを持たせ、ステータスバーから切り替える
- [x] `--accent-fill` を分ける
- [x] **実 OS での追従確認**(`system` を選んで macOS の外観を切り替える。2026-08-26 に手で確認)。
      **自動検証できない** —— CDP のカラースキームエミュレーションは `matches` を変えるが
      `change` を発火しないため([test.md](test.md))
