#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
EXPECTED=${1:?Usage: bash prepare-practice-release.sh FULL_COMMIT_SHA}
[[ "$EXPECTED" =~ ^[a-f0-9]{40}$ ]]
cd /www/gamehub
test -f deploy/.env.prod
test -z "$(git status --porcelain)" || { echo 'Working directory has changes. Stop; do not reset or clean.'; exit 1; }
git cat-file -e "$EXPECTED^{commit}"
CURRENT=$(git rev-parse HEAD)
git merge-base --is-ancestor "$CURRENT" "$EXPECTED" || { echo 'Release does not contain the current production commit. Stop and integrate it first.'; exit 1; }
test -z "$(git diff --name-only --diff-filter=MD "$CURRENT" "$EXPECTED" -- apps/api/migrations)" || { echo 'Existing migrations changed. Stop for review.'; exit 1; }
RECORD="/www/backup/gamehub/practice-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RECORD"
printf '%s\n' "$CURRENT" > "$RECORD/previous-commit.txt"
git branch --show-current > "$RECORD/previous-branch.txt"
cp deploy/compose.prod.yml "$RECORD/compose.before.yml"
git merge --ff-only "$EXPECTED"
export MOOYU_RELEASE_RECORD="$RECORD"
exec bash deploy/update-practice-release.sh "$EXPECTED"
