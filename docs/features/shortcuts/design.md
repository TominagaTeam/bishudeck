---
feature: shortcuts
code: src/shared/{shortcuts,platform}.ts, src/features/ShortcutHelpDialog.tsx
tests: src/shared/shortcuts.test.ts
status: 実装済み
updated: 2026-08-26
---

# shortcuts — 機能設計

## 概要

キーボードショートカットの**定義・日本語ラベル・環境別の表記**を 1 箇所に集め、
ハンドラ・メニュー・コンテキストメニュー・ヘルプ一覧がすべてそこを読む。
利用者から見ると「PowerPoint と同じキーが効く」「効くキーの一覧が上バーから開ける」
「Mac と Windows で正しい表記が出る」の 3 つ。

そこに至る前は、キーの判定が `app/App.tsx` のハンドラに、表記が
`features/arrangeItems.ts` と `features/StageContextMenu.tsx` のベタ書き文字列にあり、
しかも表記は macOS グリフ決め打ちだった。両者は互いを知らないので黙ってずれる。

## 責務と境界

**やること**

- ショートカットのカタログ(id・ラベル・グループ・ストローク・所有ハンドラ)を持つ
- `KeyboardEvent` が特定の id かどうかを判定する(`matchesShortcut`)
- ストロークを環境ごとの文字列に整形する(`formatStroke` / `shortcutHint` / `shortcutKeys`)
- 一覧を表示するモーダル(`ShortcutHelpDialog`)と、上バーの「ヘルプ」メニュー

**やらないこと**

- **キーを押したときに何が起きるかは持たない。** 実行はハンドラ側の責務で、
  **グローバルな窓口は従来どおり 3 つ**(`app/App.tsx` / `stage/EditStage.tsx` / `app/Present.tsx`。
  いずれも `window` の `keydown` を聴く)。カタログは「どのキーか」だけを答える
- **その手前で横取りする箇所が 1 つだけある。** スライド一覧(`features/SlideList.tsx`)は
  `<aside>` の `onKeyDown` で `view.nextSlide` / `view.prevSlide` を判定し、
  `stopPropagation()` で `window` まで流さない。同じ矢印は選択された要素を動かすキーでもあるので
  (`arrange.nudge`)、流すと**スライドを選んでいる最中にステージの要素が動く**。
  窓口の数ではなくフォーカスの位置で決まる話なので、3 つには数えない
  (何が起きるかは下の「キー一覧」)
- **ドラッグ中の修飾キーは持たない。** カタログが答えるのは `KeyboardEvent` の照合で、
  ポインタが押されているあいだの Shift / Alt は `stage/interactions.ts` が
  `event.shiftKey` / `event.altKey` から直に読む。**正は
  [../editing-engine/design.md](../editing-engine/design.md)**(移動は軸固定・リサイズは縦横比固定・
  回転は 15 度刻み・Alt は複製)。ヘルプ一覧にも出ない —— ストロークとして書けないため
