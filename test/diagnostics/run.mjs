import { spawn, execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { IMAGE, checkDocker } from '../../scripts/dev-caddy/harness.mjs';
import { cleanupNamespace } from './cleanup.mjs';
import { projectFor } from './observe.mjs';
import { summarize } from './analysis.mjs';

const root = resolve(import.meta.dirname, '../..');
const exec = promisify(execFile);
const PROFILES = ['normal', 'slow-style', 'settled-network', 'localhost'];
export function options(args) {
    const values = { trials: '3', seed: '12345', profiles: 'all', scope: 'suite', output: resolve(root, '.etoe-diagnostics') };
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index]?.replace(/^--/, '');
        if (!args[index]?.startsWith('--') || !Object.hasOwn(values, name) || !args[index + 1]) throw new Error('Expected --trials, --seed, --profiles, --scope or --output followed by a value');
        values[name] = args[index + 1];
    }
    if (!/^\d+$/.test(values.trials) || Number(values.trials) < 1 || Number(values.trials) > 20) throw new Error('Trials must be 1–20 per profile');
    if (!/^\d+$/.test(values.seed) || Number(values.seed) > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer');
    if (values.profiles !== 'all' && !PROFILES.includes(values.profiles)) throw new Error('Unknown diagnostic profile');
    if (!['suite', 'recovery'].includes(values.scope)) throw new Error('Scope must be suite or recovery');
    return { ...values, trials: Number(values.trials), seed: Number(values.seed), output: resolve(values.output) };
}
export function schedule(config) {
    const profiles = config.profiles === 'all' ? PROFILES : [config.profiles];
    const list = [];
    let state = config.seed;
    for (let trial = 1; trial <= config.trials; trial++) {
        const order = [...profiles];
        for (let index = order.length - 1; index > 0; index--) {
            state = (Math.imul(1664525, state) + 1013904223) >>> 0;
            const other = state % (index + 1);
            [order[index], order[other]] = [order[other], order[index]];
        }
        list.push(...order.map(profile => ({ trial, profile })));
    }
    return list;
}

async function json(path, fallback = null) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (fallback !== null) return fallback; throw error; } }
export async function cleanupTrial(directory, nonce, run) {
    const cleaned = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const path = join(directory, entry.name, 'ownership.json');
        const ownership = await json(path);
        if (ownership.project === null) continue;
        if (ownership.project !== projectFor(nonce, ownership.name)) throw new Error('Diagnostic ownership manifest does not match this trial');
        cleaned.push(await cleanupNamespace(ownership.project, run));
    }
    return cleaned;
}

function summaryMarkdown(metadata, trials) {
    const lines = ['# Pre-fix E2E diagnostic experiment', '', `Source commit: \`${metadata.commit}\`. Seed: \`${metadata.config.seed}\`.`, '',
        '**Collection status and test outcomes are separate. A green collection job does not mean these E2E trials passed.**', '',
        '| Profile | Recorded / eligible | Incomplete or unavailable | Captures with notes | Failed | Failure rate (95% Wilson interval) | Network interruptions | Passing trials with interruptions | Existing bootstrap retries | Toast signatures |', '|---|---:|---:|---:|---:|---|---:|---:|---:|---:|'];
    for (const row of summarize(trials)) {
        const interval = row.interval;
        const rate = interval ? `${(interval.rate * 100).toFixed(1)}% (${(interval.lower * 100).toFixed(1)}–${(interval.upper * 100).toFixed(1)}%)` : 'n/a';
        lines.push(`| ${row.profile} | ${row.trials} / ${row.eligible} | ${row.incomplete} | ${row.captureNotes} | ${row.failed} | ${rate} | ${row.networkInterruptions} | ${row.passingWithInterruptions} | ${row.existingBootstrapRetries} | ${row.toastSignatures} |`);
    }
    lines.push('', 'Normal cold starts estimate observed suite reliability in this environment. The other profiles are causal controls and must not be pooled into that failure rate.', '',
        'Trials within this job share a runner. Wilson intervals are descriptive under an independence assumption; retain run/job identity and use multiple jobs for stronger statistical conclusions.', '',
        'The original scenarios, assertions, six-second notification timer, ten-second element waits and existing three-attempt bootstrap retry remain in place. Instrumentation itself can affect timing. No candidate fix is applied.', '',
        '## Per-scenario outcomes', '', '| Profile / scenario | Executed | Failed |', '|---|---:|---:|');
    const cases = new Map();
    for (const trial of trials.filter(trial => !trial.interrupted && !trial.timedOut && !trial.unavailable)) for (const event of trial.cases) {
        const key = `${trial.profile} / ${event.name}`;
        const counts = cases.get(key) || { executed: 0, failed: 0 };
        counts.executed++; if (event.type === 'test:fail') counts.failed++;
        cases.set(key, counts);
    }
    for (const [name, counts] of cases) lines.push(`| ${name.replaceAll('|', '\\|')} | ${counts.executed} | ${counts.failed} |`);
    lines.push('', '## Review individual trials', '', '| Trial | Exit code | Evidence |', '|---|---:|---|');
    for (const trial of trials) lines.push(`| ${trial.id} | ${trial.exitCode} | [Trial metadata](${trial.id}/trial.json), [TAP log](${trial.id}/test.log), [native test results](${trial.id}/results.ndjson). Scenario folders contain evidence.md and raw traces. |`);
    return lines.join('\n') + '\n';
}

