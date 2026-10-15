// Run after test-hybrid.mjs in its disposable Compose project, never production.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import https from 'node:https';

const compose = ['compose', '-p', 'caddy-hybrid-test', '-f', 'backend/test/compose.hybrid-integration.yaml'];
const docker = args => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const base = 'http://127.0.0.1:18982/api';
let token;
async function api(path, method = 'GET', body, status = 200) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
    return result;
}
async function until(fn) {
    for (let i = 0; i < 30; i++) { try { if (await fn()) return; } catch { /* restart in progress */ } await new Promise(resolve => setTimeout(resolve, 1000)); }
    throw new Error('Timed out');
}
function served() {
    return new Promise((resolve, reject) => {
        https.get({ hostname: '127.0.0.1', port: 18984, servername: 'selected.hybrid.test', rejectUnauthorized: false, agent: false, headers: { Host: 'selected.hybrid.test' } }, response => {
            const fingerprint = response.socket.getPeerCertificate().fingerprint256;
            response.resume(); resolve({ status: response.statusCode, fingerprint });
        }).on('error', reject);
    });
}

const dir = mkdtempSync(join(tmpdir(), 'hybrid-mounted-test-'));
const name = `caddy-hybrid-mounted-${process.pid}`;
try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=*.hybrid.test', '-addext', 'subjectAltName=DNS:*.hybrid.test', '-keyout', join(dir, 'origin.key'), '-out', join(dir, 'origin.pem')], { stdio: 'ignore' });
    const fingerprint = new X509Certificate(readFileSync(join(dir, 'origin.pem'))).fingerprint256;
    const gateway = docker([...compose, 'ps', '-q', 'gateway']);
    const backend = docker([...compose, 'ps', '-q', 'caddy-ui-backend']);
    docker(['cp', join(dir, 'origin.pem'), `${gateway}:/certs/origin.pem`]);
    docker(['cp', join(dir, 'origin.key'), `${gateway}:/certs/origin.key`]);
    docker(['cp', join(dir, 'origin.pem'), `${backend}:/certs/origin.pem`]);
    docker(['exec', backend, 'test', '!', '-e', '/certs/origin.key']);
    docker(['run', '-d', '--name', name, '--network', 'caddy-hybrid-test', '--label', 'caddy=https://origin.hybrid.test', '--label', 'caddy.tls=/certs/origin.pem /certs/origin.key', '--label', 'caddy.reverse_proxy=upstream:8080', 'caddy:2-alpine']);
    token = (await api('/auth/sessions', 'POST', { username: 'admin', password: 'integration-test-only' })).token;
    let selected;
    await until(async () => { selected = (await api('/hybrid')).certificates.find(c => c.source === 'configured' && c.dnsNames.includes('*.hybrid.test')); return selected; });
    console.log('PASS mounted wildcard discovered without a backend private key');
    await api('/hybrid/sites', 'POST', { domain: 'unrelated.example.test', upstream: 'upstream:8080', certificate: selected.id }, 400);
    await api('/hybrid/sites', 'POST', { domain: 'selected.hybrid.test', upstream: 'upstream:8080', certificate: selected.id, certificateRef: { certificatePath: '/etc/passwd', keyPath: '/etc/shadow' } }, 202);
    await until(async () => (await api('/hybrid')).sites.find(s => s.domain === 'selected.hybrid.test')?.status === 'applied');
    assert.deepEqual(await served(), { status: 200, fingerprint });
    assert.ok(!JSON.stringify(await api('/hybrid')).includes('origin.key'));
    console.log('PASS selected certificate fingerprint served; mismatch and injected paths rejected');
    docker(['rm', '-f', name]);
    docker([...compose, 'restart', 'gateway', 'caddy-ui-backend']);
    await until(async () => { const result = await served(); return result.status === 200 && result.fingerprint === fingerprint; });
    await until(async () => (await api('/hybrid')).certificates.some(c => c.id === selected.id));
    await api('/hybrid/sites', 'POST', { domain: 'selected.hybrid.test', upstream: 'upstream:8080', certificate: selected.id }, 202);
    console.log('PASS mounted certificate selection survives restart and original label removal');
} finally {
    try { docker(['rm', '-f', name]); } catch { /* already removed */ }
    rmSync(dir, { recursive: true });
}
