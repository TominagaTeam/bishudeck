---
feature: presentation
status: active
updated: 2026-08-25
---

# presentation — テスト設計

方針の正は [basic-design/08-test-policy.md](../../basic-design/08-test-policy.md)。

## テストケース

**この機能に自動テストは 1 件も無い。** 再生はページ遷移・実フォーカス・実キー入力の塊で、
jsdom では何も言えない。受け皿だった E2E を廃止した([ADR-0009](../../adr/0009-drop-smoke-e2e.md))ので、
**下の 6 件はすべて手で確認する。**

| # | 種別 | ケース(EARS 形式) | 状態 |
|---|---|---|---|
| 1 | 手動 | WHEN 開始位置を指定して再生する THE SYSTEM SHALL そのスライドから始める | 手で確認 |
| 2 | 手動 | WHILE 再生中 THE SYSTEM SHALL キーボードのフォーカスを再生ウィンドウに保つ | 手で確認 |
| 3 | 手動 | WHEN ← / → を押す THE SYSTEM SHALL 前後のスライドへ移動する | 手で確認 |
| 4 | 手動 | WHEN スライドをクリックする THE SYSTEM SHALL ページを送る | 手で確認 |
| 5 | 手動 | WHEN クリックした後に → を押す THE SYSTEM SHALL 変わらずページを送る | 手で確認 |
| 6 | 手動 | WHEN Esc を押す THE SYSTEM SHALL 再生を終了する | 手で確認 |

**ケース 5 が一番重要。** クリックでフォーカスが別オリジンの iframe に落ちると、
そこから先はキーがホストに届かない。**ケース 4 が通っても 5 が落ちる**組み合わせが実在した
(不変条件 18)。ケース 2 と 5 は同じ症状を別の原因で起こすので、両方要る。
**クリックしてからキーを押す**まで見ないと、4 だけ見て安心することになる。

**再生の確認は最後に回す。** 別ページへ遷移するので、他の確認は先に済ませておく。

## 実ウィンドウでしか確認できないこと

以下はブラウザ(`npm run dev`)では見えない。`npm run tauri dev` の実ウィンドウで確認する。

| 事象 | なぜブラウザでは見えないか |
|---|---|
| simple fullscreen の出し入れ | Chrome にはそもそも macOS の styleMask が無い |
| `close()` による SIGSEGV | WebKit 固有。不変条件 16 はコードのコメントとこの文書でしか守れない |
| first responder の移動 | 同上(不変条件 17) |
