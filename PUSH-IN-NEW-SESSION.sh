#!/usr/bin/env bash
# PUSH-IN-NEW-SESSION.sh
#
# Session bootstrap push: stages any pending work on the current session
# branch, pushes it to origin, opens (or reuses) a PR against main, and
# prints the PR URL. Designed to work in a fresh sandbox/checkout where
# nothing but the session branch exists.
#
# Usage:
#   ./PUSH-IN-NEW-SESSION.sh ["optional commit message"]
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BRANCH="$(git branch --show-current)"
if [ -z "$BRANCH" ]; then
  echo "ERROR: detached HEAD — check out the session branch first." >&2
  exit 1
fi

BASE="${BASE_BRANCH:-main}"

echo "==> Repo:    $(git remote get-url origin)"
echo "==> Branch:  $BRANCH (base: $BASE)"

# 1. Commit any pending work so the push is never empty.
if [ -n "$(git status --porcelain)" ]; then
  COMMIT_MSG="${1:-Session work: push from new session on $BRANCH}"
  git add -A
  git commit -m "$COMMIT_MSG"
  echo "==> Committed pending changes: $COMMIT_MSG"
else
  echo "==> Working tree clean — nothing new to commit."
fi

# 2. Push the session branch.
git push -u origin "$BRANCH"
echo "==> Pushed $BRANCH to origin."

# 3. Open (or reuse) a PR against main and print its URL.
EXISTING_URL="$(gh pr list --head "$BRANCH" --base "$BASE" --state all \
                  --json url --jq '.[0].url' 2>/dev/null || true)"
if [ -n "$EXISTING_URL" ] && [ "$EXISTING_URL" != "null" ]; then
  PR_URL="$EXISTING_URL"
  echo "==> PR already exists for $BRANCH — reusing it."
else
  SUBJECT="$(git log --format=%s "$BASE"..HEAD 2>/dev/null | tail -1 || true)"
  TITLE="${SUBJECT:-Session push: $BRANCH}"
  PR_URL="$(gh pr create --base "$BASE" --head "$BRANCH" \
             --title "$TITLE" \
             --body "Automated session push from \`$BRANCH\` via PUSH-IN-NEW-SESSION.sh.")"
  echo "==> Opened a new PR."
fi

echo ""
echo "=========================================="
echo " PR URL: $PR_URL"
echo "=========================================="
