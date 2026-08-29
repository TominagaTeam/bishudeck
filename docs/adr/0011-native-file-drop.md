---
name: adr-0011
status: active
updated: 2026-08-26
---

# ADR-0011: ファイルのドロップは Tauri のネイティブハンドラで受ける

- **日付**: 2026-08-26
- **状態**: 採用

## 背景

写真枠に画像をドラッグ&ドロップで入れたい([issues](../issues.md) #100)。
素直に考えれば編集ステージのレイヤに `dragover` / `drop` を張るだけだが、**それは発火しない**。

Tauri v2 の `app.windows[].dragDropEnabled` は**既定で `true`**
(`tauri-utils` の `default_true`)。有効なとき Tauri はネイティブビューにドロップハンドラを登録し、
**そのクロージャは常に「消費した」を返す**(`tauri-runtime-wry` の `lib.rs`)。
wry は消費されたドラッグを OS 既定へ落とさないので、**WebView はドラッグセッションを一切見ない**。

これは macOS でも Windows でも同じで、
公式ドキュメントが「Windows で HTML5 DnD を使うには無効化が必要」としか書いていないのは
**実態より狭い**。macOS は `NSView` の `draggingEntered` 系を override し、
Windows は HWND に `RegisterDragDrop` する、という実装の違いがあるだけで、
**ページに届かない**点は共通する。

つまり選択肢は 2 つしかない。

## 選択肢

1. **`dragDropEnabled: false` にして HTML5 の `drop` を使う** — 普通の Web の書き方ができる。
   ただし受け取れるのは `File` オブジェクトだけで、**Tauri v2 に「`File` → OS のパス」の橋は無い**
2. **`onDragDropEvent` で Tauri から受ける** — `paths`(絶対パス)と座標が取れる。
   代わりに座標がプラットフォームで揃っていない

## 決定

案 2 を採る。`tauri.conf.json` は**触らない**(`dragDropEnabled` は既定の `true` のまま)。

- 購読は `src/shared/backend.ts` の `onFileDrag()` に集約し、
  アプリ側には CSS ピクセルの座標とパスだけを渡す
- 座標のプラットフォーム差もそこで吸収する(下記)

## 理由

**パスが取れるかどうかが決め手。** 既存の取り込み経路は
`import_asset(path)` —— Rust 側がパスを開いてアセットストアへ写す —— で、
ファイル選択ダイアログもこれを通る。案 1 だと `File` を `arrayBuffer()` で読み、
**IPC を JSON の数値配列で往復させる** `put_asset_bytes` に切り替わる。
数 MB の写真でそれをやる理由が無い。

**もう一つは巻き添えの大きさ。** `dragDropEnabled: false` は**ウィンドウ全体の設定**で、
スライド一覧の並べ替え(`features/SlideList.tsx` の HTML5 DnD)にも効く。
Windows では今まで Tauri が握っていたドラッグがページに戻るので、
**触っていない機能の振る舞いが変わる**。しかもその機能は
[issues](../issues.md) #8 / #16 —— ドラッグ中に `pointercancel` が飛ぶ、Windows で移動が止まる ——
の当事者で、Windows 実機での検証も薄い。**1 つの機能のために踏む場所ではない。**

## 座標の扱い

**型はどちらも `PhysicalPosition` なのに、中身の単位が違う。**

| | 出どころ | 実際の単位 |
| --- | --- | --- |
| macOS | `NSDraggingInfo.draggingLocation` と `NSView.frame` | **AppKit のポイント = CSS ピクセル** |
| Windows | `ScreenToClient` | **デバイスピクセル** |

`toLogical(scaleFactor)` を無条件に呼ぶと **Retina で座標が半分**になる。
そこで `toCssPixels(position, platform, ratio)` を純関数として持ち、
**mac はそのまま、他は `devicePixelRatio` で割る**。
座標計算なので単体テストを持つ(`src/shared/fileDrop.test.ts`)。

`scaleFactor()` ではなく `devicePixelRatio` を使うのは、同じ値が同期で読めるため。

## 影響

- **ステージのレイヤに `dragover` / `drop` を書いてはいけない**。書いても発火しない
- ドラッグ中は CSS も効かない(`:hover` も来ない)。「ここに落ちる」の表示は
  **ホスト側のオーバーレイで描く**しかない(不変条件 15 と同じ帰結)
- 再生ウィンドウは `WebviewWindowBuilder` で作るので、この設定は config ではなくコード側にある。
  **両ウィンドウの挙動を揃えたくなったら 2 箇所**を見る必要がある
- 将来 HTML デッキそのものをドロップで取り込むときも、同じ `onFileDrag` に乗る
- **プレビュー中のデッキ自身のドロップ領域も、この設定の下では動かない**。
  #100 の「プレビューでも動かない」にはこの原因も重なっている
  (ただし取り込みが `<image-slot>` のランタイムを捨てている以上、そちらが先に効く)
