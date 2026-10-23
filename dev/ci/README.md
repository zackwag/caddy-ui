# Regression workflow timing

This is the initial measurement and parallel-job follow-up for
[#436](https://github.com/zackwag/caddy-ui/issues/436). It preserves the suites and
the existing aggregate `Test` check. Hosted after-change measurements are still
needed before claiming a GitHub Actions speedup or closing the investigation.

## Hosted baseline

Three successful first-attempt Test runs from 2026-10-22 used the same sequential
integration-job layout on `ubuntu-latest`, Node 22 (22.23.3 in the sampled log),
and freshly installed Playwright Chromium. They are observational samples from
different PR commits, not repeated controlled trials of identical source.

| Run | Commit | Created → aggregate completed | Initial queue | Sum of job execution | Integration critical job |
| --- | --- | ---: | ---: | ---: | ---: |
| [39856879842](https://github.com/zackwag/caddy-ui/actions/runs/39856879842) | `9023012296ccd3263cbe66ec8e8d042c1b85dc4d` | 221 s | 3 s | 299 s | 211 s |
| [39856706824](https://github.com/zackwag/caddy-ui/actions/runs/39856706824) | `749170ee33dc2e7e7cafc6ee47809f6ab8c05f15` | 240 s | 4 s | 309 s | 229 s |
| [39856238727](https://github.com/zackwag/caddy-ui/actions/runs/39856238727) | `48422327edb932302500d08aae8e03cef3afc1ea` | 228 s | 3 s | 296 s | 219 s |

Initial queue is workflow creation to the earliest job start. Sum of job execution
adds each job's start-to-completion interval; it excludes queue time, overlaps
parallel work, and is not a billing calculation. Workflow elapsed time includes
queueing, setup, tests, post-job work and the aggregate job.

| Integration-job step | 39856879842 | 39856706824 | 39856238727 |
| --- | ---: | ---: | ---: |
| Application/dev dependency installation | 6 s | 9 s | 6 s |
| Tooling lint, playground and lifecycle tests | 3 s | 4 s | 3 s |
| Caddy/Chromium preparation | 38 s | 30 s | 35 s |
| Real-Caddy integration scenarios | 21 s | 24 s | 25 s |
| Authenticated documentation capture/replay | 16 s | 17 s | 17 s |
| Browser scenarios, serial file execution | 118 s | 136 s | 128 s |

Step sums omit checkout, Node setup and cleanup. Capture/replay includes frontend
builds and generated screenshots; the workflow does not time those subphases
separately. Browser-test timings include fixture acquisition and teardown.

All three integration logs report `npm cache is not found`. The preinstalled Node
tool cache was available; that is different from an npm download-cache hit.
`npm ci` still installs dependencies on a cache hit.

The additional failed sample
[39860638991](https://github.com/zackwag/caddy-ui/actions/runs/39860638991), commit
`1c55056399a9e18e5b63663fd63368685e60c6d7`, restored the npm cache but failed the
real-example TLS scenario with `EPROTO` / TLS alert 80. Capture and browser steps
then did not run. Its shorter elapsed time cannot establish a warm-cache speedup.
This sample establishes neither a persistent flake nor the cost of repeated
attempts; failed and retried runs need separate classification.

## Change selected from the measurements

- Tooling, real-Caddy integration and documentation capture run on separate jobs.
- Browser work is divided into authentication and configuration runners.
- Browser files remain serial within each group; their union is the unchanged
  full local browser suite, with no duplicated or omitted files.
- Integration installs backend/dev dependencies and does not install Chromium.
- Authentication scenarios do not prepare Docker. Configuration and capture do.
- Each runner owns its checkout, dependencies, services and temporary files.
- The aggregate check waits for all jobs, including existing application lint,
  and rejects failed, cancelled or skipped dependencies.

This removes sequential waits rather than reducing coverage. It creates four
additional worker jobs, increasing repeated setup and potentially total runner
time. Limited runner availability can reduce or eliminate the wall-clock benefit.
No extra job dependency forces the groups to queue behind one another.

The few-second tooling suite is not the principal bottleneck. Splitting the
118–136 s browser workload and overlapping integration/capture with it provide
the main opportunity. Moving tiny checks into more jobs indefinitely would not.

## Reproduce the hosted comparison

For each selected before/after run, retain its metadata, all job pages and logs:

```sh
gh api repos/zackwag/caddy-ui/actions/runs/RUN_ID > run.json
gh api --paginate --slurp repos/zackwag/caddy-ui/actions/runs/RUN_ID/jobs > jobs.json
gh run view RUN_ID --repo zackwag/caddy-ui --log > run.log
```

Record the source SHA, attempt, conclusion, runner image, Node/Chromium versions,
cache hits/misses and job/step `started_at` / `completed_at` timestamps. Compare
creation-to-aggregate elapsed time and summed job execution separately. Include
queue time and failed/retried attempts; do not compare a failed short run with a
successful full run as a performance improvement.

Compare representative successful hosted runs after the split, including cold
and warm installs. Check whether extra setup or runner queueing offsets the saved
serial work. Browser caching or further splitting should follow those results.
There is no fixed percentage improvement established by the baseline alone.

## Focused local validation

Install the development dependencies and run `npm run test:workflows` to verify
the job dependencies, browser-file inventory and aggregate failure behavior.
This check starts no services. Full service/browser commands remain documented
in `docs/src/development-caddy.md`.

On the managed Linux environment (Node 24.19.0, system Chromium 154.0.8037.57,
installed dependencies and a cached Caddy image), application/test source from
`cbeaee5d5f471e0f147d7674b11070af617698da` and the grouped commands in `030cda1`
were used. The unchanged full browser
command passed 34 scenarios in 140.1 s including npm startup. A same-host
concurrent experiment took 107.4 s, but authentication passed only 15/16 while
configuration passed 18/18. The failure was a 10 s setup-form wait in the passkey
origin-mismatch scenario. An isolated authentication-group run passed all 16
in 39.6 s, without changing assertions or timeouts.

Do not treat the failed concurrent experiment as a successful speedup. It shared
CPU, filesystem and Docker network changes, unlike the independent hosted runners
used by the workflow. It does not establish the cause of the setup timeout.
These local runs validate commands and expose a validation limit; the hosted
before/after comparison remains outstanding.

The first local integration/capture attempts also encountered the sandbox's
inherited container proxy settings: local example traffic failed or returned 403.
The unchanged TLS example passed after a temporary Docker CLI adapter added only
the owned fixture bridge and local fixture hostnames to container `NO_PROXY`.
BusyBox wget still used the proxy despite that setting, so the adapter also
removed proxy variables only for the exact capture traffic command whose names
are mapped to loopback. With this setup, all 23 integration tests and the full
documentation capture/replay test passed. That environment-only adapter is
outside the repository; it changes no assertions, fixture source, image, registry
credentials or external traffic's proxy settings. Hosted validation should use
the workflow as committed, without this sandbox adapter.

Additional local checks passed: 37 lifecycle/readiness tests, 22 playground tests,
four workflow contract tests, development lint, actionlint and the mdBook build.
