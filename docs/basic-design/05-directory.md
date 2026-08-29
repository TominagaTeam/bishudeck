---
name: directory
status: active
updated: 2026-08-25
---

# ディレクトリ構造

## 構造(2026-08-25 時点の実態)

```
project/
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs / lib.rs
│  │  ├─ error.rs           # エラー型(thiserror)
│  │  ├─ state.rs           # アプリ状態(アセットストア等)
│  │  ├─ protocol.rs        # slides:// カスタムプロトコル
│  │  ├─ commands/          # project.rs / assets.rs / preview.rs / window.rs
│  │  └─ fonts.rs           # 同梱書体(build.rs が埋め込み表を生成)
│  ├─ fonts/                # Noto Sans / Noto Sans JP の実体 + ライセンス
│  ├─ capabilities/
│  └─ tauri.conf.json
├─ src/
│  ├─ app/                  # App Shell / Present(再生ウィンドウ)/ 自動保存 / 終了確認
│  ├─ core/
│  │  ├─ document/          # モデル型 / DocumentStore / 合成(compose)
│  │  ├─ commands/          # CommandEngine / History / 標準 Command 群 / スナップショット
│  │  ├─ editing/           # 要素操作(整列・複製・削除)/ リッチテキスト / 図形 / トリミング
│  │  ├─ selection/         # 選択状態
│  │  └─ events/            # EventBus(プラグインの観測点)
│  ├─ stage/                # StageBridge / 編集・プレビュー iframe / Overlay / 座標系 / ジェスチャ群 / 受け渡しストア
│  ├─ import/               # パイプライン / detectors/ / Artifacts 展開
│  ├─ features/             # Toolbar / SlideList / PaneDivider / Inspector / StatusBar / 各種ダイアログ
│  └─ shared/               # バックエンド境界(backend.ts)/ フォントカタログ / ID 生成 / i18n(UI 文言カタログ)
├─ samples/                 # 動作確認用のデッキ
└─ docs/                    # 設計ドキュメント(このディレクトリ)
```

## 配置ルール

新しいファイルはここに従って置く。

