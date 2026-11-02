import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const stable = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const repository = 'zackwag/caddy-ui';

export function git(root, args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trimEnd();
}

export function compareVersions(a, b) {
    const left = a.replace(/^v/, '').split('.').map(Number);
    const right = b.replace(/^v/, '').split('.').map(Number);
    return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

// Read every historical JSON record: the current update-check list is bounded.
export function publicationHistory(root, ref) {
    const commit = git(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
    const images = { frontend: new Map(), backend: new Map() };
    const commits = git(root, ['log', '--reverse', '--format=%H', commit, '--', 'versions.json']).split('\n');
    for (const recordedAt of commits.filter(Boolean)) {
        const record = JSON.parse(git(root, ['show', `${recordedAt}:versions.json`]));
        if (record.schema !== 1 || !record.channels) throw new Error(`Unsupported publication record at ${recordedAt}`);
        for (const component of Object.keys(images)) {
            for (const version of record.channels.stable?.[component] || []) {
                if (!stable.test(version) || version.startsWith('v')) throw new Error(`Invalid stable image version at ${recordedAt}`);
                if (!images[component].has(version)) images[component].set(version, recordedAt);
            }
        }
    }
    return { commit, images };
}

export function collectInventory(root, { from = 'v2.20.0', to = 'HEAD', versionsRef = 'refs/remotes/upstream/versions' } = {}) {
    if (!stable.test(from) || !from.startsWith('v')) throw new Error('--from must be a stable vX.Y.Z tag');
    const fromCommit = git(root, ['rev-parse', '--verify', `${from}^{commit}`]);
    const throughCommit = git(root, ['rev-parse', '--verify', `${to}^{commit}`]);
    git(root, ['merge-base', '--is-ancestor', fromCommit, throughCommit]);
    const publications = publicationHistory(root, versionsRef);
    const tags = git(root, ['tag', '--merged', throughCommit]).split('\n')
        .filter(tag => tag.startsWith('v') && stable.test(tag) && compareVersions(tag, from) >= 0).sort(compareVersions);
    const releases = tags.map(tag => {
        const commit = git(root, ['rev-parse', '--verify', `${tag}^{commit}`]);
        git(root, ['merge-base', '--is-ancestor', fromCommit, commit]);
        const version = tag.slice(1);
        const images = Object.fromEntries(Object.entries(publications.images).map(([component, records]) => [component,
            records.has(version) ? { version, recordedAt: records.get(version) } : null]));
        return { tag, commit, images, hasBook: Boolean(git(root, ['ls-tree', '--name-only', commit, '--', 'docs/book.toml'])) };
    });
    return { schema: 1, repository, from, throughCommit, publicationsCommit: publications.commit, releases };
}

export function writeInventory(path, inventory) {
    mkdirSync(dirname(path), { recursive: true });
    // One release per line keeps generated evidence reviewable in Git.
    const { releases, ...metadata } = inventory;
    const header = JSON.stringify(metadata, null, 2).slice(0, -2);
    writeFileSync(path, `${header},\n  "releases": [\n${releases.map(entry => '    ' + JSON.stringify(entry)).join(',\n')}\n  ]\n}\n`);
}

export function options(args, names) {
    const values = {};
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i]?.replace(/^--/, '');
        if (!args[i]?.startsWith('--') || !names.includes(key) || !args[i + 1] || args[i + 1].startsWith('--') || key in values) {
            throw new Error(`Expected --${names.join(', --')} followed by a value; invalid argument: ${args[i]}`);
        }
        values[key] = args[i + 1];
    }
    return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const args = options(process.argv.slice(2), ['repo', 'from', 'to', 'versions-ref', 'output']);
        const root = resolve(args.repo || fileURLToPath(new URL('../..', import.meta.url)));
        if (!existsSync(resolve(root, '.git'))) throw new Error('--repo must be a Git checkout');
        const inventory = collectInventory(root, { from: args.from, to: args.to, versionsRef: args['versions-ref'] });
        const output = resolve(args.output || resolve(root, 'docs/history/releases.json'));
        writeInventory(output, inventory);
        console.log(`Recorded ${inventory.releases.length} release candidates in ${output}`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