export async function experiment(config) {
    const nonce = randomBytes(16).toString('hex');
    // Never overwrite a previous experiment or adopt its resource manifests.
    await mkdir(dirname(config.output), { recursive: true });
    await mkdir(config.output);
    const trials = [];
    let interrupted = false, active;
    const stop = () => { interrupted = true; active?.(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    const metadata = { config, started: new Date().toISOString(), nonce, node: process.version,
        runId: process.env.GITHUB_RUN_ID || 'local', attempt: process.env.GITHUB_RUN_ATTEMPT || '1',
        runner: process.env.RUNNER_NAME || 'local', runnerImage: process.env.ImageVersion || null,
        commit: (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim(),
        sourceHashes: {}, image: IMAGE };
    try {
        await checkDocker();
        metadata.dirty = !!(await exec('git', ['status', '--porcelain'], { cwd: root })).stdout.trim();
        metadata.docker = (await exec('docker', ['version', '--format', '{{.Server.Version}}'])).stdout.trim();
        metadata.caddyImage = JSON.parse((await exec('docker', ['image', 'inspect', IMAGE, '--format', '{{json .RepoDigests}}'])).stdout);
        for (const path of ['frontend/e2e/error-logging.mjs', 'frontend/e2e/fixture.mjs', 'frontend/package-lock.json', 'backend/package-lock.json',
            'frontend/caddyfile-mode.sha', 'frontend/src/utils/notificationCenter.js', 'test/diagnostics/observe.mjs', 'test/diagnostics/analysis.mjs', 'test/diagnostics/run.mjs']) {
            metadata.sourceHashes[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
        }
        await writeFile(join(config.output, 'experiment.json'), JSON.stringify(metadata, null, 2));
        for (const item of schedule(config)) {
            if (interrupted) break;
            const id = `${String(item.trial).padStart(3, '0')}-${item.profile}`;
            const directory = join(config.output, id);
            await mkdir(directory);
            const trialNonce = nonce + ':' + id;
            const trial = { ...item, id, started: Date.now(), cases: [], evidence: [], cleanup: [], resultErrors: [] };
            console.log(`Diagnostic trial ${id}`);
            const file = item.profile === 'localhost' ? 'test/diagnostics/localhost.mjs' : 'frontend/e2e/error-logging.mjs';
            const pattern = item.profile !== 'normal' && item.profile !== 'localhost' || config.scope === 'recovery' && item.profile === 'normal'
                ? ['--test-name-pattern=state errors deduplicate'] : [];
            const args = ['--test', '--test-reporter=tap', '--test-reporter-destination=stdout',
                '--test-reporter=' + join(import.meta.dirname, 'reporter.mjs'), '--test-reporter-destination=' + join(directory, 'results.ndjson'), ...pattern, join(root, file)];
            const log = createWriteStream(join(directory, 'test.log'));
            const env = { ...process.env, ETOE_DIAGNOSTICS_DIR: directory, ETOE_DIAGNOSTICS_NONCE: trialNonce, ETOE_DIAGNOSTICS_PROFILE: item.profile };
            // This is a new CLI test run, even when the collector is exercised by
            // a native Node test. Inheriting its worker marker suppresses --test.
            delete env.NODE_TEST_CONTEXT;
            const child = spawn(process.execPath, args, { cwd: root, detached: process.platform !== 'win32',
                env,
                stdio: ['ignore', 'pipe', 'pipe'] });
            child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
            const kill = signal => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
            let force;
            active = () => { kill('SIGTERM'); force ??= setTimeout(() => kill('SIGKILL'), 3000); };
            const timer = setTimeout(() => { trial.timedOut = true; active(); }, 1100000);
            try {
                await new Promise((done, reject) => { child.once('error', reject); child.once('close', (code, signal) => { trial.exitCode = code ?? -1; trial.signal = signal; done(); }); });
            } finally {
                clearTimeout(timer); clearTimeout(force); active = null;
                await new Promise(done => log.end(done));
                trial.cleanup = await cleanupTrial(directory, trialNonce);
            }
            const results = await readFile(join(directory, 'results.ndjson'), 'utf8').catch(() => '');
            trial.interrupted = interrupted;
            trial.cases = results.split('\n').filter(Boolean).flatMap(line => {
                try { return [JSON.parse(line)]; } catch { trial.resultErrors.push('Incomplete native reporter record'); return []; }
            }).filter(event => event.nesting === 0 && !event.skip && ['test:pass', 'test:fail'].includes(event.type));
            if (!trial.cases.length) trial.resultErrors.push('No executed native test case result');
            for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isDirectory()) {
                const capture = await json(join(directory, entry.name, 'metadata.json'), {});
                trial.evidence.push({ ...await json(join(directory, entry.name, 'analysis.json'), { findings: [], networkInterruptions: 0, missedToasts: 0, missing: ['Analysis missing; capture was interrupted or incomplete'] }),
                    scenario: capture.name, directory: entry.name, controlUnavailable: capture.controlUnavailable || null });
            }
            trial.unavailable = trial.evidence.length > 0 && trial.evidence.every(evidence => evidence.controlUnavailable);
            trial.finished = Date.now();
            await writeFile(join(directory, 'trial.json'), JSON.stringify(trial, null, 2));
            trials.push(trial);
            await writeFile(join(config.output, 'trials.json'), JSON.stringify(trials, null, 2));
        }
    } finally {
        process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
        metadata.finished = new Date().toISOString(); metadata.interrupted = interrupted;
        metadata.collectionComplete = !interrupted && trials.length === schedule(config).length && !trials.some(trial => trial.resultErrors.length);
        await writeFile(join(config.output, 'experiment.json'), JSON.stringify(metadata, null, 2));
        const markdown = summaryMarkdown(metadata, trials);
        await writeFile(join(config.output, 'SUMMARY.md'), markdown);
        const index = ['# Scenario evidence index', ''];
        for (const trial of trials) {
            index.push(`## ${trial.id}`, '', ...trial.evidence.map(evidence =>
                `- [${evidence.scenario || evidence.directory}](${trial.id}/${evidence.directory}/evidence.md)`), '');
        }
        await writeFile(join(config.output, 'EVIDENCE.md'), index.join('\n'));
        if (process.env.GITHUB_STEP_SUMMARY) {
            const url = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}#artifacts`;
            // Relative paths work in the downloaded artifact, not on a job page.
            await appendFile(process.env.GITHUB_STEP_SUMMARY, `Download the [diagnostic artifact](${url}) and start with SUMMARY.md and EVIDENCE.md.\n\n` +
                markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, path) => `${label}: \`${path}\``));
        }
    }
    if (interrupted) throw new Error('Diagnostic collection interrupted; partial evidence retained');
    if (trials.some(trial => trial.resultErrors.length)) throw new Error('Native test result capture incomplete; partial evidence retained');
    return trials;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { await experiment(options(process.argv.slice(2))); } catch (error) { console.error(error); process.exitCode = 1; }
}