| 種類 | 場所 |
|---|---|
| ドキュメントモデル・ストア・合成 | `src/core/document/` |
| コマンドと履歴 | `src/core/commands/` |
| 要素操作(整列・複製・削除・トリミング等) | `src/core/editing/` |
| 選択状態 | `src/core/selection/` |
| イベントバス(プラグインの観測点) | `src/core/events/` |
| ステージ(iframe ブリッジ・ジェスチャ・オーバーレイ) | `src/stage/` |
| 取り込みパイプラインと Detector | `src/import/` |
| 画面部品(ツールバー・一覧・インスペクタ等) | `src/features/` |
| アプリシェル・ファイル操作・自動保存 | `src/app/` |
| フロントに同梱するコンテンツ(起動時のガイドデッキ) | 読む側の隣。`src/app/welcomeDeck.html` を `?raw` で読む([welcome-deck](../features/welcome-deck/decisions.md) #7) |
| バックエンド境界・共有ユーティリティ | `src/shared/` |
| UI 文言のカタログ | `src/shared/i18n/` |
| Tauri コマンド | `src-tauri/src/commands/` |
| 同梱するアセット(書体など) | `src-tauri/<種類>/` + `slides://` のルート 1 本 |
| カスタムプロトコル | `src-tauri/src/protocol.rs` |
| 状態を持つストア(zustand) | **読み手で決まる**(下の「ストアの置き場」) |
| テスト | **対象と同じ階層に `*.test.ts`** |

### ストアの置き場

**その状態を読むのが誰か**で決める。読み手が 1 レイヤならそのレイヤ、
またがるなら**読み手全員が import できる側**に置く。
書く側は上のレイヤからでも呼べるが、読み手より上に置くと依存が逆流する。

- **デッキと編集そのものの状態** — ドキュメント・選択・履歴・開いているテキスト /
  トリミングのセッション。`app` / `features` / `stage` のどこからも読むので `src/core/` の主題別へ。
  React に依存させない(「依存方向」)
- **ウィンドウと作業環境の状態** — モード・表示中のスライド・ペイン幅・トースト、および
  取り込みや終了確認のような**一度きりのやり取り**。読むのは `app` と `features` だけなので `src/app/`
- **ステージと画面部品のあいだの受け渡し** — 右クリックの対象・テキスト編集の要求。
  `features → stage` の向きを保つため `src/stage/`(逆向きに置くとコールバックを渡すしかなくなる)
- **読むのが 1 コンポーネントだけ**なら、そのコンポーネントのファイルに `export` せず置く。
  `useState` にしない理由(再マウントをまたいで残したい等)はコメントに書く

2026-08-25 時点の 12 個はこの基準どおりに並んでいる
(`src/core/` 6・`src/app/` 3・`src/stage/` 2・`src/features/` 1)。

## 依存方向

`app / features → core ↔ stage`。`shared` は縦の並びの外にある横断層で、どの層から呼んでもよい。
App Shell の中はさらに `features → app`。取り込みはその横に立つ独立した層で、
向きは `app / features → import → core / shared`
(全体の絵と、なぜ取り込みを App Shell の一部にしないかは
[04-architecture](04-architecture.md) の「レイヤ構成・依存の方向」)。

- **`features` → `app` は許す。逆に `app` の状態が `features` を名指ししない** ——
  `features` の 10 ファイルが `app/uiStore` / `app/importStore` / `app/closePrompt` /
  `app/actions` を読む一方、`uiStore` がインスペクタのパネル ID を素の `string` で持っているのは、
  `PanelId` を import すると向きが反転するため(`src/app/uiStore.ts:79`)。
  画面部品を並べる `app/App.tsx` だけは別で、composition root として `features` を組み立てる
- **`core` と `stage` は双方向。ここだけは一方向に積めない** —— `stage → core` が 24 本、
  `core → stage` が 7 本(値 4・型のみ 3)。不変条件 7「**iframe の DOM に触るのは StageBridge だけ**」
  ([rules/development.md](../rules/development.md) §4)がある以上、`core` は自前の DOM 層を持てない。
  要素の測定と transform の読み書きは `stage/geometry.ts` にしか置けず、Command が `StageBridge` を
  名指しするのは [ADR-0003](../adr/0003-all-edits-as-commands.md) の構造そのもの。
  インスペクタの数値欄が `core/editing/geometry.ts` にあるのも
  「ステージと履歴に触るので UI ファイルには置けない」からで、
  `stage/geometry.ts` はその read 側の相方(同ファイル冒頭のコメント)
- **座標まわりを足すなら `stage/geometry.ts`**。ここには要素を測る関数
  (`boxOf` / `readTransform` / `writeTransform`)と DOM に触らない計算
  (`boundsOf` / `unionBounds` / `resizeKeepingAnchor` / `rotateVector` / `round`)が同居していて、
  `core` はその両方を使う。`core` 側に同じものを作らない
- **`import` は `app` / `features` / `stage` に依存しない**。取り込みを起動するのは
  `app/actions.ts` の `importHtml` だが、`src/import` の中から参照してよいのは
  `core/document` と `shared` まで。Detector を足すときも同じ
- **`core` から `import` へは戻さない**。`core/document/compose.ts` は往復の相方でも
  `src/import` を import しない(`core` / `stage` から参照しているのはテストだけ)
- **`core` は React に依存しない**(UI 差し替え・テスト容易性のため)
- **1 ファイル 1 責務**。ステージ・コマンド・UI の役割をまたがせない

## 未実装(計画)

| ディレクトリ | 用途 | 時期 |
|---|---|---|
| `src/plugins/host/` | Plugin Host(`HseAPI` 実装) | Phase 4 |
| `src/plugins/builtin/` | select-tool / text-tool / inspector / exporters | Phase 4 |

この 2 つはまだ存在しない。[ADR-0005](../adr/0005-core-features-on-plugin-api.md) は**「保留」**で、
再検討は [roadmap](../roadmap.md#phase4) の **Phase 4**。受け皿の設計は [11-extensibility.md](11-extensibility.md)。
