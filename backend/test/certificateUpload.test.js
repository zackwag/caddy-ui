import express from 'express';
import { once } from 'node:events';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { certificateUploadBody, validCertificateFiles, MAX_CERTIFICATE_BYTES } from '../src/middleware/certificateUpload.js';

vi.mock('../src/middleware/auth.js', () => ({ authMiddleware: (req, res, next) => {
    if (req.headers.authorization !== 'Bearer test') return res.sendStatus(401);
    next();
} }));
let server;
let url;
beforeAll(async () => {
    const app = express();
    app.use('/api/hybrid/certificates', certificateUploadBody);
    app.use(express.json());
    app.post('/api/hybrid/certificates', (req, res) => res.json({ valid: validCertificateFiles(req.body.certificate, req.body.privateKey) }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    url = `http://127.0.0.1:${server.address().port}/api/hybrid/certificates`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));
const post = (body, authorized = true) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer test' } : {}) }, body });

describe('certificate upload limits', () => {
    it('accepts two 1 MiB files through the normal JSON middleware', async () => {
        const response = await post(JSON.stringify({ certificate: 'A'.repeat(MAX_CERTIFICATE_BYTES), privateKey: 'B'.repeat(MAX_CERTIFICATE_BYTES) }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ valid: true });
    });
    it('authenticates before parsing upload bodies', async () => {
        expect((await post('not-json', false)).status).toBe(401);
    });
    it('rejects over-limit requests without echoing contents', async () => {
        const response = await post(JSON.stringify({ privateKey: 'SECRET'.repeat(600000) }));
        expect(response.status).toBe(413);
        expect(await response.text()).not.toContain('SECRET');
    });
    it('rejects malformed JSON without echoing contents', async () => {
        const response = await post('SECRET');
        expect(response.status).toBe(400);
        expect(await response.text()).not.toContain('SECRET');
    });
    it('enforces file sizes in bytes and rejects missing fields', () => {
        expect(validCertificateFiles('A'.repeat(MAX_CERTIFICATE_BYTES + 1), 'key')).toBe(false);
        expect(validCertificateFiles('é'.repeat(MAX_CERTIFICATE_BYTES), 'key')).toBe(false);
        expect(validCertificateFiles('', 'key')).toBe(false);
        expect(validCertificateFiles(null, 'key')).toBe(false);
    });
});
