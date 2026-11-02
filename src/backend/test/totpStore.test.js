import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { TOTP, Secret } from 'otpauth';
import { createAuthStore } from '../src/authStore.js';
import { createTotpEnrollment, totpStep } from '../src/totpPolicy.js';

// Public ASCII test vector from RFC 6238, Appendix B; never a deployed credential.
const secret = Secret.fromUTF8('12345678901234567890').base32;
const token = timestamp => new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp });
const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'totp-store-'));
    directories.push(directory);
    const path = join(directory, 'auth.json');
    let time = 59000;
    const store = createAuthStore(path, { now: () => time });
    await store.loadAuth();
    const recovery = await store.initializeAuth('admin', randomBytes(24).toString('base64url'));
    return { store, path, recovery, advance: ms => { time += ms; } };
}

describe('TOTP policy and durable replay protection', () => {
    it('matches the RFC vector, exact digit format and one-step clock tolerance', () => {
        expect(totpStep(secret, '287082', 59000)).toBe(1);
        expect(totpStep(secret, '287082', 89000)).toBe(1);
        expect(totpStep(secret, '287082', 29000)).toBe(1);
        expect(totpStep(secret, '287082', 119000)).toBeNull();
        for (const code of [287082, ' 287082', '287082\n', '28708', '0287082']) expect(totpStep(secret, code, 59000)).toBeNull();
        expect(totpStep(secret, '287082', 59000, 1)).toBeNull();
    });
    it('generates unique 160-bit seeds and a compatible local enrollment URI', () => {
        const first = createTotpEnrollment('admin');
        expect(first.secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(createTotpEnrollment('admin').secret).not.toBe(first.secret);
        expect(first.uri).toContain('otpauth://totp/');
        expect(first.uri).toContain('algorithm=SHA1');
        expect(first.uri).toContain('digits=6');
        expect(first.uri).toContain('period=30');
    });
    it('persists one winner for concurrent use, survives restart, and stays owner-only', async () => {
        const f = await fixture();
        expect(f.store.isTotpEnabled()).toBe(false);
        await f.store.setTotp({ secret, lastAcceptedStep: 0, createdAt: new Date(0).toISOString() });
        expect(await Promise.all([f.store.consumeTotp(token(59000)), f.store.consumeTotp(token(59000))])).toEqual([true, false]);
        const restarted = createAuthStore(f.path, { now: () => 59000 });
        await restarted.loadAuth();
        expect(restarted.isTotpEnabled()).toBe(true);
        expect(JSON.parse(await readFile(f.path, 'utf8')).version).toBe(2);
        expect(await restarted.consumeTotp(token(59000))).toBe(false);
        expect((await stat(f.path)).mode & 0o777).toBe(0o600);
        f.advance(30000);
        expect(await f.store.consumeTotp(token(89000))).toBe(true);
    });
    it('clears consecutive failures on success and restarts the budget after a cooldown', async () => {
        const f = await fixture();
        await f.store.setTotp({ secret, lastAcceptedStep: 0, createdAt: new Date(0).toISOString() });
        for (let i = 0; i < 4; i++) expect(await f.store.consumeTotp('bad')).toBe(false);
        expect(await f.store.consumeTotp(token(59000))).toBe(true);
        for (let i = 0; i < 5; i++) expect(await f.store.consumeTotp('bad')).toBe(false);
        await expect(f.store.consumeTotp(token(89000))).rejects.toMatchObject({ retryAfter: 300 });
        f.advance(300000);
        expect(await f.store.consumeTotp('bad')).toBe(false);
        expect(JSON.parse(await readFile(f.path, 'utf8')).totp.failures.count).toBe(1);
        expect(await f.store.consumeTotp(token(359000))).toBe(true);
    });
    it('fails closed on malformed stored TOTP and cannot enable a partial record', async () => {
        const f = await fixture();
        await expect(f.store.setTotp({ secret })).rejects.toThrow();
        const record = JSON.parse(await readFile(f.path, 'utf8'));
        const validTotp = { secret, lastAcceptedStep: 0, createdAt: new Date(0).toISOString() };
        for (const invalid of [{ ...record, version: 2, totp: { ...validTotp, failures: { count: 0, blockedUntil: 300000 } } },
            { ...record, version: 2, totp: { ...validTotp, failures: { count: 5, blockedUntil: 0 } } },
            { ...record, version: 2 }, { ...record, version: 2, totp: { secret } },
            { ...record, totp: { secret, lastAcceptedStep: 0, createdAt: new Date(0).toISOString() } }]) {
            await writeFile(f.path, JSON.stringify(invalid));
            await expect(createAuthStore(f.path).loadAuth()).rejects.toThrow('Refusing to start');
        }
    });
    it('keeps TOTP through ordinary updates and clears it during recovery', async () => {
        const f = await fixture();
        await f.store.setTotp({ secret, lastAcceptedStep: 0, createdAt: new Date(0).toISOString() });
        await f.store.updateCredentials('renamed', undefined);
        expect(f.store.isTotpEnabled()).toBe(true);
        await f.store.replaceCredentials(f.recovery, randomBytes(24).toString('base64url'));
        expect(f.store.isTotpEnabled()).toBe(false);
        const recovered = JSON.parse(await readFile(f.path, 'utf8'));
        expect(recovered).not.toHaveProperty('totp');
        expect(recovered.version).toBe(1);
    });
});