- リマップ(利用者によるキー再割り当て)。Phase 4 のプラグイン API の話
- テキスト編集中のキー。編集 iframe はスクリプト無効で、WebKit はその document の
  リスナを発火させないため、ホストからは捕まえられない(decisions #4)

配置は `src/shared/`。`app` / `features` / `stage` の 3 者が読むので、
[05-directory](../../basic-design/05-directory.md) の「依存方向」を満たすのはここだけ。

## インターフェース

```ts
// src/shared/platform.ts
type Platform = 'mac' | 'windows' | 'linux';
function detectPlatform(): Platform;
function classifyPlatform(raw: string): Platform;   // テスト用の純関数

// src/shared/shortcuts.ts
type KeyStyle = 'mac' | 'pc';                       // 表記の系統。linux は pc
interface Stroke { code?; key?; mod?; shift?: boolean | 'either'; alt?; only?; hidden? }
interface ShortcutEntry { id; label; group; strokes; owner; note?; contextual? }

const SHORTCUTS;                                    // as const。id は型になる
type ShortcutId = (typeof SHORTCUTS)[number]['id'];

function matchesShortcut(id: ShortcutId, event: KeyboardEvent): boolean;
function shortcutHint(id, style?): string;          // メニューの <kbd> 用に 1 本
function shortcutKeys(id, style?): string;          // 一覧用に全部
function shortcutsByGroup(style): ShortcutSection[];
function currentKeyStyle(): KeyStyle;
```

`MenuItem` の `shortcut` プロパティは**表記ではなく id を受ける**(`features/Menu.tsx`)。
手書きのグリフは型エラーになる。

### 照合は寛容・表示は厳密

- `mod` は `metaKey || ctrlKey`。macOS で Ctrl を押す癖のある人にも効く
- **ストロークが名指ししない修飾キーは「押されていないこと」を要求する。**
  これが ⌘D(要素の複製)と ⌘⇧D(スライドの追加)を分ける
- `shift: 'either'` は「Shift が意味ではなく**度合い**を変える」キー。矢印は 1px、
  Shift 併用で 10px で、同じショートカット
- `only: 'mac' | 'pc'` は**表示のフィルタにだけ効く**。Ctrl+Y は macOS でも押せば動くが、
  macOS の一覧には出さない
- `hidden` は「照合するが一覧には出さない」別名(テンキーの `NumpadAdd` など)
- `contextual` は「別のエントリと意図的にキーを共有し、ハンドラが文脈で選ぶ」宣言。
  矢印は選択があれば移動、無ければスライド送り。**宣言していない衝突はテストで落ちる**

### `event.code` と `event.key` の使い分け

括弧・数字・マイナス・スラッシュは JIS と US で**同じ物理キーが別の文字を出す**ので `code`
(`BracketRight` / `Digit0` / `Minus` / `Equal` / `Slash`)。それ以外は `key`(大小無視)。

## キー一覧

正はコード(`src/shared/shortcuts.ts`)。ここは読み下し用の要約。

| キー(Mac / Windows) | 動作 | 所有 |
| --- | --- | --- |
| ⌘O / Ctrl+O | HTML を取り込む | App |
| ⌘S / ⇧⌘S | 書き出し / 名前を付けて書き出し | App |
| ⌘Z / ⇧⌘Z(Windows は Ctrl+Y も) | Undo / Redo | App |
| ⌘X / ⌘C / ⌘V | 要素を切り取り / コピー / 貼り付け | App |
| ⌘D | 要素を複製 | App |
| Delete / Backspace | 削除 | App |
| ⌥⌘C ⌥⌘V / Ctrl+⇧C Ctrl+⇧V | 書式をコピー / 貼り付け(**要素**の ⌘C / ⌘V と修飾キー 1 つ違い) | App |
| ⇧⌘] ⌘] ⌘[ ⇧⌘[ | 最前面 / 前面 / 背面 / 最背面 | App |
| 矢印 | 1px 移動(Shift で 10px)。選択が無ければスライド送り。**スライド一覧の中では常にスライド送り** | App |
| ⌘M / ⌘⇧D | スライドを追加(隣を複製) | App |
| Home / End | 先頭 / 末尾のスライドへ | App |
| ⌘0 / ⌘+ / ⌘− | 画面に合わせる / 拡大 / 縮小 | App |
| F5 / ⇧⌘Return | 再生を開始 | App |
| ⌘/ (Windows は F1 も) | ショートカット一覧 | App |
| Tab / ⇧Tab | 次 / 前の兄弟オブジェクトへ | Stage |
| Enter / F2 | テキスト編集を開始 | Stage |
| Esc | ドラッグ取り消し → トリミング終了 → 選択を 1 階層外へ | Stage |
| → ↓ Space PageDown / ← ↑ PageUp / Home / End / Esc | 再生中の操作 | Present |

## ヘルプ一覧の UI

上バー右端(再生ボタンの手前)の「ヘルプ」ボタンで**一手でモーダルが開く**。⌘/ でも開閉できる。
ボタンの `title` にその環境のキー表記を出す(ドロップダウンを挟まないので `<kbd>` の置き場が無い)。

**見出しの下にリード文は置かない。** 以前は「PowerPoint と同じキーに合わせてあります」と出していたが、
実際には PowerPoint に無いキー(⌘/・Tab での兄弟送り)も、PowerPoint と割り当てが違うキー(⌘M)もある。
一覧そのものが答えなので、**当たっていない前置きを足さない**。

- 見出しごとの 2 段組。行は `shortcutsByGroup()` の結果そのまま
- 上部に **Mac / Windows・Linux タブ**。既定は `detectPlatform()`、切替は表示だけの話で、
  設定として保存しない
- **一覧を開いている間、他のショートカットは効かない。** モーダルの裏で編集が進まないようにする
- Escape は capture フェーズで `stopPropagation()`。さもないと同じキーがステージにも届き、
  閉じると同時に選択が 1 階層外へ出る

## 受け入れ条件（EARS 記法）

- WHEN 利用者が上バーの「ヘルプ」を押す THE SYSTEM SHALL 一手でショートカット一覧を開く
- WHEN 利用者が ⌘/(または F1)を押す THE SYSTEM SHALL ショートカット一覧を開く
- WHEN 一覧が開いている状態で編集キーが押される THE SYSTEM SHALL それを無視する
- WHEN 一覧が開いている状態で Escape が押される THE SYSTEM SHALL 一覧だけを閉じ、選択を変えない
- WHEN 利用者が一覧のプラットフォームタブを切り替える THE SYSTEM SHALL その系統の表記に差し替える
- IF 実行環境が macOS THEN THE SYSTEM SHALL 既定で ⌘⌥⇧ の表記を出す
- IF 実行環境が Windows または Linux THEN THE SYSTEM SHALL 既定で `Ctrl+` の表記を出す
- WHEN ⌘M または ⌘⇧D が押される THE SYSTEM SHALL 現在のスライドを複製して 1 枚追加する
- WHEN Home / End が押される THE SYSTEM SHALL 先頭 / 末尾のスライドを表示する
- WHEN F5 または ⇧⌘Return が押される THE SYSTEM SHALL 再生ウィンドウを開く
- WHEN ⌘O が押される THE SYSTEM SHALL HTML の取り込みダイアログを開く
- WHEN ⌘C / ⌘X が押される THE SYSTEM SHALL 選択した要素をクリップボードへ取り、⌥⌘C(書式)と取り違えない
- WHEN 選択が無い状態で ⌘V が押される THE SYSTEM SHALL それでも貼り付けを実行する(貼り付け先は [editing-engine](../editing-engine/design.md))
- WHEN メニューにショートカットが表示される THE SYSTEM SHALL 実行環境の表記で出す
- IF ストロークが名指ししない修飾キーが押されている THEN THE SYSTEM SHALL そのショートカットとして扱わない

## 実装タスク

- [x] `shared/platform.ts`(環境判定)
- [x] `shared/shortcuts.ts`(カタログ・照合・整形)
- [x] `App.tsx` / `EditStage.tsx` / `Present.tsx` を `matchesShortcut` 経由に
- [x] 追加キー(⌘O / F5・⇧⌘Return / ⌘M・⌘⇧D / Home・End / Ctrl+Y / Ctrl+⇧C・V / ⌘/・F1)
- [x] 要素のクリップボード(⌘X / ⌘C / ⌘V)。動作の正は [editing-engine](../editing-engine/design.md)
- [x] `MenuItem` の `shortcut` を id 受け取りに変え、ベタ書きのグリフを撤去
- [x] `ShortcutHelpDialog` と上バーの「ヘルプ」ボタン
- [x] unit(`shortcuts.test.ts`)。キー操作そのものは手動確認([test.md](test.md))
