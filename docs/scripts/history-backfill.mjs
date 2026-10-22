import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fingerprintBook, validateBookAssets, validateBookResults, writeBookReport } from './history-books.mjs';
import { git, options, repository } from './history-inventory.mjs';

const exec = promisify(execFile);
const digest = value => createHash('sha256').update(value).digest('hex');
const releaseTag = /^v\d+\.\d+\.\d+$/;
const commitId = /^[a-f0-9]{40}$/;

export function validateInventory(inventory) {
    if (inventory.schema !== 1 || inventory.repository !== repository || !Array.isArray(inventory.releases)
        || !commitId.test(inventory.throughCommit) || !commitId.test(inventory.publicationsCommit)
        || new Set(inventory.releases.map(release => release.tag)).size !== inventory.releases.length) {
        throw new Error('Invalid historical release inventory');
    }
    for (const release of inventory.releases) {
        if (!releaseTag.test(release.tag) || !commitId.test(release.commit) || typeof release.hasBook !== 'boolean'
            || !release.images || !['frontend', 'backend'].every(component => release.images[component] === null
                || release.images[component]?.version === release.tag.slice(1) && commitId.test(release.images[component]?.recordedAt))) {
            throw new Error(`Invalid release inventory entry: ${release.tag}`);
        }
    }
}

function writeJson(path, data) {
    writeFileSync(path + '.tmp', JSON.stringify(data, null, 2) + '\n');
    renameSync(path + '.tmp', path);
}

