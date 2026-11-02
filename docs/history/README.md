# Versioned online documentation

This implements the online documentation part of
[#288](https://github.com/zackwag/caddy-ui/issues/288): historical collection,
incremental release crawling, Pages publication and version selection. The Help
button inside caddy/ui and bundling offline documentation remain separate work.

The [collection report](collection-report.md) records an earlier v2.20.0–v3.7.0
backfill: 55 candidates, 54 complete books and 47 byte-distinct snapshots. It is
build evidence, not confirmation that the generated files are still retained.
A fresh archive run records its own current results. v3.0.0 was flagged
because its legacy screenshot fixture reports an unauthenticated installation;
the renderer skips failed readiness checks and captures the wrong view. Failed
renders retain their source identity and logs for a reviewed repair or fallback.

## Preserve books without deploying the site

Generated books are never committed. The Historical documentation archive Action
stores complete `.docs-history/` bundles in the dedicated
[`documentation-history-archive` prerelease in the owner's fork](https://github.com/juscghwe/caddy-ui/releases/tag/documentation-history-archive).
Archive collection runs in `juscghwe/caddy-ui`; the published documentation is
built and hosted by `zackwag/caddy-ui`. The public release assets are the handoff
between them. Git retains the tooling, inventory evidence and grouping decisions.

Bootstrap through the fork's default-branch Documentation workflow:

```sh
gh workflow run docs.yml --repo juscghwe/caddy-ui \
  --ref main \
  -f archive_history=true -f bootstrap=true
```

`archive_history=true` skips both the normal site build and Pages deployment.
Later manual crawls use the same command without `bootstrap=true`. Add
`-f retry_failed=true` to explicitly retry failed renders; successful snapshots
are always reused after integrity checks. Bootstrap permits an absent archive,
but never bypasses a corrupted archive or an authentication failure.

Each immutable `history-<sha256>.tar.gz` contains raw books, `backfill.json`,
`groups.json`, the grouping configuration, report and build logs. Its matching
JSON checkpoint records the complete payload's SHA-256, size, tool-source commit
and build/failure counts. A checkpoint is uploaded only after its payload, and
older assets are retained. Each bundle is unpacked and verified before upload;
restores verify the payload, every snapshot fingerprint, asset references and
release/grouping provenance before making it available to the crawler. Unchanged
release inventories create no additional assets and skip installing rendering
dependencies and Chromium. Fresh retries can explicitly
preserve updated diagnostics even when their outcome remains unchanged.

The fork's Documentation workflow accepts an explicit collection request. Its
`archive` job pins both the reusable workflow and `tooling_ref` to the same
reviewed full commit. Writers queue under one concurrency group with
`queue: max`, so multiple pending requests wait instead of replacing each other.
GitHub limits that queue to 100 pending runs; requests beyond it are cancelled.
The archive job rejects PR events and storage outside the owner's fork. Its write token is
exposed only to restore/upload steps, never to historical build scripts. The
archive tag is not a `v*` release. The fork has no independent scheduled work.

## Release handoff and setup

After a successful `Release` run in `zackwag/caddy-ui`, the upstream Documentation
workflow dispatches `docs.yml` on the archive fork's `main`, passing
`archive_history=true` and requesting `return_run_details=true` from the API.
Collection and archive storage stay in the fork. The upstream workflow polls the
returned `workflow_run_id` directly until that run succeeds, then restores the
archive, assembles the site and deploys Pages. It never accepts an unrelated
successful crawl as completion of its own request.

Dispatch is attempted exactly once, including when its response is ambiguous.
Status reads tolerate three consecutive API failures; a successful read resets
that budget. A fourth consecutive failure, invalid response, unsuccessful run,
cancellation or a 95-minute wait timeout stops publication. This avoids deploying
the previous archive as a coordinated release update.

A weekly upstream catch-up runs the same collect-then-publish path every Monday
at 04:17 UTC. It waits for its own dispatched run before restoring the archive,
so collection and publication cannot race on separate schedules. The fork does
no scheduled work. Catch-up retries missed releases after transient failures;
it cannot renew an expired or revoked token. Renew that token before expiry and
use a fresh manual coordinated run after repairing persistent failures.

Before enabling the release handoff:

1. Merge the workflow change upstream, then immediately sync the fork's `main`,
   before the next release or coordinated manual run. This activates the updated
   concurrency settings and removes the fork's former daily trigger. Both
   repositories use the same workflow definition; the repository and event
   determine which jobs run. The reusable collector and its tooling remain
   pinned together to a reviewed full commit containing the queue fix.
2. Create a fine-grained token selecting only `juscghwe/caddy-ui`, with repository
   **Actions: read and write**. The upstream workflow needs it to dispatch and
   observe the fork's run; GitHub's built-in token cannot dispatch across
   repositories. Collection continues using the fork's own token for release
   asset uploads.
3. Save that token as the **upstream** Actions secret
   `DOCS_ARCHIVE_DISPATCH_TOKEN` before the next release. For example, this command
   prompts for the value without putting it in a command argument:

   ```sh
   gh secret set DOCS_ARCHIVE_DISPATCH_TOKEN --repo zackwag/caddy-ui
   ```

The dispatch token is available only in the trusted-main coordination job. It is
not passed to PR previews, historical renderers or the publishing job. Missing
configuration fails with an explicit setup error. This handoff does not require
a callback token with write access to the upstream repository.

For a manual collection followed by publication, start a fresh upstream run:

```sh
gh workflow run docs.yml --repo zackwag/caddy-ui --ref main -f collect_history=true
```

A plain manual run without `collect_history=true` republishes the already
preserved archive. Fork-only bootstrap/retry commands above remain available for
archive maintenance and do not deploy the site.

Restore a saved archive locally with GitHub CLI, Node 24, the documentation
dependencies, Python 3.12+ and `tar` installed:

```sh
node docs/scripts/history-archive.mjs restore --repository juscghwe/caddy-ui
```

Restore requires an absent `.docs-history/` directory. Actions caches and
diagnostic artifacts are not the durable archive. A normal crawl fails if its
preserved archive is missing rather than silently recreating different renders.

## Release and image evidence

The first mdBook implementation is `4dee6c9`; its first release is **v2.20.0**
(`aeb981f`). `releases.json` records stable release tags and their resolved source
commits, along with separate frontend/backend publication records. Each image
entry points to the earliest `versions`-branch commit retaining that version.
An absent component publication is `null`, never inferred from the release tag.

Docker image versions inherit release numbers when that component builds.
Components can skip releases independently. Mutable `latest`, major/minor, edge
and beta tags are not historical stable-version identities. The current update
feed keeps only 20 entries per component/channel; inventory scans the complete
history instead. Publication records are evidence of a reported successful push,
not a check that an image is still available in Docker Hub today.

Refresh the local upstream refs and inventory from the repository root:

```sh
git fetch https://github.com/zackwag/caddy-ui.git --tags refs/heads/main:refs/remotes/upstream/main refs/heads/versions:refs/remotes/upstream/versions
npm run docs:history:inventory -- --from v2.20.0 --to refs/remotes/upstream/main
```

The command uses stable tags reachable from the selected source boundary.
Review and commit inventory updates separately from tooling changes. Releases
before v2.20.0 appear in the selector with a release-notes fallback.

## Build the historical books

Use Node 22.12 or newer, npm, Git and mdBook **0.5.4**. Install this checkout's
documentation tooling with `npm ci --prefix docs --ignore-scripts`. Later releases
also need a Playwright browser; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select a
compatible system Chromium, as with the existing screenshot command.

```sh
npm run docs:history:backfill
# Or select a binary and a subset of releases, including retries:
npm run docs:history:backfill -- --mdbook /path/to/mdbook --releases v2.20.0,v3.7.0
```

Each release gets a detached temporary worktree. The builder installs its locked
documentation dependencies and, when necessary, its frontend/development
dependencies using `npm ci --ignore-scripts`. It runs that release's screenshot
renderer and coverage generator before building its book. Earlier releases use
their committed screenshots. No current-book text or assets are substituted.
The current dev checkout and its running services are not switched or stopped.

These are **backfilled renders**, not copies of the original deployed Pages
artifacts. Generated screenshots reflect the release's renderer/capture and the
browser used today. Historical frontend prebuilds can fetch the Caddyfile syntax
asset; its resulting SHA-256 is recorded. Lockfiles, source commits and tool
versions provide provenance, but external inputs can prevent identical rerenders.
Run historical scripts only for trusted release sources and retain the results.

Output defaults to ignored `.docs-history/`:

- `backfill.json`: release inventory, individual build results and provenance.
- `books/<sha256>/`: complete rendered snapshots, with exact duplicates stored once.
- `logs/<tag>.log`: dependency, renderer and mdBook output for each attempt.
- `groups.json`: every release's selected snapshot and grouping reason.
- `report.md`: build status, component image mappings and duplicate summary.

The builder checks local HTML media/styles/scripts and search-index presence.
Failures remain explicit, other releases continue, and the command exits with a
failure status. Completed results are checkpointed after each release. A subset
retry preserves other results for the same inventory. Changing the inventory
requires a separate `--output` directory. Worktrees are removed on success,
failure and handled cancellation; the output archive is retained.

## Share books deliberately

Exact grouping hashes **every output path and byte**, including media and search.
Publication labels and URLs are not injected at this stage; books use the same
neutral `/` site URL. Wording, whitespace and generated repository-tree changes
all count. Identical authored Markdown alone does not prove identical books.

For a wording-only difference, first compare both successful builds, for example:

```sh
diff -ru .docs-history/books/FIRST_SHA256 .docs-history/books/SECOND_SHA256
git diff FIRST_RELEASE SECOND_RELEASE -- README.md docs
```

Then record a reviewed decision in `groups.json` **in this directory**, using
real inventory tags. This example illustrates the schema, not an approved alias:

```json
{
    "schema": 1,
    "aliases": {
        "v2.20.1": {
            "target": "v2.20.0",
            "reason": "Describe the reviewed differences and why this book remains accurate."
        }
    }
}
```

Regenerate the report without rebuilding:

```sh
npm run docs:history:report
```

Both books must have built successfully; unknown targets, cycles, empty reasons
and altered/missing snapshot bytes are rejected. The original fingerprints and
books remain in the archive. Grouping changes only the selected snapshot, while
each release and component-image mapping retains its provenance. Commit the
grouping decision with its review reason. No wording-based grouping is automatic.

Run `npm test --prefix docs` for inventory, grouping, integrity, failure/retry and
existing documentation-tooling regressions. Keep the generated archive outside
Git; archive it with its manifests and logs before discarding the local output.

## Crawl future releases

After refreshing the upstream refs, reuse an existing archive with:

```sh
npm run docs:history:crawl -- --to refs/remotes/upstream/main
# Explicitly retry unavailable books, without rerendering successful snapshots:
npm run docs:history:crawl -- --to refs/remotes/upstream/main --retry-failed true
```

The crawler discovers stable tags reachable from upstream `main`, refreshes each
component's publication evidence, verifies the previous manifest and snapshot
bytes, and builds only newly discovered releases. Changed or removed source tags
and corrupted cached books stop the crawl. Known failed books remain recorded
until an explicit retry; they get release-note links rather than current docs.
The crawler succeeds with these documented fallbacks, while the lower-level
`history:backfill` command retains its failure exit status for a failed render.

In the upstream repository, the Documentation workflow publishes on main updates,
completion of successful local Release runs, weekly catch-up, and manual dispatch.
Release and weekly runs first request and wait for collection as described above;
ordinary development updates and PR previews restore the preserved archive
without requesting a crawl.
All Documentation runs, including PR previews, use `queue: max` with cancellation
disabled. Site runs queue by ref, separately from fork archive requests; the
reusable collector also queues all writers together. A later push, release or
manual request cannot replace an already pending run. Queue time counts toward
the upstream collection wait, so a long backlog can still reach its timeout.

The publisher restores the latest complete archive from `juscghwe/caddy-ui`,
verifying the payload checksum, snapshot bytes and provenance before assembly.
It never crawls or rerenders historical releases, and needs only read access to
the public archive. It refreshes release and component-publication metadata
independently: ordinary development updates may list a new release before its
collection completes. A coordinated release publication requires a recorded
result for every discovered release; an uncollected release fails assembly
before replacing the site. Recorded historical rendering failures still get an
explicit release-notes fallback. Changed or removed archived source tags fail
publication. If a new release tag appears after collection finishes but before
the publisher discovers releases, `--require-collected` can stop that earlier
publication. The later release's coordinated run (or weekly catch-up) collects
the missing release and retries publication.

The archive owner is an intentional external dependency, not the Pages host.
Repository maintainers can set the Actions variable `DOCS_ARCHIVE_REPOSITORY`
to a reviewed replacement with the same archive format and `docs.yml` dispatch
protocol. This selects both the dispatch destination and archive storage; the
dispatch token must independently have access to that repository. Changing the
variable grants no permissions and does not run collection in the upstream repo.
Missing, unavailable or corrupted archives fail the build, leaving the previous
Pages deployment in place. There is no fallback that recreates historical books
with potentially different assets. Preview and diagnostic artifacts still expire
according to Actions retention; the release assets remain the durable source.

PRs, forks and manual runs on feature branches produce preview artifacts.
Only main-ref publication runs in a non-fork repository can deploy Pages.
A `workflow_run` trigger checks the source repository and checks out main,
never the triggering run's code or artifacts. The build job has read-only repository
permissions; Pages write permission belongs only to the deployment job.

## Assemble and preview the published site

Build the current development book normally, then assemble the site:

```sh
MDBOOK_OUTPUT__HTML__SITE_URL=/ mdbook build docs
npm run docs:history:inventory -- --to refs/remotes/upstream/main --output /tmp/documentation-releases.json
npm run docs:history:site -- --base / --inventory /tmp/documentation-releases.json
python3 -m http.server 8000 --bind 127.0.0.1 --directory .docs-site
```

Open `http://localhost:8000`. `mdbook serve` remains useful for editing prose;
version navigation is attached by the publication assembler. For project Pages,
use `--base /caddy-ui/` instead of `/`; the workflow derives this from the repository
name and also supports a user/organization Pages root.

The ignored `.docs-site/` directory contains:

| Path relative to the Pages site | Purpose |
| --- | --- |
| `/` and `/dev/` | Clearly labelled development documentation; old root chapter URLs keep working |
| `/documentation.json` | Release, image-publication and source-commit catalogue |
| `/books/<sha256>/` | One complete book per selected source fingerprint |
| `/versions/<tag>/` | Stable release permalink, resolving to its book or release notes |
| `/resolve.html` | Installed-version resolver for future integration links |

The assembler checks the complete archive before replacing an existing local site.
It decorates copies with shared navigation; raw archived files and their hashes
remain unchanged. Historical source links point at the source commit. Identical
books share assets and search indexes, while the selected release is retained in
the URL across chapter and search navigation. When a selected version lacks the
current chapter, its home page explains the fallback.

The resolver accepts either `?version=3.7.0` or independent
`?frontend=3.6.8&backend=3.7.0` parameters. Matching component versions open the
matching book; differing versions show two explicitly labelled choices. Component
matching requires a recorded publication for that component. `dev`, `edge`, `beta`
and their commit-suffixed build labels select development docs. Known releases
without a book open their release notes; unknown stable versions open the release
list, never a falsely version-matched development book. Malformed values show a
version chooser. Optional `page=configuration.html` and a fragment preserve a
chapter/anchor only when that chapter exists in the target book.

After installing the shared dev package and its Playwright browser, run:

```sh
npm run test:docs:history:browser -- --site "$PWD/.docs-site" --base /
```

This checks the oldest/newest books, images and search, shared-book selection,
chapter/anchor preservation, unavailable releases, mismatched component versions,
development builds and the mobile version label. It also works under the project
Pages prefix. The workflow performs this check before deploying.
