# E2E reliability fix candidates

Branch `fix/e-to-e` starts at measured diagnostic revision
`43de72dc9ae6098cf7161c0d8c45548e3d981124`. It intentionally retains that revision's
diagnostic tooling so comparisons can use the same scenarios and evidence rules.
It is a candidate/testing branch, not a clean application PR rebased onto newer
main. `dev/etoe-diagnostics` and the original results are unchanged.

The [baseline analysis](https://github.com/juscghwe/caddy-ui/tree/fe1ec787ace80008a186fa4724bb6b0d9b8faa12/analyses/pre-fix-2026-10-15)
describes the two retained GitHub runs, their evidence and limitations.

## Independent changes

### F2: observe notifications before unrelated document resources finish

`4ff7f6d4` changes browser navigation to `domcontentloaded`. Each existing scenario
still waits for its required editor, log view or notification. All assertions,
the six-second toast timer and ten-second element waits remain unchanged.

The baseline missed the notification in two of two local delayed-stylesheet
trials. The navigation-only commit passed three of three under the same injected
eight-second stylesheet delay. These are deterministic regression checks, not
an estimate of ordinary-suite reliability.

### F1: wait for the owned network interface before launching Chromium

`46410a0e` adds a bounded, abortable, read-only check of the owned container's
host-side interface. A tentative IPv6 link-local address must complete
duplicate-address detection. Failed detection and inspection errors fail startup.
Disabled IPv6 or address generation does not cause an impossible wait.

If the owned interface is outside Chromium's namespace, as with remote Docker,
Docker Desktop or Docker-outside-of-Docker, the check reports `not-applicable`.
It does not claim to have observed the daemon host. No host network settings,
routes, interfaces or unrelated containers are modified. No `ip` executable is
needed for this check. Linux `/sys` and `/proc` supply its local read-only state.

Eight regression cases cover tentative/ready addresses, interface ownership,
external namespaces, disabled IPv6/generation, detection/inspection failure,
timeout, cancellation and unrelated interface removal. The existing bootstrap
retry remains unchanged. `429bed17` is the follow-up guard for another container
removing its interface between enumeration and inspection.

To isolate this intervention, it was cherry-picked directly onto the baseline
as `342758c7`, without F2 or F3. Three complete suite trials passed: 24 scenario
executions, zero recorded network interruptions. All 24 readiness records were
checked for their actual applicability before interpreting these results.

This does not prevent unrelated host network changes later in a test. A shared
host or a different container's lifecycle can still invalidate Chromium's
network state. The initial fixture condition is the scope of this fix.

### F3: distinguish requested observer shutdown from missing capture

The diagnostic observer now records shutdown intent, exit code/signal and
timestamps. Requested SIGTERM/143 shutdown is retained as lifecycle evidence
without a false capture warning. Early exits, including code zero, spawn errors
and forced SIGKILL shutdown remain capture problems. Shutdown awaits pipe close
so buffered evidence can drain.

Five regression cases exercise those paths. Reports now describe the checked-out
revision instead of always claiming to be pre-fix. Source hashes additionally
cover the shared stack and lifecycle modules used by the network fix. The
evidence-classification rules and original raw results are unchanged.

## Recorded local validation

| Revision / arm | Workload | Outcome |
|---|---|---|
| Baseline `43de72dc` | Two delayed-stylesheet trials | Both reproduce the missed toast |
| Navigation only `4ff7f6d4` | Three delayed-stylesheet trials | All pass |
| Network only `342758c7` | Three complete suites / 24 scenarios | All pass; zero network interruptions |
| Combined `d211cc37` | Three trials of each profile / 33 scenarios | All pass; zero interruptions, bootstrap retries or capture warnings |
| Final code `429bed17` | Ordinary uninstrumented E2E suite | 8 / 8 pass |
| Final code `429bed17` | Real cancellation with unrelated sentinel fixture | Pass; owned resources removed and sentinel preserved |
| Final code `429bed17` | Harness/readiness and diagnostic regressions | 34 and 17 tests pass |

Frontend, harness and diagnostic lint also pass. The combined arm's 30 Caddy
readiness records are all applicable/ready; its three localhost controls create
no Caddy instance. All 66 observer processes have requested shutdown and recorded
close, with no forced termination. The follow-up enumeration guard is covered by
the final ordinary suite and its regression case; it is not retroactively part
of the earlier combined arm.

The [compact local evidence and recounting code](https://github.com/juscghwe/caddy-ui/tree/dev/etoe-diagnostic-results/analyses/fix-e-to-e-local-2026-10-15)
preserve the exact source revision for each arm. Full local trace archives are
not part of that compact publication.

## Running candidate trials

From this branch, after installing the pinned backend/frontend dependencies,
Chromium and Docker prerequisites:

```bash
npm run test:dev-caddy
npm run test:etoe-diagnostics
npm run lint:dev-caddy
npm run lint:etoe-diagnostics
npm run lint --prefix frontend -- --max-warnings=0
npm run test:dev-caddy:e2e

# Always choose a new output directory. A green collector can contain failures:
# inspect SUMMARY.md and the retained native results.
npm run diagnostics:etoe -- --trials 3 --profiles all --scope suite --output .etoe-diagnostics/candidate-1
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an installed Chromium. The local
checks use Node `v24.19.0`, Chromium `154.0.8037.57` and Docker `28.4.0`, whereas
the retained GitHub baseline used Node `v22.23.3`, Chromium `156.0.8078.4` and
Docker `28.0.4`. Local results are functional/regression evidence, not a matched
statistical comparison with those CI runs.

For a reliability claim, repeat the full suite on multiple independent CI jobs
with matching versions and balanced baseline/candidate order. Zero failures in
these small local samples is not proof of a zero failure probability. Keep clean
passes, recovered bootstrap interruptions and failed assertions distinguishable.

The dispatcher on `fix/e-to-e` accepts manual collection/publication from the
exact baseline and candidate branches: `dev/etoe-diagnostics` and `fix/e-to-e`.
Select **Actions → Test → Run workflow → fix/e-to-e**, choose **collect**, then
choose **publish** in a separate dispatch with the completed collection's run ID
and attempt. Publication from this updated branch accepts either source branch;
the historical baseline branch and its publisher remain unchanged.

This routing change does not alter required PR checks or trigger publication
automatically. Collector access stays read-only; only the separate publisher
receives write access. See the [diagnostic workflow instructions](README.md) for
copy/paste CLI commands and provenance checks.
