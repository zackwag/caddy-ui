import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createAuthStore } from '../src/authStore.js';

const failure = vi.hoisted(() => ({ code: null }));
vi.mock('node:fs/promises', async original => {
    const fs = await original();
    return { ...fs, open: async (path, ...args) => {
        if (failure.code && String(path).includes('/.auth-')) throw Object.assign(new Error('migration storage failure'), { code: failure.code });
        return fs.open(path, ...args);
    } };
});
const directories = [];
afterEach(async () => {
    failure.code = null;
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

it.each(['ENOENT', 'EACCES'])('does not reopen enrollment when identity migration fails with %s', async code => {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-account-migration-'));
    directories.push(directory);
    const path = join(directory, 'auth.json');
    const store = createAuthStore(path);
    await store.loadAuth();
    await store.initializeAuth('administrator', randomBytes(24).toString('base64url'));
    const previous = JSON.parse(await readFile(path, 'utf8'));
    delete previous.accountId;
    await writeFile(path, JSON.stringify(previous));
    failure.code = code;
    await expect(createAuthStore(path).loadAuth()).rejects.toThrow('Refusing to start');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(previous);
});
