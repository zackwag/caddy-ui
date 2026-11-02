import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateInventory } from './history-backfill.mjs';
import { groupBooks, validateBookAssets, validateBookResults } from './history-books.mjs';
import { options } from './history-inventory.mjs';

export const archiveTag = 'documentation-history-archive';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const checkpointName = /^history-([a-f0-9]{64})\.json$/;
const entries = ['backfill.json', 'books', 'logs', 'groups.json', 'report.md', 'grouping-config.json'];

export function validateArchive(directory) {
    const manifest = readJson(join(directory, 'backfill.json'));
    if (manifest.schema !== 1 || manifest.inventoryFingerprint !== digest(JSON.stringify(manifest.inventory))) {
        throw new Error('Invalid archive inventory fingerprint');
    }
    validateInventory(manifest.inventory);
    validateBookResults(directory, manifest.inventory, manifest.results);
    const grouping = readJson(join(directory, 'grouping-config.json'));
    const groups = readJson(join(directory, 'groups.json'));
    if (groups.schema !== 1 || !isDeepStrictEqual(groups.releases, groupBooks(manifest.inventory.releases, manifest.results, grouping))) {
        throw new Error('Archive grouping does not match its inventory');
    }
    const books = manifest.results.filter(result => result.status === 'built');
    if (!books.length) {
        throw new Error('Refusing to preserve an archive with no successful books');
    }
    for (const fingerprint of new Set(books.map(book => book.fingerprint))) {
        validateBookAssets(join(directory, 'books', fingerprint));
    }
    const catalogDigest = digest(JSON.stringify({ releases: manifest.inventory.releases, results: manifest.results, grouping }));
    return { manifest, catalogDigest };
}

