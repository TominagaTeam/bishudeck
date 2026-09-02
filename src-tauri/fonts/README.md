# 同梱書体

`slides://<origin>/fonts/…` で配る書体の実体。**アプリが唯一「どの環境にも必ず在る」と
言い切れる書体**で、既定スタックの先頭がこれ。

| 書体 | 出所 | ライセンス |
|---|---|---|
| Noto Sans | [`@fontsource-variable/noto-sans`](https://www.npmjs.com/package/@fontsource-variable/noto-sans) 5.3.0 | OFL-1.1([LICENSE-noto-sans.txt](./LICENSE-noto-sans.txt)) |
| Noto Sans JP | [`@fontsource-variable/noto-sans-jp`](https://www.npmjs.com/package/@fontsource-variable/noto-sans-jp) 5.3.0 | OFL-1.1([LICENSE-noto-sans-jp.txt](./LICENSE-noto-sans-jp.txt)) |

どちらも **wght 可変軸(100〜900)**。太さは合成ではなく書体自身の値で出る。
Noto Sans はイタリック体も入れてある(Noto Sans JP に真のイタリックは無く、
和文は従来どおりブラウザの合成斜体になる)。

npm の依存にはしていない。**要るのは woff2 と `@font-face` だけ**で、
パッケージを抱えても `node_modules` が 5MB 増えるだけだから。
更新するときは下の手順をもう一度なぞる。

## 取り込み手順(更新するとき)

```bash
npm pack @fontsource-variable/noto-sans@5.3.0 @fontsource-variable/noto-sans-jp@5.3.0
# 展開したうえで
cp <ns>/files/*-wght-normal.woff2 <ns>/files/*-wght-italic.woff2 src-tauri/fonts/
cp <nsjp>/files/*-wght-normal.woff2 src-tauri/fonts/
```

`fonts.css` は 3 つの CSS(`<ns>/wght.css`・`<ns>/wght-italic.css`・`<nsjp>/wght.css`)を
束ねて 3 箇所だけ書き換えたもの。

| 書き換え | なぜ |
|---|---|
| `'Noto Sans Variable'` → `'Noto Sans'`(JP も同様) | スタックに書く名前と一致させる。`Variable` 付きの名前では既定スタックに当たらない |
| `url(./files/x.woff2)` → `url(x.woff2)` | woff2 は `fonts.css` と同じディレクトリに並べて配る |
| `font-display: swap` → `block` | ローカル配信なので待ち時間は無いに等しい。`swap` だと代替書体で 1 度描いてから差し替わり、**その間の実測値でハンドルの位置が決まってしまう** |

`unicode-range` による分割はそのまま残してある。ブラウザは**実際に出てくる文字が
属するサブセットだけ**を取りに来るので、和文 140 ファイル・6MB を丸ごと読むことはない。

## 増やすとき

`src-tauri/fonts/` に置いて `fonts.css` に `@font-face` を足すだけでよい。
Rust 側の一覧は `build.rs` がディレクトリを走査して作るので、コードには触らない。
