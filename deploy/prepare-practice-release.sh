#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
EXPECTED=${1:?Usage: bash prepare-practice-release.sh FULL_COMMIT_SHA}
MODE=${2:-}
[[ -z "$MODE" || "$MODE" = --resume ]] || { echo 'Unknown release mode'; exit 1; }
[[ "$EXPECTED" =~ ^[a-f0-9]{40}$ ]]
cd /www/gamehub
test -f deploy/.env.prod
test -z "$(git status --porcelain)" || { echo 'Working directory has changes. Stop; do not reset or clean.'; exit 1; }
git cat-file -e "$EXPECTED^{commit}"
CURRENT=$(git rev-parse HEAD)
git merge-base --is-ancestor "$CURRENT" "$EXPECTED" || { echo 'Release does not contain the current production commit. Stop and integrate it first.'; exit 1; }
test -z "$(git diff --name-only --diff-filter=MD "$CURRENT" "$EXPECTED" -- apps/api/migrations)" || { echo 'Existing migrations changed. Stop for review.'; exit 1; }
if [ "$MODE" = --resume ]; then
  RECORD=
  while IFS= read -r candidate; do
    test -s "$candidate/release-commit.txt" || continue
    [ "$(cat "$candidate/release-commit.txt")" = "$CURRENT" ] || continue
    test -s "$candidate/previous-commit.txt" && test -s "$candidate/compose.before.yml" && test -f "$candidate/env.before" || continue
    [ "$(cat "$candidate/previous-commit.txt")" != "$CURRENT" ] || continue
    test ! -e "$candidate/database.dump" && test ! -e "$candidate/activation-started" || { echo 'An earlier attempt reached database backup or activation. Stop for review.'; exit 1; }
    RECORD="$candidate"; break
  done < <(find /www/backup/gamehub -mindepth 1 -maxdepth 1 -type d -name 'practice-*' | LC_ALL=C sort -r)
  test -n "$RECORD" || { echo 'No matching pre-migration release record found. Stop without overwriting the original backup.'; exit 1; }
  export MOOYU_RELEASE_RESUMING=true
  echo "Resuming with original production record: $RECORD"
else
  RECORD="/www/backup/gamehub/practice-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$RECORD"
  printf '%s\n' "$CURRENT" > "$RECORD/previous-commit.txt"
  git branch --show-current > "$RECORD/previous-branch.txt"
  cp deploy/compose.prod.yml "$RECORD/compose.before.yml"
fi
git merge --ff-only "$EXPECTED"
export MOOYU_RELEASE_RECORD="$RECORD"
exec bash deploy/update-practice-release.sh "$EXPECTED"