export async function backfill({ root, inventory, output, mdbook = 'mdbook', selected, grouping, signal, notify = console.log,
    reuse = false, retryFailed = false }) {
    validateInventory(inventory);
    const tags = selected ? selected.split(',') : inventory.releases.map(release => release.tag);
    if (!tags.length || new Set(tags).size !== tags.length || tags.some(tag => !inventory.releases.some(release => release.tag === tag))) {
        throw new Error('--releases must contain distinct inventory tags separated by commas');
    }
    const { stdout } = await exec(mdbook, ['--version'], { timeout: 10000, signal });
    if (stdout.trim() !== 'mdbook v0.5.4') throw new Error('Backfill requires mdBook 0.5.4, matching the historical documentation workflow');
    const tools = `${stdout.trim()}, Node ${process.version}, npm ${(await exec('npm', ['--version'], { timeout: 10000, signal })).stdout.trim()}`;
    mkdirSync(output, { recursive: true });
    const lock = join(output, '.lock');
    mkdirSync(lock); // Never let concurrent invocations overwrite one another's results.
    const inventoryFingerprint = digest(JSON.stringify(inventory));
    const manifestPath = join(output, 'backfill.json');
    let results = [];
    try {
        if (existsSync(manifestPath)) {
            const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
            if (previous.schema !== 1 || !previous.inventory || previous.inventoryFingerprint !== digest(JSON.stringify(previous.inventory))) {
                throw new Error('Invalid historical archive manifest');
            }
            if (previous.inventoryFingerprint !== inventoryFingerprint && !reuse) {
                throw new Error('Output belongs to a different inventory; choose another --output directory');
            }
            if (reuse) {
                validateInventory(previous.inventory);
                validateBookResults(output, previous.inventory, previous.results);
                for (const release of previous.inventory.releases) {
                    if (inventory.releases.find(entry => entry.tag === release.tag)?.commit !== release.commit) {
                        throw new Error(`Archived release source changed or disappeared: ${release.tag}`);
                    }
                }
            }
            results = previous.results;
        }
        mkdirSync(join(output, 'logs'), { recursive: true });
        mkdirSync(join(output, 'books'), { recursive: true });
        function checkpoint() {
            writeJson(manifestPath, { schema: 1, inventoryFingerprint, inventory, results });
        }
        checkpoint();
        for (const release of inventory.releases.filter(release => tags.includes(release.tag))) {
            signal?.throwIfAborted();
            const previous = results.find(result => result.tag === release.tag);
            if (reuse && previous && (previous.status === 'built' || !retryFailed)) continue;
            notify(`Backfilling ${release.tag} (${release.commit.slice(0, 7)})`);
            const temporary = mkdtempSync(join(tmpdir(), 'caddy-book-backfill-'));
            const checkout = join(temporary, 'source');
            const log = join(output, 'logs', release.tag + '.log');
            writeFileSync(log, `${release.tag} ${release.commit}\n${tools}\n`);
            let registered = false;
            let stage = 'checkout';
            let result;
            async function run(command, args, timeout = 120000) {
                writeFileSync(log, `\n$ ${command} ${args.join(' ')}\n`, { flag: 'a' });
                try {
                    const response = await exec(command, args, { cwd: checkout, timeout, signal,
                        maxBuffer: 16 * 1024 * 1024, env: { ...process.env, MDBOOK_OUTPUT__HTML__SITE_URL: '/' } });
                    writeFileSync(log, response.stdout + response.stderr, { flag: 'a' });
                    return response.stdout + response.stderr;
                } catch (error) {
                    writeFileSync(log, (error.stdout || '') + (error.stderr || '') + '\n' + error.message + '\n', { flag: 'a' });
                    throw error;
                }
            }
            try {
                if (!release.hasBook) throw new Error('Release has no docs/book.toml');
                if (git(root, ['rev-parse', '--verify', `${release.tag}^{commit}`]) !== release.commit) throw new Error('Release tag no longer matches inventory');
                git(root, ['worktree', 'add', '--quiet', '--detach', checkout, release.commit]);
                registered = true;
                stage = 'documentation dependencies';
                await run('npm', ['ci', '--prefix', 'docs', '--ignore-scripts', '--no-audit', '--no-fund']);
                const frontend = existsSync(join(checkout, 'src/frontend/package.json')) ? 'src/frontend' : 'frontend';
                const renderer = existsSync(join(checkout, 'docs/screenshots/screenshot.mjs'));
                if (renderer) {
                    stage = 'screenshot dependencies';
                    await run('npm', ['ci', '--prefix', frontend, '--ignore-scripts', '--no-audit', '--no-fund']);
                    if (existsSync(join(checkout, 'dev/package.json'))) {
                        await run('npm', ['ci', '--prefix', 'dev', '--ignore-scripts', '--no-audit', '--no-fund']);
                    }
                    stage = 'historical screenshot renderer';
                    const rendered = await run(process.execPath, ['docs/screenshots/screenshot.mjs']);
                    if (/Warning: ready selector|Page errors during capture/.test(rendered)) {
                        throw new Error('Historical renderer skipped page readiness; screenshots require review');
                    }
                }
                const coverage = existsSync(join(checkout, frontend, 'scripts/localization.mjs'));
                if (coverage) {
                    stage = 'historical localization coverage';
                    await run(process.execPath, [frontend + '/scripts/localization.mjs', 'coverage']);
                }
                stage = 'mdBook';
                await run(mdbook, ['build', 'docs'], 60000);
                const book = join(checkout, 'docs/book');
                stage = 'local book assets';
                validateBookAssets(book);
                const fingerprint = fingerprintBook(book);
                const destination = join(output, 'books', fingerprint);
                if (existsSync(destination)) {
                    if (fingerprintBook(destination) !== fingerprint) throw new Error('Existing snapshot bytes do not match their fingerprint');
                } else {
                    cpSync(book, destination + '.tmp', { recursive: true });
                    renameSync(destination + '.tmp', destination);
                }
                const mode = join(checkout, frontend, 'src/lib/caddyfileMode.js');
                result = { tag: release.tag, commit: release.commit, status: 'built', fingerprint, tools,
                    screenshots: renderer ? 'regenerated at backfill time from the release renderer/capture' : 'committed release assets',
                    coverage: coverage ? 'regenerated from release catalogs' : 'not present in release',
                    ...(existsSync(mode) ? { fetchedSyntaxAsset: { path: frontend + '/src/lib/caddyfileMode.js', sha256: digest(readFileSync(mode)) } } : {}) };
            } catch (error) {
                if (signal?.aborted) throw error;
                result = { tag: release.tag, commit: release.commit, status: 'failed', error: `${stage}: ${error.code || error.message.split('\n')[0]}` };
                notify(`  Failed: ${result.error}; see logs/${release.tag}.log`);
            } finally {
                try { if (registered) git(root, ['worktree', 'remove', '--force', checkout]); }
                finally { rmSync(temporary, { recursive: true, force: true }); }
            }
            results = inventory.releases.map(entry => entry.tag === release.tag ? result : results.find(previous => previous.tag === entry.tag)).filter(Boolean);
            checkpoint();
        }
        const groups = writeBookReport(output, inventory, results, grouping);
        return { results, groups };
    } finally {
        rmSync(lock, { recursive: true });
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const controller = new AbortController();
    const stop = () => controller.abort(new Error('Backfill interrupted'));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
        const args = options(process.argv.slice(2), ['repo', 'inventory', 'output', 'mdbook', 'releases', 'grouping']);
        const root = resolve(args.repo || fileURLToPath(new URL('../..', import.meta.url)));
        const inventory = JSON.parse(readFileSync(resolve(args.inventory || join(root, 'docs/history/releases.json')), 'utf8'));
        const grouping = JSON.parse(readFileSync(resolve(args.grouping || join(root, 'docs/history/groups.json')), 'utf8'));
        const { results } = await backfill({ root, inventory, grouping, output: resolve(args.output || join(root, '.docs-history')),
            mdbook: args.mdbook || 'mdbook', selected: args.releases, signal: controller.signal });
        if (results.some(result => result.status === 'failed')) process.exitCode = 1;
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
    }
}
