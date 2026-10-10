#!/usr/bin/env bash
# One-step deploy: rebuild every generated file, commit, and push.
# GitHub Pages redeploys automatically on push, so this also updates the live
# site at https://yobin-tim.github.io/quiz-runner/.
#
# Usage:
#   npm run deploy                 # auto commit message with a timestamp
#   npm run deploy -- "your note"  # custom commit message
set -euo pipefail

# Always operate from the repo root (this script lives in scripts/).
cd "$(dirname "$0")/.."

echo "→ Rebuilding generated files (runner, sample, self-contained wizard)…"
npm run build:site

echo "→ Staging changes…"
git add -A

# Nothing to commit? Stop cleanly rather than erroring on an empty commit.
if git diff --cached --quiet; then
  echo "✓ Nothing changed — working tree already matches the last commit. Skipping push."
  exit 0
fi

# Use the supplied message, or fall back to a dated default.
MSG="${1:-Update quiz-runner ($(date '+%Y-%m-%d %H:%M'))}"
echo "→ Committing: $MSG"
git commit -m "$MSG"

echo "→ Pushing to origin…"
git push

echo "✓ Pushed. GitHub Pages will redeploy in ~1 minute:"
echo "  https://yobin-tim.github.io/quiz-runner/"
