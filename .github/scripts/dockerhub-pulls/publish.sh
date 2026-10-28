#!/usr/bin/env bash
# Publishes history.json on an orphan branch, following publish-versions.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRANCH=dockerhub-pull-history
WORKTREE="$(mktemp -d)"
TEMP_BRANCH="tmp/dockerhub-pulls-$$"

cleanup() {
    git worktree remove --force "$WORKTREE" 2>/dev/null || true
    git branch -D "$TEMP_BRANCH" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for attempt in 1 2 3 4 5; do
    cleanup
    # A failed fetch must not be mistaken for a missing branch. ls-remote's
    # exit status 2 specifically means no matching ref; other failures abort.
    if git ls-remote --exit-code --heads origin "refs/heads/$BRANCH" >/dev/null; then
        git fetch --quiet origin "refs/heads/$BRANCH"
        git worktree add --quiet --detach "$WORKTREE" FETCH_HEAD
        if [[ ! -f "$WORKTREE/history.json" ]]; then
            echo "Existing $BRANCH branch has no history.json; refusing to reset it" >&2
            exit 1
        fi
    else
        status=$?
        if [[ "$status" -ne 2 ]]; then
            echo "Could not check $BRANCH; refusing to initialize history" >&2
            exit 1
        fi
        git worktree add --quiet --detach "$WORKTREE"
        git -C "$WORKTREE" checkout --quiet --orphan "$TEMP_BRANCH"
        git -C "$WORKTREE" rm -rf --quiet .
    fi

    node "$SCRIPT_DIR/collect.mjs" "$WORKTREE"
    git -C "$WORKTREE" add history.json
    if git -C "$WORKTREE" diff --cached --quiet; then
        echo "history.json already has today's observations; no commit created"
        exit 0
    fi
    git -C "$WORKTREE" -c user.name="github-actions[bot]" \
        -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
        commit --quiet -m "chore(stats): record Docker Hub pull counts"

    if git -C "$WORKTREE" push --quiet origin "HEAD:refs/heads/$BRANCH"; then
        echo "Recorded Docker Hub pull counts in history.json"
        exit 0
    fi
    echo "Push rejected (attempt $attempt); reloading history before retry"
    if [[ "$attempt" -lt 5 ]]; then sleep $((attempt * 2)); fi
done

echo "Could not update Docker Hub pull history" >&2
exit 1
