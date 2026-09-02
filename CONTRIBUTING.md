# コントリビューション

## このリポジトリの成り立ち

**開発は別のリポジトリ（private）で進んでいて、ここはリリースごとの
スナップショットです。** タグを打つたびに、その時点のソースを丸ごと 1 コミットとして
写しています。コミットが `v0.1.0` のような名前ひとつしか無いのはそのためです。

## Pull Request

**送っていただいても、そのままマージすることができません。**
次のリリースで作業ツリーごと上書きされ、消えてしまうためです。

かわりに、内容を開発リポジトリ側で取り込み直します。取り込んだものは次のリリースで
ここに現れます。**変更が失われるわけではありませんが、コミットの作者としてお名前が
残りません。** いまの構成ではそうなってしまうので、先に断っておきます。

大きめの変更を考えているときは、**先に Issue で相談**してもらえると無駄が少なく済みます。

## Issue

歓迎します。特にありがたいのは **うまく取り込めなかったデッキの HTML** です。
このアプリは他人が書いた HTML を開くツールなので、厄介なパターンは実物にしか
出てきません。ただし **中身に機密が入っていないか確認**してから貼ってください。

- **不具合** — 再現手順、OS とバージョン、できれば再現する最小の HTML
- **提案** — 何に困っているかを先に。解決策の案はその後で

## セキュリティ

脆弱性は **Issue に書かないでください。** [SECURITY.md](SECURITY.md) の手順で
非公開に報告できます。

## 開発について

手元で動かす手順は [README](README.md) の「動かす」にあります。
設計ドキュメントは開発リポジトリ側にあり、このリポジトリには入っていません。

---

*Development happens in a private repository; this repo is a per-release snapshot.
Pull requests can't be merged directly — we re-apply them upstream and they appear
in the next release, though your name won't remain as the commit author. Issues are
very welcome, especially decks that fail to import. Please report security issues
via [SECURITY.md](SECURITY.md), not public issues.*
