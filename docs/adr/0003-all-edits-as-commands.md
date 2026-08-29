---
name: adr-0003
status: active
updated: 2026-08-21
---

# ADR-0003: すべての編集操作は Command として実行する

- **日付**: 2026-08-18
- **状態**: 採用

## 背景

Undo/Redo は必須要件(F6)。加えて将来のプラグイン・AI 連携・共同編集も
「編集操作を外から差し込む」形になる。これらを個別に配線すると継ぎ目が散らばる。

## 選択肢

1. **UI から直接 DOM を書き換え、Undo は DOM スナップショットで戻す** — 実装は最短だが、
   操作の意味が残らず、外部から操作を差し込む口も無い
2. **すべての編集を Command オブジェクトに包む** — 定型作業が増えるが、
   Undo/Redo・操作ログ・外部からの操作が 1 つの継ぎ目に集約される

## 決定

案 2 を採る。

```ts
interface EditCommand {
  readonly label: string;          // "テキスト変更" 等(UI 表示用)
  apply(ctx: DocContext): void;
  revert(ctx: DocContext): void;
  tryMerge?(next: EditCommand): boolean; // 連続入力・ドラッグの合成
}
```

DOM を先に触るジェスチャ(ドラッグ・リサイズ)も `execute(..., { alreadyApplied: true })` で履歴に載せる。

## 理由

- Undo/Redo・操作ログ・プラグインからの操作・将来の共同編集/AI 操作がすべてこの上に乗る
- 対象要素は DOM 参照ではなく **uid**(ロード時に全要素へ付与)で指すことで、
  Undo/Redo 後・再ロード後も安定して解決できる。DOM 参照を持つと Undo 後に対象を見失う
- 連続ジェスチャは `tryMerge` で 1 undo ステップに畳む。さもないとドラッグ 1 回で履歴が埋まる

## 影響

- Command を経由しない編集経路を作ってはならない(Undo で戻せない操作が生まれる)
- 実装は [../features/editing-engine/design.md](../features/editing-engine/design.md)
