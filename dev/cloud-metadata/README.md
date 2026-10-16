# Cloud metadata endpoint enrichment

[Read the checked-in comparison](results/README.md). It combines a small provider-documented reference for AWS, Google and Alibaba with endpoint candidates from a pinned [Canonical cloud-init](https://github.com/canonical/cloud-init) commit.

This supports review of [webhook destination policy (#272)](https://github.com/zackwag/caddy-ui/pull/272). Cloud-init has no authoritative, exhaustive metadata endpoint registry. Its datasource implementations are useful evidence, alongside provider documentation. This tool does not change application behavior or generate a runtime blocklist.

## Run

Requires Git and Python 3.10 or newer; npm only forwards commands. No Python or npm dependencies need installing for this tool.

From the repository root, fetch and inspect the exact revision used in the checked-in report:

```bash
npm run dev:cloud-metadata -- --ref 2e29ad07daced32d3fac1cb2aa93b817fe12b291
npm run test:cloud-metadata
```

An existing Canonical checkout works offline if it contains that commit:

```bash
npm run dev:cloud-metadata -- \
  --checkout /path/to/cloud-init \
  --ref 2e29ad07daced32d3fac1cb2aa93b817fe12b291 \
  --output /tmp/cloud-metadata-comparison
```

The default output is `dev/cloud-metadata/results/`, containing a GitHub-readable `README.md` and `snapshot.json`. Network mode fetches the specified commit from Canonical into a temporary Git repository and cleans it up on completion or failure. Each Git operation has a 60-second timeout. It never contacts metadata endpoints.

Local mode requires the checkout's `origin` to identify `canonical/cloud-init` on GitHub, then reads Git blobs at the requested commit. Uncommitted changes are ignored. This checks the declared remote; it is not cryptographic proof of origin. Use a trusted checkout. A full commit SHA is required; moving branch names are rejected.

## Reading the result

- **Reference:** Six provider-documented endpoint entries (five distinct hosts), with documentation links, verification date and availability notes. Google's IPv6 endpoint is retained even though it is absent from the pinned source.
- **Candidates:** HTTP(S) string literals with IP authorities or metadata hostnames, grouped by normalized host. Every observation links to the pinned source file and line. A host match does not prove provider-specific coverage because providers share addresses.
- **Manual review:** Dynamic authorities, scoped IPv6 and other hostname URLs. These can include local transports, documentation and namespace URLs. They are retained to expose the extractor's limits.
- **Provenance:** The JSON includes the upstream SHA, scanner schema version, literals, reference data and SHA-256 hashes of the UTF-8 source text read from Git.

The collector parses Python syntax without importing, executing or evaluating cloud-init code. It scans `cloudinit/sources/**/*.py`, excludes comments/docstrings and does not evaluate calls or string interpolation. Static authorities with templated paths are accepted; dynamic authorities and scoped IPv6 need manual review. This is intentionally incomplete, and even extracted literals may be false positives. Malformed upstream Python, missing datasource files, an empty extraction or invalid reference data fail before writing reports. Collection is deterministic for identical source, reference and collector version.

## Updating evidence

1. Select a new full commit SHA from Canonical; preserve the old report in Git history.
2. Run the collector and inspect candidate changes and manual-review entries.
3. Verify additions against provider documentation. Update `reference.json` and its date only after checking the sources; do not promote candidates automatically.
4. Run tests, regenerate both report files and commit the tool, reference and report changes together when applicable.

New metadata addresses do not imply all private addresses should be blocked. LAN webhooks are intentional. Any runtime proposal should separately consider specific known metadata addresses, DNS answer validation, connection pinning, redirects and the application's actual threat model. The runtime never reads these files; no scheduled workflow is added.
