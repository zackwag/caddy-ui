#!/usr/bin/env bash
# Commits image versions to versions.json on the orphan `versions` branch.
# Usage: publish-versions.sh <channel> <component>=<version>...
# Retries on push races (release, beta, and edge can finish close together).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRANCH=versions
WORKTREE="$(mktemp -d)"
TEMP_BRANCH="tmp/versions-$$"

cleanup() {
    git worktree remove --force "$WORKTREE" 2>/dev/null || true
    git branch -D "$TEMP_BRANCH" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

for attempt in 1 2 3 4 5; do
    cleanup
    # A failed fetch must not be mistaken for a missing branch. ls-remote's
    # exit status 2 specifically means no matching ref; other failures abort.
    if git ls-remote --exit-code --heads origin "refs/heads/$BRANCH" >/dev/null; then
        git fetch --quiet origin "refs/heads/$BRANCH"
        git worktree add --quiet --detach "$WORKTREE" FETCH_HEAD
    else
        status=$?
        if [[ "$status" -ne 2 ]]; then
            echo "Could not check $BRANCH; refusing to initialize versions.json" >&2
            exit 1
        fi
        git worktree add --quiet --detach "$WORKTREE"
        git -C "$WORKTREE" checkout --quiet --orphan "$TEMP_BRANCH"
        git -C "$WORKTREE" rm -rf --quiet .
    fi

    node "$SCRIPT_DIR/record-versions.mjs" "$WORKTREE/versions.json" "$@"
    git -C "$WORKTREE" add versions.json
    if git -C "$WORKTREE" diff --cached --quiet; then
        echo "versions.json already up to date"
        exit 0
    fi
    git -C "$WORKTREE" commit --quiet -m "Record $* versions"

    if git -C "$WORKTREE" push --quiet origin "HEAD:refs/heads/$BRANCH"; then
        echo "Recorded $* in versions.json"
        exit 0
    fi
    echo "Push rejected (attempt $attempt), retrying"
    if [[ "$attempt" -lt 5 ]]; then sleep $((attempt * 2)); fi
done

echo "Could not update versions.json" >&2
exit 1
