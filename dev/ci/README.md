# Regression workflow timing

The comparison for [#436](https://github.com/zackwag/caddy-ui/issues/436) and
[#442](https://github.com/zackwag/caddy-ui/pull/442) was refreshed on 2026-11-04
against upstream `main` at `b9b84e7cca88fcb7b3ca1e2f305a428f3fc486b1`.
The parallel workflow is rebased onto that snapshot, including its current
runtime, dependency lockfiles, integration tests and browser scenarios.

## Suites measured

The full browser command is unchanged. Its 13 entry-point files are split across
three workers, with serial file execution within each group:

| Group | Files | Passing scenarios |
| --- | --- | ---: |
| Authentication | `cross-site.mjs`, `auth.mjs`, `totp.mjs` | 16 |
| Configuration 1 | `error-logging.mjs`, `history.mjs`, `content-security-policy.mjs`, `editor.mjs` | 19 |
| Configuration 2 | `languages.mjs`, `api-tokens.mjs`, `verification.mjs`, `xss.mjs`, `documentation.mjs`, `uptime-history.mjs` | 18 |
| Full browser suite | Union of all three groups | 53 |

Scenario files and assertions stay unchanged. The configuration files are
assigned by their measured runtimes: 95.4 seconds in shard 1 and 95.1 seconds in
shard 2 in the two-worker fork sample below. Those sums include scenario fixture
setup/teardown but exclude job preparation and test-file hooks; they are inputs
to the assignment, not measured runtimes for the new workers.

`test:dev-caddy:e2e:configuration` remains the combined local command. CI runs
only its `:1` and `:2` shards, alongside authentication. Workflow contracts check
both the combined configuration command and the full browser inventory for
missing or duplicate files. Future contributors can keep scenarios organized by
behavior and adjust only the file assignments when balancing workers.

The runs also cover 28 real-Caddy integration tests, one documentation
capture/replay scenario, 37 lifecycle/readiness tests, 22 playground tests,
996 backend tests and 183 frontend tests. The parallel workflow adds four
contract tests for its own split and aggregate gate: workflow checks increase
from 32 in the baseline to 36 after the change.

All layouts use `.node-version` (26), Node 26.13.0 in the measured logs,
Playwright 1.64.1 and `ubuntu-latest`. Every `setup-node` step reads the shared
runtime file, including the new jobs. Application assertions, fixture source,
Caddy images and browser versions are unchanged by this branch.

## Three-worker follow-up

The three-worker change was measured at
`0772a9af553ca1bd973bdc2b75ad77124b5e9008`, using the same upstream application,
scenario and dependency sources as the two-worker samples below. Both fresh
first-attempt runs passed, including all 53 browser tests (16 + 19 + 18):

| Run | Created → Test gate completed | Initial queue | Sum of job execution |
| --- | ---: | ---: | ---: |
| [41905888739 — fork](https://github.com/juscghwe/caddy-ui/actions/runs/41905888739) | 451 s (7m31s) | 4 s | 1105 s (18m25s) |
| [41905858916 — upstream PR](https://github.com/zackwag/caddy-ui/actions/runs/41905858916) | 440 s (7m20s) | 3 s | 957 s (15m57s) |

The configuration **test steps** are now balanced, while dependency installation
dominated the complete runs:

| Step | Fork | Upstream PR |
| --- | ---: | ---: |
| Configuration 1 browser scenarios | 86 s | 95 s |
| Configuration 2 browser scenarios | 92 s | 90 s |
| Authentication browser scenarios | 60 s | 43 s |
| Configuration 1 Chromium/system preparation | 23 s | 27 s |
| Configuration 2 Chromium/system preparation | 167 s | 15 s |
| Authentication Chromium/system preparation | 357 s | 27 s |
| Capture Caddy/Chromium preparation | 39 s | 397 s |

For comparison, the earlier combined configuration browser step took 196 seconds
on the fork and 184 seconds on upstream. Whole-file sharding reduced that test
critical path, but these three-worker runs were **slower overall** than the
two-worker samples. They do not establish an end-to-end speed improvement.

The fork authentication runner downloaded 21.9 MB of APT packages in 5m39s at
64.4 kB/s. Upstream's capture runner downloaded the same amount in 6m21s at
57.4 kB/s, then passed its scenario in 20 seconds. The fork browser runners
restored their npm cache, so these delays cannot be explained as npm cache
misses. System-package preparation is the next optimization target; increasing
worker count alone does not make that preparation predictable.

## Two-worker hosted comparison

All three runs below passed on their first attempt. The first two are an explicit
before/after pair on the same fork using `workflow_dispatch`. The third is the
upstream PR validation of the same parallel commit.

| Layout | Run | Source commit | Created → Test gate completed | Initial queue | Sum of job execution |
| --- | --- | --- | ---: | ---: | ---: |
| Standard workflow, fork | [41899954813](https://github.com/juscghwe/caddy-ui/actions/runs/41899954813) | `b9b84e7cca88fcb7b3ca1e2f305a428f3fc486b1` | 347 s (5m47s) | 4 s | 441 s (7m21s) |
| Parallel workflow, fork | [41900565452](https://github.com/juscghwe/caddy-ui/actions/runs/41900565452) | `fabd78f6f35774c87cb41b946e8318425899b557` | 244 s (4m04s) | 4 s | 526 s (8m46s) |
| Parallel workflow, upstream PR | [41900199865](https://github.com/zackwag/caddy-ui/actions/runs/41900199865) | `fabd78f6f35774c87cb41b946e8318425899b557` | 241 s (4m01s) | 4 s | 514 s (8m34s) |

The paired fork runs finished **103 seconds (29.7%) sooner** with parallel jobs,
while summed runner execution increased **85 seconds (19.3%)**. These are
observations from one pair, not an established typical speed improvement.
The upstream result is corroborating validation on a different repository's
runners, rather than another matched baseline/parallel pair.

The baseline's combined integration job took 335 seconds. Its steps included
18 seconds of Caddy/Chromium preparation, 36 seconds of integration tests,
17 seconds of capture/replay and 240 seconds of browser scenarios. Other work
in that job includes dependency installation, tooling checks and cleanup.

The two-worker parallel fork run's complete job durations were:

| Job | Duration |
| --- | ---: |
| Development tooling | 24 s |
| Real-Caddy integration | 47 s |
| Documentation capture/replay | 53 s |
| Browser — authentication | 76 s |
| Browser — configuration | 232 s |
| Backend tests | 43 s |
| Frontend tests | 18 s |
| Backend lint | 14 s |
| Frontend lint | 15 s |
| Required Test gate | 4 s |

Configuration was the critical job: its browser step took 196 seconds,
compared with 40 seconds for authentication. Chromium preparation took 19 and
18 seconds respectively; capture's combined Caddy/Chromium preparation took
19 seconds. The split overlaps the remaining work with configuration rather
than eliminating browser or dependency setup.

The baseline combined runner and both fork browser runners reported npm cache
misses. This is distinct from the preinstalled Node tool cache, and `npm ci`
still installs dependencies when a download cache is restored. Setup timings,
queueing and runner-image details should remain part of future comparisons.

## Measurement boundaries

Elapsed time starts at workflow creation and ends at the aggregate `Test` job's
completion. Initial queue is creation to the earliest job start. Summed job
execution adds every job's start-to-completion interval, including post-job work
and the gate; it excludes queue time and is **not a billing calculation**.
Step times omit checkout, Node setup and cleanup unless explicitly named.
Browser scenario times include fixture acquisition and teardown.

The gate waits for application tests/lint, tooling, integration, capture and all
three browser groups, and rejects failed, cancelled or skipped dependencies. Each
runner owns its checkout, dependencies, services and temporary files.
Authentication does not prepare Docker; integration does not install Chromium.
The three-worker split adds five worker jobs and repeats some setup, so runner availability
and download variability can offset the wall-clock benefit.

Earlier October measurements in the PR discussion used older suites and Node 22.
They are historical observations and are not the baseline for the percentages
above. Further first-attempt pairs, cache states and failed/retried runs should
be recorded before claiming a consistent improvement or closing #436.

## Reproduce the comparison

Choose an upstream snapshot, synchronize the fork's `main` to it, and rebase
`ci/parallel-test-jobs` onto that same snapshot. Verify that the application,
scenario and dependency sources match; do not compare an older suite with a
newer split. `npm run test:workflows` checks that every browser file in the full
command appears in exactly one group and that the aggregate gate rejects
unsuccessful jobs.

Dispatch `.github/workflows/test.yml` on the fork's `main` for the standard layout
and on `ci/parallel-test-jobs` for the parallel layout. Retain the returned run
IDs, source SHAs, attempt numbers and conclusions. For example, collect the
parallel run's metadata, every job page and logs with:

```sh
ci_repository=juscghwe/caddy-ui
ci_run=41900565452
ci_attempt=1
gh api "repos/$ci_repository/actions/runs/$ci_run" > run.json
gh api --paginate --slurp "repos/$ci_repository/actions/runs/$ci_run/attempts/$ci_attempt/jobs?per_page=100" > jobs.json
gh run view "$ci_run" --repo "$ci_repository" --attempt "$ci_attempt" --log > run.log
```

Use the attempt-specific job endpoint so a rerun cannot silently replace the
sample's jobs. Keep retries and failures separate from successful first attempts;
for a rerun, use that attempt's start time rather than the original run creation
time. Record runner/runtime versions, cache outcomes, job and step timestamps,
and scenario counts alongside both elapsed time and summed execution.
