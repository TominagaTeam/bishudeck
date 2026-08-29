# Bishudeck

AI が生成した HTML スライドを、CSS も JavaScript もそのまま再現したまま
PowerPoint のように編集する Tauri 製デスクトップアプリ。

## 作業を始める前に必ずやること

1. **[docs/INDEX.md](./docs/INDEX.md) を読む。** 全ドキュメントの地図。
   これから触る範囲の関連ドキュメントをここから開く
2. **[docs/rules/development.md](./docs/rules/development.md) を読む。**
   開発ルール・作業フロー・検証手順・**設計上の不変条件 20 項目**がすべてそこにある
3. **[docs/adr/](./docs/adr/) の 0001〜0004 を読む。** ほとんどの実装判断の根拠になっている
   (0005 は「保留」で、現状の実装には効いていない)
4. **[docs/roadmap.md](./docs/roadmap.md) で Phase の状態を確認する。**
   着手する項目と、その Phase の完了条件を把握してから書き始める

## 変更のたびに守ること(docs/rules/development.md の要約)

0. **課題は束ねて渡す** — 単位は課題 1 件ではなく**ブランチ 1 本**。同じ画面・同じ機能の課題を
   **最大 5 件**まとめ、手で触ってもらうのを 1 周にする。**コミットは課題ごとに分ける**
   (1 件だけ差し戻せるように)。渡すときは **dev server を起動した状態**で、触る箇所と手順を添える
   ([ADR-0008](./docs/adr/0008-handoff-before-docs.md))
1. **検証する** — `npm run typecheck` / `npm test` / `cargo test` を通す(§2)。目視で済ませず数値で確認する
   - **E2E(smoke)は廃止した**([ADR-0009](./docs/adr/0009-drop-smoke-e2e.md))。実ブラウザでしか見えない範囲
     (iframe 境界・実マウス・フォーカス移動)は**自動検証から外れている**
   - UI を触ったなら `npm run tauri dev` で起動し、[development.md](./docs/rules/development.md) §2 の表を引いて
     **該当箇所を手で確認する**。確認した範囲と、していない範囲を報告に書く
2. **設計書は実装コミット、記録は触ってもらった後** — 触る機能の `docs/features/<機能名>/design.md` は
   実装と同一コミット。**無ければ `docs/features/_template/` から先に作る**(ユーザーのコマンド実行を待たない)。
   `issues.md` / `roadmap.md` / `decisions.md` は**手で触って OK が出てから**まとめて 1 コミットし、それからマージ。
   **緩めたのはタイミングだけで、マージの条件からは外していない。** 対応表は §3
3. **ズレは黙って直さず報告する** — ドキュメントと実装が食い違っていたら、どちらが正かユーザーに裁定を仰ぐ。
   自分で設計書のほうを直さない(実装側のバグを設計書に追認してしまうため。[ADR-0006](./docs/adr/0006-docs-driven-migration.md))
4. **Phase の状態を更新する** — [docs/roadmap.md](./docs/roadmap.md) を実態に合わせる(**進捗の正はここ**。README の表は要約)
5. **判断を残す** — 全体レベルの技術判断は `docs/adr/` に ADR、機能内の判断はその機能の `decisions.md` へ。
   **同じ事実を 2 箇所に書かない(SSOT)**。迷ったら INDEX の分類に従い、他からは参照リンクにする
6. **アイデアを捨てない** — 会話で出た「いつかやりたい」は [docs/ideas.md](./docs/ideas.md) に書き留める。
   **もう起きている負債・妥協・ズレ**(いつかやりたい、ではないもの)は
   [docs/issues.md](./docs/issues.md) へ書き留める([ADR-0007](./docs/adr/0007-issues-md-and-task-file-rule.md))。
   変更が数回積み重なったら `/docs-init doctor`(ドリフト検査)の実行を提案する

## 壊してはいけない約束(詳細は [docs/rules/development.md](./docs/rules/development.md) §4・§8)

- スライドの正データは **HTML 文字列**。独自 JSON モデルに変換しない([ADR-0001](./docs/adr/0001-html-as-source-of-truth.md))
- 保存・書き出した HTML を**壊さない**。エディタ由来のものが残るのは可だが、見た目と挙動を変えない・
  往復で増えない・デッキ自身の CSS / JS の当たり方を変えないこと(スライド markup の
  `data-hse-*` / `contenteditable` / ステージが足したクラスは条件を満たさないので必ず除去)
- **編集モードで JS を実行しない**(`allow-scripts` を付けない)。**プレビューに `allow-same-origin` を付けない**([ADR-0002](./docs/adr/0002-edit-preview-separation.md))
- すべての変更は **Command 経由**。DOM を直接触るジェスチャも `execute(..., { alreadyApplied: true })` で履歴に載せる([ADR-0003](./docs/adr/0003-all-edits-as-commands.md))
- 要素は DOM 参照ではなく **uid** で指す。iframe の DOM に触るのは **StageBridge だけ**
- スタイル編集は**インラインの上書き**で行い、元の CSS を書き換えない([ADR-0004](./docs/adr/0004-style-edits-as-overrides.md))
- **Rust 側は HTML を解釈しない**。ファイル I/O・アセット配信・プレビュー公開・ウィンドウ管理の 4 つ(`src-tauri/src/commands/` の 4 モジュール)に徹する。
  プレビュー公開は合成済み HTML を**文字列のまま預かって URL を返すだけ**なので、4 つ目が増えても「解釈しない」は変わらない
- **自作 Rust コマンドの `invoke` は `src/shared/backend.ts` に集約する**(プラグイン API を直接使うときは、ブラウザで動かない場合のフォールバックを必ず置く)
- 保存は**一時ファイル経由の atomic rename**。自動保存も同じ経路を通す
- プレビュー合成の足場(プレースホルダ・ナビ注入)は **preview モード限定**。編集・書き出しに漏らさない
- **リリース tag を打ったら、公開リポへ写すまでが 1 セット。**
  `git tag` でバージョンを切ったら `./scripts/mirror.sh <tag> ../bishudeck` を走らせ、
  中身を確かめてから公開リポで push する。写し忘れると
  [TominagaTeam/bishudeck](https://github.com/TominagaTeam/bishudeck) が古びるが、
  **古びたことは外からしか見えない**(公開側の最新コミット名 = 最新 tag 名で照合する)。
  スクリプトはコミットを作るところで止まり **push はしない** ——
  公開は取り消せないので、押す判断は必ず人が握る
  ([ADR-0012](./docs/adr/0012-mirror-to-public-repo.md) / [development.md](./docs/rules/development.md) §8)

## よく使うコマンド

```bash
npm run tauri dev             # デスクトップアプリとして起動(手で触る用)
npm run typecheck             # TypeScript
npm test                      # Vitest(取り込み・往復シリアライズ・コマンド)
npm run dev                   # フロントだけを Vite で起動(tauri dev が内部で使う)
cd src-tauri && cargo test    # Rust(slides:// ルーティング・ファイル I/O)

./scripts/mirror.sh v0.2.0 ../bishudeck   # リリース tag を公開リポへ写す(push はしない)
```

自動テストはここまで。**実ブラウザの挙動を見る手段は手で触ることだけ**なので、
UI を触ったら [docs/rules/development.md](./docs/rules/development.md) §2 の表で確認する箇所を決める。
