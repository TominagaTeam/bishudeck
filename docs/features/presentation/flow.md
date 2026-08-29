---
feature: presentation
status: active
updated: 2026-08-25
---

# presentation — 処理フロー

## メインフロー

```mermaid
graph TD
    A[再生を押す] --> B[set_live_project で鏡を置く]
    B --> C{ウィンドウは在る?}
    C -->|無い| D[作る]
    C -->|在る| E[show + simple fullscreen]
    E --> F[present:start を emit]
    D --> G[Present が getLiveProject]
    F --> G
    G --> H[focus_presentation_webview]
    H --> I[PreviewStage が slides:// で描画]
```

## 異常系・エッジケース

| ケース | どうなるか |
|---|---|
| デッキの取得に失敗 | コンソールに出し、空のプロジェクトのまま。ウィンドウは残る |
| ブラウザで動かしている(`npm run dev`) | `getCurrentWindow()` が例外になる経路をすべて握り潰す(不変条件 11) |
| デッキの JS がスライド index で分岐する | プレースホルダを並べて index を再現する([roadmap](../../roadmap.md) のリスク表) |
| 再生中にクリックする | ホスト側のシールドが受ける。iframe にフォーカスを落とさない |

## 状態遷移

```mermaid
stateDiagram-v2
    [*] --> 未生成
    未生成 --> 再生中: 初回(ウィンドウを作る)
    再生中 --> 隠れている: Esc(fullscreen 解除 + hide)
    隠れている --> 再生中: 2 回目以降(show + present:start)
```

**「閉じた」状態は無い。** 作ったウィンドウは終了まで生き続ける(不変条件 16)。
