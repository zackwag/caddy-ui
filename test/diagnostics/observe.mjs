/* global location, MutationObserver, document, addEventListener */
// Browser globals are used only in callbacks serialized by Playwright.
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { analyzeEvidence, evidenceMarkdown, netlogEvents } from './analysis.mjs';

const exec = promisify(execFile);
const LIMIT = 10000;
export const projectFor = (nonce, name) => createHash('sha256').update(nonce + '\0' + name).digest('hex').slice(0, 16);

// Expected teardown is not a capture failure. Retain early exits (including 0),
// spawn errors and forced shutdown, and wait for close so pipes are drained.
export function trackObserver(type, child, metadata, record) {
    const state = { type, started: Date.now(), shutdownRequested: null, exited: null, closed: null, code: null, signal: null, forced: false };
    metadata.observers.push(state);
    let spawnFailed = false, stopping;
    const closed = new Promise(resolve => child.once('close', () => { state.closed = Date.now(); resolve(); }));
    child.on('error', error => {
        spawnFailed = true;
        metadata.captureErrors.push(`${type} observer: ${error.message}`);
        record('observer-error', { observer: type, message: error.message });
    });
    child.once('exit', (code, signal) => {
        Object.assign(state, { exited: Date.now(), code, signal });
        const expected = state.shutdownRequested !== null && !state.forced && (code === 0 || code === 143 || signal === 'SIGTERM');
        if (!expected && !spawnFailed && !state.forced) metadata.captureErrors.push(`${type} observer exited unexpectedly (${code ?? signal})`);
        record('observer-exit', { observer: type, code, signal, expected, forced: state.forced });
    });
    return { child, stop(graceMs = 1000) {
        stopping ??= (async () => {
            if (!child.pid || child.exitCode !== null || child.signalCode !== null) return closed;
            state.shutdownRequested = Date.now();
            record('observer-stop-requested', { observer: type });
            child.kill('SIGTERM');
            const force = setTimeout(() => {
                state.forced = true;
                metadata.captureErrors.push(`${type} observer required SIGKILL during teardown`);
                child.kill('SIGKILL');
            }, graceMs);
            try { await closed; } finally { clearTimeout(force); }
        })();
        return stopping;
    } };
}

