# Docker Hub pull history

This worker records the public integer `pull_count` for `zackwag/caddy-ui-backend` and `zackwag/caddy-ui-frontend`. It needs no Docker Hub credentials, extra npm dependencies, application containers or browser. The two series stay separate; their counts are not summed.

## README badge

The repository README shows a backend-only Shields badge, independently of this worker:

```markdown
[![Backend pulls](https://img.shields.io/docker/pulls/zackwag/caddy-ui-backend?style=flat-square&label=backend%20pulls)](https://hub.docker.com/r/zackwag/caddy-ui-backend)
```

The badge may abbreviate large values and is cached by Shields. Historical collection retains the integer API values. No history graph is currently generated or embedded.

## Daily collection and storage

`.github/workflows/dockerhub-pulls.yml` runs daily at **00:17 UTC** upstream and supports **Run workflow** manually, including in forks. Scheduled workflows use the default branch, can be delayed or skipped by GitHub, and are disabled in inactive public repositories after 60 days. This is a best-effort daily observation, not an exact-midnight monitoring service.

`publish.sh` follows `.github/scripts/publish-versions.sh`: fetch the orphan data branch into a temporary worktree, update its file, commit and push without force, and reload current history before retrying a rejected push. It uses the job's short-lived Actions token with `contents: write`. A missing branch is initialized on the first successful collection; network or permission failures are not treated as a missing branch. Existing missing, malformed or unsupported history fails rather than being reset.

The durable copy is `history.json` on the orphan `dockerhub-pull-history` branch. That branch contains no application code or workflows. Updates do not modify main, open PRs, build images or create releases. There is no separate artifact upload.

The version-1 schema stores a map of repository names to observation arrays:

```json
{
  "version": 1,
  "repositories": {
    "zackwag/caddy-ui-backend": [],
    "zackwag/caddy-ui-frontend": []
  }
}
```

Each observation has an ISO UTC `observedAt` timestamp and an integer `pullCount`. The **first successful observation per UTC day wins**, separately for each repository. A same-day rerun skips series already observed that day, without fetching or replacing them. Both remaining reads must succeed before the file changes; a failed request or invalid response never becomes a zero-count observation. A rerun that finds both observations already present makes no data commit.

## Local collection

Use the Node version from `.node-version`:

```bash
node .github/scripts/dockerhub-pulls/collect.mjs /tmp/caddy-ui-dockerhub-pulls
```

An existing `history.json` in that directory is extended; otherwise history starts with the first successful observation. Copy the data branch's file there first to continue the published dataset. Local collection writes only that directory and does not push anything.

## Interpreting the counts

These are cumulative repository pulls, **not unique users or installs**. CI, automated updaters and repeated downloads contribute. Docker Hub may update counters with a delay or correct them downwards; observed corrections remain in the history.

There is no historical backfill: missing days remain missing, and samples retain their actual timestamps. First-wins prevents manual reruns from shifting an existing observation, but delayed or retried scheduled runs can still produce irregular intervals. A difference between observations therefore is not necessarily a 24-hour total.

## Checks

```bash
npm run test:workflows
npm run lint:dev-caddy
bash -n .github/scripts/dockerhub-pulls/publish.sh
```

Collector checks cover the HTTP body deadline, both repositories, same-day no-ops, missing series, null and invalid responses, and preservation on failure. Publisher checks use real local bare repositories and worktrees to exercise initialization, no-op reruns, unreadable history, failed remote lookups and concurrent writers. Only Docker Hub responses are simulated there. Live fork runs additionally verify API access and Actions push permissions.
