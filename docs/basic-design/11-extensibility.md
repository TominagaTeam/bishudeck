---
name: extensibility
status: active
updated: 2026-08-23
---

# プラグイン / 拡張性設計

方針は [ADR-0005](../adr/0005-core-features-on-plugin-api.md)(コア機能自体をプラグイン API の上に実装する)。
**その ADR は 2026-08-23 に「保留」へ落とした** — 一度も効いていなかったため。

> **実装状況**: この章は Phase 4 の設計であって現状ではない。`src/plugins/` はまだ無く、
> コア機能はすべて直接実装されている。Phase 4 で ADR-0005 ごと再検討する
> ([../roadmap.md](../roadmap.md))。**「採用」と書いてあるのに効いていない**という
> 状態は解消したので、[../issues.md](../issues.md) #1 はそこで閉じている。
> どこまで API の芯ができていて、どこが「コアだけの裏口」なのかは
> [ADR-0005](../adr/0005-core-features-on-plugin-api.md) の「保留に落とした経緯」の表にある。

## 拡張ポイント

```ts
interface HseAPI {
  commands:  { register(id: string, factory: CommandFactory): void; execute(id: string, args?: unknown): void };
  tools:     { register(tool: ToolDefinition): void };          // キャンバス操作モード(選択 / テキスト / 図形…)
  panels:    { register(panel: PanelDefinition): void };        // インスペクタ / サイドバーへの UI 追加
  importers: { register(detector: SlideDetector): void };       // スライド境界の検出器
  exporters: { register(exporter: ExporterDefinition): void };  // HTML / PDF / PPTX / …
  events:    EventBus;   // document:changed / selection:changed / slide:changed / mode:changed …
  document:  ReadonlyDocumentAccess & { execute(cmd: EditCommand): void };  // 変更は必ず Command 経由
}
```

`document` から の変更は**必ず Command 経由**([ADR-0003](../adr/0003-all-edits-as-commands.md))。
これにより外部拡張の操作もすべて Undo 可能になる。

## 段階

| 段階 | 内容 |
|---|---|
| 第 1 段階 | **ビルトインプラグインのみ**(コア機能がこの API を使う。ADR-0005) |
| 第 2 段階 | プロジェクト内 or アプリ設定ディレクトリからのローカルプラグイン読み込み |

外部プラグインにフル DOM アクセスを渡すかは第 2 段階で再検討(サンドボックス要否)。

## 想定される将来拡張と受け皿

| 拡張 | 受け皿 |
| --- | --- |
| PPTX エクスポート | `exporters.register` |
| AI スライド生成 / リライト | `commands` + `document.execute`(全変更が Undo 可能) |
| 図形・表・グラフ挿入 | `tools` + `InsertElement` |
| テーマ一括適用 | `commands`(`shared.headHtml` への Command が必要 → `SetSharedHead` を将来追加) |
| 共同編集 | Command のシリアライズ + 転送([ADR-0003](../adr/0003-all-edits-as-commands.md) が前提を確保) |
| 取り込み Detector の追加 | `importers.register`([../features/import-pipeline/design.md](../features/import-pipeline/design.md)) |

## API 凍結

**コア API(Command / Plugin)は Phase 2 完了時点で凍結**する方針。
以降の変更はこの章の更新とセットで行う。
