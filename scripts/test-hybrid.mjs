import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import http from 'node:http';

const base = 'http://127.0.0.1:18982/api';
let token;
async function api(path, method = 'GET', body, expected = 200) {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = await r.json();
    assert.equal(r.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    return result;
}
async function until(check, message) {
    for (let i = 0; i < 20; i++) {
        if (await check()) { console.log(`PASS ${message}`); return; }
        await new Promise(r => setTimeout(r, 1500));
    }
    throw new Error(`Timeout: ${message}`);
}
async function manualPage() {
    return new Promise((resolve, reject) => {
        const r = https.get({ hostname: '127.0.0.1', port: 18984, servername: 'manual.hybrid.test', path: '/', rejectUnauthorized: false, headers: { Host: 'manual.hybrid.test' } }, res => { res.resume(); resolve(res.statusCode); });
        r.on('error', reject);
    });
}
async function labelPage() {
    return new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port: 18980, headers: { Host: 'label.hybrid.test' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
}
await until(async () => { try { return (await fetch(base + '/auth/status')).ok; } catch { return false; } }, 'Backend ready');
const path = mkdtempSync(join(tmpdir(), 'caddy-hybrid-cert-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(path, 'key.pem'), '-out', join(path, 'cert.pem'), '-days', '2', '-subj', '/CN=manual.hybrid.test', '-addext', 'subjectAltName=DNS:manual.hybrid.test'], { stdio: 'ignore' });
await api('/hybrid', 'GET', null, 401);
token = (await api('/auth/sessions', 'POST', { username: 'admin', password: 'integration-test-only' })).token;
await until(async () => (await api('/hybrid')).labels.includes('label.hybrid.test'), 'Docker labels discovered');
assert.equal(await labelPage(), 200);
console.log('PASS label site serves traffic');
for (const endpoint of ['/routes', '/caddyfile/reloads', '/metrics/config', '/logs/config', '/tls/cert']) await api(endpoint, 'POST', {}, 409);
await api('/hybrid/sites', 'POST', { domain: 'label.hybrid.test', upstream: 'upstream:8080' }, 400);
const pem = readFileSync(join(path, 'cert.pem'), 'utf8');
const key = readFileSync(join(path, 'key.pem'), 'utf8');
const largeUpload = await fetch('http://127.0.0.1:18983/api/hybrid/certificates', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ certificate: pem + ' '.repeat(600000), privateKey: key + ' '.repeat(600000) }),
});
assert.equal(largeUpload.status, 201, 'Large valid upload passes through nginx and authenticated JSON parser');
console.log('PASS certificate upload larger than 1 MiB through frontend proxy');
await api('/hybrid/certificates', 'POST', { certificate: pem, privateKey: 'invalid' }, 400);
const cert = await api('/hybrid/certificates', 'POST', { certificate: pem, privateKey: key }, 201);
const form = { domain: 'manual.hybrid.test', upstream: 'upstream:8080', certificate: cert.id };
await api('/hybrid/sites', 'POST', form, 202);
await until(async () => (await api('/hybrid')).sites.find(s => s.domain === form.domain)?.status === 'applied', 'Manual config applied by docker-proxy');
assert.equal(await manualPage(), 200);
assert.equal(await labelPage(), 200);
console.log('PASS manual and label sites both serve traffic');
assert.ok((await api('/tls')).some(c => c.issuer === 'imported'));
assert.ok(!JSON.stringify(await api('/hybrid')).includes('PRIVATE KEY'));
console.log('PASS origin certificate expiry visible, no private key returned');
execFileSync('docker', ['compose', '-p', 'caddy-hybrid-test', '-f', 'backend/test/compose.hybrid-integration.yaml', 'restart', 'gateway'], { stdio: 'ignore' });
await until(async () => { try { return await manualPage() === 200; } catch { return false; } }, 'Manual site survives gateway restart');
await api('/hybrid/sites', 'POST', { ...form, upstream: 'upstream:8080' }, 202);
await until(async () => (await api('/hybrid')).sites.find(s => s.domain === form.domain)?.status === 'applied', 'Update applied without replacing labels');
const collisionName = `caddy-hybrid-collision-${process.pid}`;
execFileSync('docker', ['create', '--name', collisionName, '--label', 'caddy=manual.hybrid.test', 'caddy:2-alpine'], { stdio: 'ignore' });
try {
    await until(async () => (await api('/hybrid')).sites.find(s => s.domain === form.domain)?.status === 'label-conflict', 'New Docker labels take ownership over a manual hostname');
    await api('/hybrid/sites', 'POST', form, 400);
} finally { execFileSync('docker', ['rm', collisionName], { stdio: 'ignore' }); }
await until(async () => (await api('/hybrid')).sites.find(s => s.domain === form.domain)?.status === 'applied' && await manualPage() === 200, 'Manual site restored after label reservation removed');
await api('/hybrid/sites/manual.hybrid.test', 'DELETE', null, 202);
await until(async () => {
    const r = await fetch('http://127.0.0.1:18981/config/', { headers: { Origin: 'http://0.0.0.0:2019' } });
    return !(await r.text()).includes('manual.hybrid.test');
}, 'Manual deletion propagates');
assert.equal(await labelPage(), 200);
await api('/hybrid/sites', 'POST', form, 202);
await until(async () => (await api('/hybrid')).sites.find(s => s.domain === form.domain)?.status === 'applied', 'Restored site for browser inspection');
console.log('PASS integration complete; test environment retained for browser inspection');