export async function createDiagnostics(t, scope, { staticControl = false } = {}) {
    const directory = join(process.env.ETOE_DIAGNOSTICS_DIR, createHash('sha256').update(t.name).digest('hex').slice(0, 12));
    await mkdir(directory, { recursive: true });
    const metadata = { name: t.name, profile: process.env.ETOE_DIAGNOSTICS_PROFILE,
        project: staticControl ? null : projectFor(process.env.ETOE_DIAGNOSTICS_NONCE, t.name),
        started: Date.now(), captureErrors: [], observers: [] };
    const timeline = [];
    const system = [];
    const monitors = [];
    const delayed = new Set();
    let page, context, stack, interfaceProbe;
    const save = (file, data) => writeFile(join(directory, file), JSON.stringify(data, null, 2));
    const record = (type, data = {}) => {
        if (timeline.length < LIMIT) timeline.push({ index: timeline.length, epoch: Date.now(), type, ...data });
        else if (!metadata.captureErrors.includes('Timeline truncated at 10000 events')) metadata.captureErrors.push('Timeline truncated at 10000 events');
    };
    const safely = async (label, action) => { try { return await action(); } catch (error) { metadata.captureErrors.push(`${label}: ${error.message}`); } };
    // Durable ownership manifest exists before any container acquisition.
    await writeFile(join(directory, 'ownership.json'), JSON.stringify({ name: t.name, project: metadata.project }), { flag: 'wx' });
    await save('metadata.json', metadata);
    scope.defer(async () => {
        for (const monitor of monitors) await monitor.stop();
        let netlog = [];
        await safely('Chromium NetLog', async () => { netlog = netlogEvents(JSON.parse(await readFile(join(directory, 'browser-netlog.json'), 'utf8'))); });
        metadata.finished = Date.now();
        const evidence = analyzeEvidence({ timeline, system, netlog, metadata });
        await Promise.all([save('timeline.json', timeline), save('system.json', system), save('metadata.json', metadata), save('analysis.json', evidence),
            writeFile(join(directory, 'evidence.md'), evidenceMarkdown(metadata, evidence))]);
    });
    for (const [type, command, args] of [
        ['kernel', 'ip', ['-ts', 'monitor', 'link', 'address', 'route']],
        ['docker', 'docker', ['events', ...(metadata.project ? ['--filter', `label=io.caddy-ui.dev.project=${metadata.project}`] : ['--filter', 'label=io.caddy-ui.dev=false']),
            '--format', '{{.TimeNano}} {{.Type}} {{.Action}}']],
    ]) {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        monitors.push(trackObserver(type, child, metadata, record));
        for (const [stream, name] of [[child.stdout, type], [child.stderr, type + '-stderr']]) {
            createInterface({ input: stream }).on('line', line => {
                if (system.length >= LIMIT) { if (!metadata.captureErrors.includes('System events truncated')) metadata.captureErrors.push('System events truncated'); return; }
                const timestamp = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+)\]/)?.[1];
                system.push({ index: system.length, received: Date.now(), epoch: timestamp ? Date.parse(timestamp + 'Z') : Date.now(), type: name, line });
            });
        }
    }
    async function ownInterface() {
        const container = stack.instances.get('alpha').instance.containerName;
        const peer = await exec('docker', ['exec', container, 'cat', '/sys/class/net/eth0/iflink'], { timeout: 2000, signal: scope.signal });
        const index = Number(peer.stdout.trim());
        const result = await exec('ip', ['-j', 'address', 'show'], { timeout: 2000, signal: scope.signal });
        const info = JSON.parse(result.stdout).find(item => item.ifindex === index && item.ifname.startsWith('veth'));
        if (!info) throw new Error('Owned host veth is not visible; this control requires Chromium and Docker on the same Linux host');
        metadata.interface = { index, name: info.ifname };
        return info;
    }
    const hasReadyAddress = info => info.addr_info.some(address => address.family === 'inet6' && address.scope === 'link' &&
        !address.tentative && !address.dadfailed && !address.flags?.includes('tentative'));
    return {
        project: metadata.project,
        launchOptions: { args: ['--log-net-log=' + join(directory, 'browser-netlog.json')] },
        record,
        async stackReady(value) {
            stack = value;
            record('stack-ready', { project: metadata.project });
            if (metadata.profile !== 'settled-network') interfaceProbe = scope.run(() => safely('Owned interface', ownInterface)).catch(error => metadata.captureErrors.push('Owned interface: ' + error.message));
            else {
                const deadline = Date.now() + 5000;
                record('interface-wait-start');
                try {
                    while (!hasReadyAddress(await ownInterface())) {
                        if (Date.now() >= deadline) throw new Error('Owned IPv6 link-local address did not settle within five seconds');
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                    record('interface-ready');
                } catch (error) { metadata.controlUnavailable = error.message; await save('metadata.json', metadata); throw error; }
            }
        },
        async attach(value, browserContext) {
            page = value; context = browserContext;
            metadata.chromium = context.browser()?.version();
            await context.tracing.start({ screenshots: true, snapshots: true });
            page.on('request', request => record('request', { url: request.url(), method: request.method(), resource: request.resourceType() }));
            page.on('requestfailed', request => record('request-failed', { url: request.url(), resource: request.resourceType(), error: request.failure()?.errorText }));
            page.on('response', response => record('response', { url: response.url(), status: response.status() }));
            page.on('console', message => { if (message.type() === 'error') record('console-error', { message: message.text() }); });
            page.on('pageerror', error => record('page-error', { message: error.message }));
            page.on('framenavigated', frame => { if (frame === page.mainFrame()) record('navigation', { url: frame.url() }); });
            await page.exposeBinding('__etoeDiagnosticEvent', (_, event) => record('dom', event));
            await page.addInitScript(() => {
                const report = data => globalThis.__etoeDiagnosticEvent?.({ epoch: Date.now(), document: performance.timeOrigin, url: location.href, ...data })?.catch(() => {});
                const toasts = new Map();
                const states = new Map();
                let serial = 0;
                new MutationObserver(() => {
                    for (const [element, id] of toasts) if (!element.isConnected) { report({ event: 'toast-removed', toast: id }); toasts.delete(element); }
                    for (const element of document.querySelectorAll('.toast-error')) if (!toasts.has(element)) {
                        toasts.set(element, ++serial); report({ event: 'toast-added', toast: serial, text: element.textContent });
                    }
                    for (const selector of ['.shell', '.cm-editor', '.logs-page', '.log-line', '.ready']) {
                        const present = !!document.querySelector(selector);
                        if (present !== (states.get(selector) || false)) { states.set(selector, present); report({ event: 'element', selector, present }); }
                    }
                }).observe(document, { childList: true, subtree: true });
                report({ event: 'document-start' });
                addEventListener('DOMContentLoaded', () => report({ event: 'dom-content-loaded' }));
                addEventListener('load', () => report({ event: 'load' }));
            });
            if (metadata.profile === 'slow-style') {
                await context.route('**/__etoe_slow_style.css', async route => {
                    record('slow-style-start');
                    await new Promise(resolve => {
                        const timer = setTimeout(resume, 8000);
                        function resume() { clearTimeout(timer); delayed.delete(resume); resolve(); }
                        delayed.add(resume);
                    });
                    await safely('Slow stylesheet response', () => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
                    record('slow-style-finish');
                });
                await page.addInitScript(() => {
                    if (location.pathname !== '/caddyfile') return;
                    addEventListener('DOMContentLoaded', () => {
                        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/__etoe_slow_style.css'; document.head.append(link);
                    });
                });
            }
        },
        async captureFinal() {
            await interfaceProbe;
            for (const resume of delayed) resume();
            if (page) {
                await safely('Final screenshot', () => page.screenshot({ path: join(directory, 'final.png'), timeout: 2000 }));
                await safely('Final DOM', async () => { await writeFile(join(directory, 'final.html'), await page.content()); });
            }
            if (stack) await safely('Backend logs', async () => { await save('backend-log.json', (await stack.api('/logs/app')).data); });
            if (context) await safely('Playwright trace', () => context.tracing.stop({ path: join(directory, 'trace.zip') }));
        },
    };
}
