import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthStore } from '../src/authStore.js';

const directories = [];
const secret = () => randomBytes(24).toString('base64url');
async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-auth-store-'));
    directories.push(directory);
    const path = join(directory, 'auth.json');
    return { directory, path, store: createAuthStore(path) };
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('persistent administrator credentials', () => {
    it('keeps the administrator identity across renames, password changes and recovery', async () => {
        const { path, store } = await fixture();
        await store.loadAuth();
        const key = await store.initializeAuth('administrator', secret());
        const id = store.getAccountId();
        expect(id).toMatch(/^[a-f0-9-]{36}$/);
        await store.updateCredentials('renamed', secret());
        await store.replaceCredentials(key, secret());
        const restarted = createAuthStore(path);
        await restarted.loadAuth();
        expect(restarted.getAccountId()).toBe(id);
        expect(restarted.getUsername()).toBe('renamed');
    });

    it('migrates an existing account once without replacing its credentials', async () => {
        const { path, store } = await fixture();
        await store.loadAuth();
        await store.initializeAuth('administrator', secret());
        const previous = JSON.parse(await readFile(path, 'utf8'));
        delete previous.accountId;
        await writeFile(path, JSON.stringify(previous));
        const restarted = createAuthStore(path);
        await restarted.loadAuth();
        const migrated = JSON.parse(await readFile(path, 'utf8'));
        expect(migrated).toEqual({ ...previous, accountId: restarted.getAccountId() });
        await restarted.loadAuth();
        expect(restarted.getAccountId()).toBe(migrated.accountId);
        await writeFile(path, JSON.stringify({ ...previous, accountId: 'invalid' }));
        await expect(restarted.loadAuth()).rejects.toThrow('Refusing to start');
    });

    it('preserves installation metadata and persists only restrictive credential hashes', async () => {
        const { directory, path, store } = await fixture();
        const metadata = JSON.stringify({ language: 'en', firstTimeRun: false });
        await writeFile(join(directory, 'settings.json'), metadata);
        expect(await store.loadAuth()).toBe(false);
        const password = secret();
        const key = await store.initializeAuth('administrator', password);
        const raw = await readFile(path, 'utf8');
        expect(raw).not.toContain(password);
        expect(raw).not.toContain(key);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect(await readFile(join(directory, 'settings.json'), 'utf8')).toBe(metadata);
        const restarted = createAuthStore(path);
        expect(await restarted.loadAuth()).toBe(true);
        expect(await restarted.verifyPassword('administrator', password)).toBe(true);
        expect(await restarted.verifyPassword('other', password)).toBe(false);
        expect(await restarted.verifyPassword('administrator', secret())).toBe(false);
    });

    it('rejects concurrent initialization including a second store instance', async () => {
        const { path, store } = await fixture();
        const other = createAuthStore(path);
        await Promise.all([store.loadAuth(), other.loadAuth()]);
        const outcomes = await Promise.allSettled([
            store.initializeAuth('first', secret()), other.initializeAuth('second', secret()),
        ]);
        expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    });

    it('consumes a recovery key once and keeps replacement credentials across restarts', async () => {
        const { path, store } = await fixture();
        await store.loadAuth();
        const previous = secret();
        const key = await store.initializeAuth('administrator', previous);
        const next = secret();
        const replacement = await store.replaceCredentials(key, next);
        expect(replacement).toBeTruthy();
        expect(replacement).not.toBe(key);
        expect(await store.replaceCredentials(key, secret())).toBeNull();
        const restarted = createAuthStore(path);
        await restarted.loadAuth();
        expect(await restarted.verifyPassword('administrator', previous)).toBe(false);
        expect(await restarted.verifyPassword('administrator', next)).toBe(true);
        expect(await restarted.replaceCredentials(replacement, secret())).toBeTruthy();
    });

    it('does not interpret corrupt, unsupported or inaccessible storage as first-time setup', async () => {
        const { path, store } = await fixture();
        for (const raw of ['{', JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, username: 'admin' })]) {
            await writeFile(path, raw);
            await expect(store.loadAuth()).rejects.toThrow('Refusing to start');
        }
        await rm(path);
        await mkdir(path);
        await expect(store.loadAuth()).rejects.toThrow('Refusing to start');
    });

    it('keeps setup retryable after a persistence failure and removes temporary secrets', async () => {
        const { directory, path, store } = await fixture();
        await store.loadAuth();
        await mkdir(path);
        await expect(store.initializeAuth('administrator', secret())).rejects.toThrow();
        expect(store.isInitialized()).toBe(false);
        expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
        await rm(path, { recursive: true });
        await expect(store.initializeAuth('administrator', secret())).resolves.toBeTruthy();
    });
});