function checkpoint(store) {
    const assets = store.list();
    const latest = assets?.filter(asset => checkpointName.test(asset.name))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0];
    if (!latest) {
        return null;
    }
    const directory = mkdtempSync(join(tmpdir(), 'history-checkpoint-'));
    try {
        const path = join(directory, latest.name);
        store.download(latest, path);
        const value = readJson(path);
        const hash = checkpointName.exec(latest.name)[1];
        if (value.schema !== 1 || value.archive?.sha256 !== hash || value.archive.name !== `history-${hash}.tar.gz`
            || !Number.isSafeInteger(value.archive.bytes) || value.archive.bytes <= 0
            || !/^[a-f0-9]{64}$/.test(value.catalogDigest)) {
            throw new Error('Invalid historical archive checkpoint');
        }
        const archive = assets.find(asset => asset.name === value.archive.name);
        if (!archive) {
            throw new Error('Archive checkpoint has no corresponding payload');
        }
        return { value, archive };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

function extractArchive(path, directory, expected) {
    if (statSync(path).size !== expected.bytes || digest(readFileSync(path)) !== expected.sha256) {
        throw new Error('Archive payload checksum or size does not match its checkpoint');
    }
    // Extract only regular files/directories from the expected archive roots.
    // Python's data filter also rejects paths escaping the destination.
    execFileSync('python3', ['-c', `
import pathlib, sys, tarfile
allowed = set(sys.argv[3:])
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive.getmembers():
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in allowed:
            raise ValueError('Unexpected archive path: ' + member.name)
        if not (member.isfile() or member.isdir()):
            raise ValueError('Unsupported archive entry: ' + member.name)
    archive.extractall(sys.argv[2], filter='data')
`, path, directory, ...entries], { stdio: 'pipe' });
    const result = validateArchive(directory);
    if (result.catalogDigest !== expected.catalogDigest) {
        throw new Error('Archive catalog does not match its checkpoint');
    }
}

export function restoreArchive({ directory, store, bootstrap = false }) {
    if (existsSync(directory)) {
        throw new Error('Restore requires an absent output directory');
    }
    const saved = checkpoint(store);
    if (!saved) {
        if (!bootstrap) {
            throw new Error('No preserved archive exists; run an explicit bootstrap first');
        }
        return false;
    }
    mkdirSync(dirname(directory), { recursive: true });
    const temporary = mkdtempSync(join(dirname(directory), '.history-restore-'));
    try {
        const payload = join(temporary, 'archive.tar.gz');
        const unpacked = join(temporary, 'unpacked');
        mkdirSync(unpacked);
        store.download(saved.archive, payload);
        extractArchive(payload, unpacked, { ...saved.value.archive, catalogDigest: saved.value.catalogDigest });
        renameSync(unpacked, directory);
        return true;
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

export function publishArchive({ directory, grouping, store, sourceCommit, force = false }) {
    if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
        throw new Error('A full source commit is required');
    }
    writeFileSync(join(directory, 'grouping-config.json'), readFileSync(grouping));
    const { manifest, catalogDigest } = validateArchive(directory);
    const previous = checkpoint(store);
    if (!force && previous?.value.catalogDigest === catalogDigest) {
        return { published: false, checkpoint: previous.value };
    }
    const temporary = mkdtempSync(join(tmpdir(), 'history-publish-'));
    try {
        const payload = join(temporary, 'archive.tar.gz');
        execFileSync('tar', ['-czf', payload, '-C', directory, ...entries], { stdio: 'pipe' });
        const bytes = statSync(payload).size;
        if (bytes > 2_000_000_000) {
            throw new Error('Historical archive exceeds the release-asset size limit');
        }
        const sha256 = digest(readFileSync(payload));
        const archive = { name: `history-${sha256}.tar.gz`, sha256, bytes };
        const unpacked = join(temporary, 'verify');
        mkdirSync(unpacked);
        extractArchive(payload, unpacked, { ...archive, catalogDigest });
        const built = manifest.results.filter(result => result.status === 'built').length;
        const value = { schema: 1, catalogDigest, sourceCommit, archive,
            releases: manifest.inventory.releases.length, built,
            failed: manifest.results.filter(result => result.status === 'failed').map(result => result.tag) };
        const archivePath = join(temporary, archive.name);
        renameSync(payload, archivePath);
        const checkpointPath = join(temporary, `history-${sha256}.json`);
        writeFileSync(checkpointPath, JSON.stringify(value, null, 2) + '\n');
        store.upload(archivePath, sourceCommit);
        // Upload the checkpoint last: an interrupted payload upload is never
        // advertised as the latest complete archive. Existing assets stay intact.
        store.upload(checkpointPath, sourceCommit);
        return { published: true, checkpoint: value };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

export function githubStore(repository) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
        throw new Error('Expected an explicit owner/repository for archive storage');
    }
    const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    function release() {
        try {
            return JSON.parse(gh(['api', `repos/${repository}/releases/tags/${archiveTag}`]));
        } catch (error) {
            if (error.stderr?.toString().includes('(HTTP 404)')) {
                return null;
            }
            throw error;
        }
    }
    const store = {
        list() {
            const current = release();
            if (!current) {
                return null;
            }
            const assets = [];
            for (let page = 1; ; page++) {
                const batch = JSON.parse(gh(['api', `repos/${repository}/releases/${current.id}/assets?per_page=100&page=${page}`]));
                assets.push(...batch);
                if (batch.length < 100) {
                    return assets;
                }
            }
        },
        download(asset, destination) {
            const file = openSync(destination, 'w');
            try {
                execFileSync('gh', ['api', `repos/${repository}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream'],
                    { stdio: ['ignore', file, 'pipe'] });
            } finally {
                closeSync(file);
            }
        },
        upload(path, sourceCommit) {
            if (!release()) {
                gh(['release', 'create', archiveTag, '--repo', repository, '--target', sourceCommit,
                    '--title', 'Historical documentation archive', '--prerelease',
                    '--notes', 'Backfilled documentation books, provenance and logs. Archive storage only; no application release or Pages deployment.']);
            }
            const existing = store.list().find(asset => asset.name === basename(path));
            if (existing) {
                const temporary = mkdtempSync(join(tmpdir(), 'history-existing-'));
                try {
                    const saved = join(temporary, existing.name);
                    store.download(existing, saved);
                    if (digest(readFileSync(saved)) !== digest(readFileSync(path))) {
                        throw new Error(`Refusing to replace an existing archive asset: ${existing.name}`);
                    }
                    return;
                } finally {
                    rmSync(temporary, { recursive: true, force: true });
                }
            }
            gh(['release', 'upload', archiveTag, path, '--repo', repository]);
        },
    };
    return store;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const args = options(process.argv.slice(3), ['repository', 'output', 'grouping', 'source-commit', 'bootstrap', 'force']);
        const directory = resolve(args.output || '.docs-history');
        const store = githubStore(args.repository);
        for (const key of ['bootstrap', 'force']) {
            if (args[key] !== undefined && !['true', 'false'].includes(args[key])) {
                throw new Error(`--${key} must be true or false`);
            }
        }
        if (process.argv[2] === 'restore') {
            console.log(restoreArchive({ directory, store, bootstrap: args.bootstrap === 'true' })
                ? 'Restored and verified the preserved archive' : 'Explicit bootstrap: starting the first archive');
        } else if (process.argv[2] === 'publish') {
            const result = publishArchive({ directory, store, grouping: resolve(args.grouping || 'docs/history/groups.json'),
                sourceCommit: args['source-commit'], force: args.force === 'true' });
            console.log(result.published ? `Preserved ${result.checkpoint.built} books; ${result.checkpoint.failed.length} failed releases remain explicit`
                : 'No archive changes; existing release assets retained');
        } else {
            throw new Error('Expected restore or publish');
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
