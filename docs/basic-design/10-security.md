---
name: security
status: active
updated: 2026-08-21
---

# セキュリティ設計

前提: **取り込んだ HTML は信用しない**。中身は AI か第三者が書いた任意のコードとして扱う。
安全性は「気をつける」ではなく**構成でブラウザに保証させる**([ADR-0002](../adr/0002-edit-preview-separation.md))。

## 層ごとの対策

| 層 | 対策 |
| --- | --- |
| スライド JS | プレビュー iframe は `slides://` **別オリジン** + `sandbox="allow-scripts"` **のみ**。`allow-same-origin` は付けない → Tauri API・`window.__TAURI__` に到達不可 |
| 編集モード | `srcdoc` + `sandbox="allow-same-origin"`(`allow-scripts` **なし**)。スクリプト不実行はブラウザが保証。加えて `<script type>` 書き換えとイベントハンドラ属性の退避を行う |
| メイン WebView | 厳格 CSP(`script-src 'self'`)。スライド HTML 文字列を親 DOM に直接注入しない |
| Tauri capabilities | v2 の capability を最小権限で定義。fs はダイアログ経由 + プロジェクトディレクトリ scope のみ。shell / http は既定不許可 |
| 外部リソース | プレビュー iframe 内でのみ許可(利用者が持ち込んだコンテンツの再現性優先)。取り込みダウンロードは Rust 側で明示操作のみ |

## 入れ替えてはいけない 2 つの組み合わせ

```
編集モード:   srcdoc          + allow-same-origin   (allow-scripts なし)
プレビュー:   slides:// 配信  + allow-scripts       (allow-same-origin なし)
```

**この対角を交換しない。**

- 編集側に `allow-scripts` を足す → 自分で書き換わる DOM を手で編集することになり、編集結果が壊れる
- プレビュー側に `allow-same-origin` を足す → デッキの JS からアプリ本体・Tauri IPC に到達できてしまう

編集側が `allow-same-origin` を持てるのは、`allow-scripts` が無いためスクリプトが動かず、
「親から `contentDocument` を触れるが、中のコードは動かない」状態を作れるから。

## CSP

CSP は `src-tauri/tauri.conf.json` に定義する。`frame-src` に `slides:` が必要。
**緩めるときは理由をこのファイルに残す。**

| いつ | 緩めたところ | 理由 |
|---|---|---|
| 当初 | `frame-src` に `slides:` / `http://slides.localhost` | プレビュー iframe をそのオリジンで開くため |
| 2026-08-25 | `style-src` / `font-src` に同じ 2 つ | 同梱書体を `slides://…/fonts/fonts.css` から読むため([../features/fonts/design.md](../features/fonts/design.md))。**アプリ窓では実際に効いている制限** —— ピッカーは各項目をその書体で描くので、ここが閉じていると窓側だけ書体が当たらない。配るのはアプリ自身のバイト列で、ユーザーの HTML ではない |

**広げたのはこの 2 つのオリジンだけで、`https:` のような開いた指定は足していない。**

## 秘密情報

このアプリでは秘密情報を扱わない。
将来 AI 連携で API キーを持つ場合は、**レンダラに置かず Rust 側で保持する**。

不具合報告用に実 HTML を共有するときは、中身に機密が入っていないか確認する。
