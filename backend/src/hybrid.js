import { Router } from 'express';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { X509Certificate, createPrivateKey, randomUUID } from 'node:crypto';
import { caddyGet } from './caddy.js';
import { validCertificateFiles } from './middleware/certificateUpload.js';
import { discoverCertificates, publicCertificate, renderCertificate, selectCertificate, validCertificateId } from './hybridCertificates.js';

export const hybridEnabled = () => process.env.CADDY_UI_HYBRID === 'true';
const root = () => '/hybrid';
const admin = () => process.env.CADDY_ADMIN_URL;
const marker = '# caddy-ui-hybrid-state ';
let queue = Promise.resolve();
export function serial(fn) {
    const job = queue.then(fn);
    queue = job.catch(() => {});
    return job;
}
export function validHost(value) {
    return typeof value === 'string' && value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}
export function validateSite(site) {
    if (!validHost(site.domain)) throw new Error('Use a lowercase hostname without scheme, port or path');
    if (typeof site.upstream !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*:[0-9]{1,5}$/.test(site.upstream)) throw new Error('Upstream must be container-name:port or IPv4:port');
    const port = Number(site.upstream.split(':').at(-1));
    if (port < 1 || port > 65535) throw new Error('Invalid upstream port');
    if (site.certificate && (typeof site.certificate !== 'string' || !validCertificateId(site.certificate))) throw new Error('Invalid certificate selection');
    return { domain: site.domain, upstream: site.upstream, certificate: site.certificate || '' };
}
export function certificatePair(pem, key) {
    const cert = new X509Certificate(pem);
    if (!cert.checkPrivateKey(createPrivateKey(key))) throw new Error('Certificate and private key do not match');
    if (Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now()) throw new Error('Certificate is not currently valid');
    return cert;
}
async function state() {
    try {
        const text = await readFile(join(root(), 'Caddyfile'), 'utf8');
        const line = text.split('\n').find(l => l.startsWith(marker));
        if (!line) throw new Error('Hybrid state header missing; refusing to overwrite file');
        return JSON.parse(Buffer.from(line.slice(marker.length), 'base64').toString());
    } catch (err) {
        if (err.code === 'ENOENT') return { sites: [], revision: randomUUID() };
        throw err;
    }
}
export function labelHosts(containers) {
    const hosts = new Set();
    for (const c of containers) for (const [key, value] of Object.entries(c.Labels || {})) {
        if (!/^caddy(?:_[0-9]+)?$/.test(key)) continue;
        for (let host of value.split(/[\s,]+/)) {
            host = host.replace(/^https?:\/\//, '').replace(/:[0-9]+$/, '').toLowerCase();
            if (host) hosts.add(host);
        }
    }
    return hosts;
}
export function collides(host, labels) {
    return labels.has(host) || [...labels].some(h => h.startsWith('*.') && host.endsWith(h.slice(1)) && host.split('.').length === h.split('.').length);
}
async function inventory() {
    const response = await fetch(`${process.env.HYBRID_DOCKER_URL || 'http://docker-reader:2375'}/containers/json?all=1`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Cannot read Docker labels; changes are blocked');
    return response.json();
}
export function renderState(data, labels) {
    const header = marker + Buffer.from(JSON.stringify(data)).toString('base64');
    const blocks = data.sites.filter(s => !collides(s.domain, labels)).map(s => {
        const tls = renderCertificate(s);
        return `${s.domain} {\n    vars ui_revision ${data.revision}\n    ${tls}\n    log\n    reverse_proxy ${s.upstream}\n}`;
    });
    return `${header}\n{\n    admin 0.0.0.0:2019\n    metrics\n    log {\n        output file /logs/caddy.log\n        format json\n    }\n}\n${blocks.join('\n\n')}\n`;
}
async function commit(data, labels) {
    const content = renderState(data, labels);
    const path = join(root(), 'Caddyfile');
    let previous = '';
    try { previous = await readFile(path, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (content === previous) return;
    // Validate before publishing. Never POST /load: docker-proxy is the only writer.
    const response = await fetch(`${admin()}/adapt`, {
        method: 'POST', headers: { 'Content-Type': 'text/caddyfile', Origin: 'http://0.0.0.0:2019' }, body: content,
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Caddy rejected the manual configuration; previous configuration retained');
    await mkdir(root(), { recursive: true, mode: 0o700 });
    if (previous) await writeFile(join(root(), 'Caddyfile.previous'), previous, { mode: 0o600 });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, content, { mode: 0o600 });
    await rename(temp, path);
}
function revisions(value, found = new Set()) {
    if (!value || typeof value !== 'object') return found;
    if (value.handler === 'vars' && value.ui_revision) found.add(value.ui_revision);
    Object.values(value).forEach(v => { if (typeof v === 'object') revisions(v, found); });
    return found;
}
export function hybridGuard(req, res, next) {
    if (!hybridEnabled() || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (/^\/(caddyfile|routes|tls|metrics|logs)(\/|$)/.test(req.path)) {
        return res.status(409).json({ error: 'Docker labels own this configuration. Use Hybrid Sites for manual sites and certificate uploads; edit label-owned sites in your Docker deployment configuration.' });
    }
    next();
}
const router = Router();
router.use((req, res, next) => {
    if (!hybridEnabled()) return res.status(404).json({ error: 'Hybrid mode is disabled' });
    next();
});
router.get('/', async (req, res) => {
    const data = await state();
    const containers = await inventory();
    const labels = labelHosts(containers);
    let active = null;
    try { active = revisions(await caddyGet('/config/', admin())); } catch { /* report unknown */ }
    const catalog = await discoverCertificates({ savedSites: data.sites });
    res.json({
        sites: data.sites.map(s => ({ domain: s.domain, upstream: s.upstream, certificate: s.certificate, certificateSource: s.certificateRef?.source || (s.certificate ? 'imported' : 'automatic'), status: collides(s.domain, labels) ? 'label-conflict' : active === null ? 'unknown' : active.has(data.revision) ? 'applied' : 'pending' })),
        labels: [...labels], certificates: catalog.entries.map(publicCertificate), certificateWarnings: catalog.warnings,
        upstreams: containers.filter(c => c.State === 'running').map(c => ({ name: (c.Names?.[0] || '').replace(/^\//, ''), networks: Object.keys(c.NetworkSettings?.Networks || {}) })),
    });
});
router.post('/sites', async (req, res) => {
    const site = validateSite(req.body);
    await serial(async () => {
        const labels = labelHosts(await inventory());
        if (collides(site.domain, labels)) throw new Error('This hostname belongs to Docker labels. Edit it in your Docker deployment configuration.');
        const data = await state();
        if (site.certificate) {
            const catalog = await discoverCertificates({ savedSites: data.sites });
            site.certificateRef = selectCertificate(catalog.entries, site.certificate, site.domain);
        }
        data.sites = [...data.sites.filter(s => s.domain !== site.domain), site];
        data.revision = randomUUID();
        await commit(data, labels);
    });
    res.status(202).json({ ok: true, status: 'pending' });
});
router.delete('/sites/:domain', async (req, res) => {
    await serial(async () => {
        const data = await state();
        if (!data.sites.some(s => s.domain === req.params.domain)) throw new Error('Not a manually managed site');
        data.sites = data.sites.filter(s => s.domain !== req.params.domain);
        data.revision = randomUUID();
        await commit(data, labelHosts(await inventory()));
    });
    res.status(202).json({ ok: true, status: 'pending' });
});
router.post('/certificates', async (req, res) => {
    const { certificate, privateKey } = req.body || {};
    if (!validCertificateFiles(certificate, privateKey)) return res.status(400).json({ error: 'Certificate and private key must each be nonempty PEM text no larger than 1 MiB' });
    // Never include PEM contents or crypto parse errors in logs/responses.
    try { certificatePair(certificate, privateKey); } catch { return res.status(400).json({ error: 'Invalid, expired, not-yet-valid or mismatched certificate/key pair' }); }
    const id = randomUUID();
    const dir = join(root(), 'certs', id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, 'key.pem'), privateKey, { mode: 0o600 });
    await writeFile(join(dir, 'cert.pem'), certificate, { mode: 0o600 });
    res.status(201).json({ id, certificatePath: `/hybrid/certs/${id}/cert.pem`, keyPath: `/hybrid/certs/${id}/key.pem` });
});
router.use((err, req, res, next) => res.status(400).json({ error: err.message }));
export default router;

export function startHybridReconciler() {
    if (!hybridEnabled()) return;
    // If labels claim a previously manual hostname, labels win on the next poll.
    const timer = setInterval(() => serial(async () => {
        const data = await state();
        await commit(data, labelHosts(await inventory()));
    }).catch(() => {}), 5000);
    timer.unref();
}
