#!/usr/bin/env bash
#
# 開発リポ(private / html-slide-editor)の内容を、公開リポ(public / bishudeck)へ
# 1 コミットとして写す。リリース tag を打つたびに 1 回走らせる。
#
#   scripts/mirror.sh v0.2.0 ../bishudeck
#
# なぜ丸ごと 1 コミットか
#   公開側は「そのリリース時点のソース」であればよく、開発の過程は private 側に
#   残る。コミットを 1 対 1 で写そうとすると、写す順序と粒度をミラーのたびに
#   決めることになり、手作業が増える(docs/adr/0012 を参照)。
#
# 何を写すか
#   git archive の出力、つまり **その tag で追跡されているファイルだけ**。
#   .gitignore の対象(node_modules / dist / samples/local / .env / .claude の
#   個人設定)は最初から入らないので、除外リストを別に持つ必要がない。
#   docs も CLAUDE.md も外さない —— 外すと docs 内の相互リンクが 155 本切れる。
#
# push はしない
#   コミットを作るところまでで止める。公開は取り返しがつかないので、
#   git log と git show を見てから人が押す。最後に手順を表示する。
#
set -euo pipefail

TAG="${1:-}"
DEST="${2:-}"

if [ -z "$TAG" ] || [ -z "$DEST" ]; then
  cat >&2 <<'USAGE'
使い方: scripts/mirror.sh <tag> <公開リポの作業ディレクトリ>

  例: scripts/mirror.sh v0.2.0 ../bishudeck

  <tag>  この開発リポに打ってあるリリース tag
  <公開リポの作業ディレクトリ>
         TominagaTeam/bishudeck を clone したディレクトリ。
         初回は先に手元へ clone しておく:
           git clone git@github.com:TominagaTeam/bishudeck.git ../bishudeck
USAGE
  exit 64
fi

SRC="$(git rev-parse --show-toplevel)"

# ---------------------------------------------------------------- 事前チェック
# 写す前に止まる条件をすべてここで見る。途中で失敗すると、公開リポが
# 「消しただけ」の状態で残ってしまうため。

if ! git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
  echo "エラー: tag '$TAG' がこのリポジトリに無い。" >&2
  echo "  打ってある tag: $(git tag --list | tr '\n' ' ')" >&2
  exit 1
fi

if [ ! -d "$DEST/.git" ]; then
  echo "エラー: '$DEST' は git リポジトリではない。" >&2
  echo "  先に clone する: git clone git@github.com:TominagaTeam/bishudeck.git $DEST" >&2
  exit 1
fi

DEST_URL="$(git -C "$DEST" remote get-url origin 2>/dev/null || echo '')"
case "$DEST_URL" in
  *bishudeck*) ;;
  *)
    echo "エラー: '$DEST' の origin が bishudeck ではない。" >&2
    echo "  origin: ${DEST_URL:-(未設定)}" >&2
    echo "  写す先を間違えると公開リポを壊すので、ここで止める。" >&2
    exit 1
    ;;
esac

if [ -n "$(git -C "$DEST" status --porcelain)" ]; then
  echo "エラー: '$DEST' に未コミットの変更がある。" >&2
  git -C "$DEST" status --short >&2
  echo "  前回のミラーが途中で止まった可能性がある。中身を確かめてから消すこと。" >&2
  exit 1
fi

# 公開側を最新にしておく。誰かが公開リポへ直接コミットしていたら、
# ここで気付けるようにする(このスクリプトは force push を前提にしない)。
echo "→ 公開リポを fetch"
git -C "$DEST" fetch origin --quiet
DEST_BRANCH="$(git -C "$DEST" symbolic-ref --short HEAD)"
if git -C "$DEST" rev-parse --verify --quiet "origin/$DEST_BRANCH" >/dev/null; then
  git -C "$DEST" reset --hard "origin/$DEST_BRANCH" --quiet
fi

# ------------------------------------------------------------------ 入れ替え
# 追跡ファイルを一度すべて消してから展開する。差分だけを上書きすると、
# 開発リポで削除したファイルが公開側に残り続ける。
echo "→ 公開リポの中身を空にする"
git -C "$DEST" rm -rq --ignore-unmatch . 2>/dev/null || true

echo "→ $TAG の追跡ファイルを展開する"
git -C "$SRC" archive "$TAG" | tar -x -C "$DEST"

# ------------------------------------------------------------------ コミット
git -C "$DEST" add -A

if git -C "$DEST" diff --cached --quiet; then
  echo "→ 前回のミラーから中身に変化なし。コミットは作らなかった。"
  exit 0
fi

SRC_SHA="$(git -C "$SRC" rev-parse --short "$TAG^{commit}")"
git -C "$DEST" commit --quiet -F - <<EOF
$TAG

html-slide-editor $SRC_SHA の内容をそのまま写したもの。
このリポジトリのコミットはリリース単位で、開発の過程は開発リポに残る。
EOF

# -------------------------------------------------------------------- 報告
echo
echo "コミットを作った(まだ push していない):"
echo
git -C "$DEST" show --stat --oneline HEAD | head -30
echo
echo "中身を確かめてから、公開リポで push する:"
echo
echo "    git -C $DEST log --oneline -3"
echo "    git -C $DEST push origin $DEST_BRANCH"
echo
