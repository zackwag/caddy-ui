import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthStore } from '../src/authStore.js';

const directories = [];
const secret = () => randomBytes(32).toString('base64url');
const record = () => ({ id: secret(), publicKey: secret(), name: 'Laptop', rpId: 'ui.example.com', counter: 0,
    deviceType: 'multiDevice', backedUp: true, transports: ['internal'], createdAt: new Date().toISOString(), lastUsedAt: null });
async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-passkey-store-'));
    directories.push(directory);
    const path = join(directory, 'auth.json');
    const store = createAuthStore(path);
    await store.loadAuth();
    const username = 'administrator';
    const password = secret();
    const recoveryKey = await store.initializeAuth(username, password);
    return { path, store, username, password, recoveryKey };
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('persistent passkeys', () => {
    it('loads older records and preserves passkeys and the account handle across restarts and credential changes', async () => {
        const { path, store, password, recoveryKey } = await fixture();
        expect(store.listPasskeys()).toEqual([]);
        const userId = await store.ensurePasskeyUserId();
        const key = record();
        await store.addPasskey(key);
        await store.updateCredentials('renamed-administrator', secret());
        const restarted = createAuthStore(path);
        await restarted.loadAuth();
        expect(await restarted.ensurePasskeyUserId()).toBe(userId);
        expect(restarted.listPasskeys()).toEqual([key]);
        const raw = await readFile(path, 'utf8');
        expect(raw).not.toContain(password);
        expect(raw).not.toContain(recoveryKey);
        const list = restarted.listPasskeys();
        list[0].name = 'Changed copy';
        expect(restarted.listPasskeys()[0].name).toBe(key.name);
    });

    it('enforces the three-key limit across concurrent writes and refuses duplicate credentials', async () => {
        const { store } = await fixture();
        await store.ensurePasskeyUserId();
        const key = record();
        await store.addPasskey(key);
        await expect(store.addPasskey(key)).rejects.toThrow();
        const results = await Promise.allSettled([store.addPasskey(record()), store.addPasskey(record()), store.addPasskey(record())]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
        expect(store.listPasskeys()).toHaveLength(3);
    });

    it('persists usage, supports zero counters, and refuses a non-increasing device counter', async () => {
        const { path, store } = await fixture();
        await store.ensurePasskeyUserId();
        const key = record();
        await store.addPasskey(key);
        const usage = { newCounter: 0, credentialDeviceType: 'multiDevice', credentialBackedUp: true };
        await store.updatePasskeyUsage(key.id, usage);
        await store.updatePasskeyUsage(key.id, { ...usage, newCounter: 2 });
        await expect(store.updatePasskeyUsage(key.id, { ...usage, newCounter: 1 })).rejects.toThrow();
        const restarted = createAuthStore(path);
        await restarted.loadAuth();
        expect(restarted.listPasskeys()[0]).toMatchObject({ counter: 2, lastUsedAt: expect.any(String) });
    });

    it('preserves the previous state on a failed write and allows retry', async () => {
        const { path, store } = await fixture();
        await store.ensurePasskeyUserId();
        const key = record();
        await store.addPasskey(key);
        const before = await readFile(path, 'utf8');
        await rename(path, path + '.saved');
        await mkdir(path);
        await expect(store.removePasskey(key.id)).rejects.toThrow();
        expect(store.listPasskeys()).toEqual([key]);
        expect(await readFile(path + '.saved', 'utf8')).toBe(before);
        await rm(path, { recursive: true });
        await rename(path + '.saved', path);
        expect(await store.removePasskey(key.id)).toBe(true);
    });

    it('removes every passkey and its account handle during account recovery', async () => {
        const { store, path, recoveryKey } = await fixture();
        await store.ensurePasskeyUserId();
        await store.addPasskey(record());
        expect(await store.replaceCredentials(recoveryKey, secret())).toBeTruthy();
        const restarted = createAuthStore(path);
        await restarted.loadAuth();
        expect(restarted.listPasskeys()).toEqual([]);
        expect(restarted.getPasskeyUserId()).toBeNull();
    });

    it('fails closed for malformed persisted passkey records', async () => {
        const { path, store } = await fixture();
        await store.ensurePasskeyUserId();
        const original = JSON.parse(await readFile(path, 'utf8'));
        for (const passkeys of [null, {}, { userId: secret(), credentials: [record(), record(), record(), record()] },
            { userId: secret(), credentials: [{ ...record(), counter: -1 }] },
            { userId: secret(), credentials: [{ ...record(), publicKey: 'invalid==' }] }]) {
            await writeFile(path, JSON.stringify({ ...original, passkeys }));
            await expect(createAuthStore(path).loadAuth()).rejects.toThrow('Refusing to start');
        }
    });
});
