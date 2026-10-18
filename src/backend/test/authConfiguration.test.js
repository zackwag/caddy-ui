import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuthService } from '../src/authService.js';
import { createAuthStore } from '../src/authStore.js';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

const KEYS = ['CADDY_UI_USER', 'CADDY_UI_PASSWORD', 'JWT_SECRET'];
// Runtime-only fixtures: no checked-in credentials or signed tokens.
const values = Object.fromEntries(KEYS.map(key => [key, randomBytes(24).toString('hex')]));
const execute = promisify(execFile);

const directories = [];
async function loadAuth(env = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-auth-config-'));
    directories.push(directory);
    const service = await createAuthService({ store: createAuthStore(join(directory, 'auth.json')), env });
    return { authEnabled: service.getAuthState({ headers: {} }).authEnabled };
}
afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('auth configuration', () => {
    it.each(['', '1', 'TRUE', 'yes'])('rejects ambiguous authentication opt-out %j', async value => {
        await expect(loadAuth({ CADDY_UI_AUTH_DISABLED: value })).rejects.toThrow('must be true or false');
    });
    it.each([
        ['none', []],
        ['username', [KEYS[0]]],
        ['password', [KEYS[1]]],
        ['signing key', [KEYS[2]]],
        ['username and password', KEYS.slice(0, 2)],
        ['username and signing key', [KEYS[0], KEYS[2]]],
        ['password and signing key', KEYS.slice(1)],
        ['all', KEYS],
    ])('validates the presence combination: %s', async (_label, present) => {
        const env = Object.fromEntries(present.map(key => [key, values[key]]));
        if (present.length === 0 || present.length === KEYS.length) {
            expect((await loadAuth(env)).authEnabled).toBe(true);
        } else {
            const error = await loadAuth(env).catch(error => error);
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toContain('Refusing to start');
            expect(error.message).toContain(`Missing, empty or whitespace-only: ${KEYS.filter(key => !present.includes(key)).join(', ')}.`);
            for (const value of Object.values(env)) expect(error.message).not.toContain(value);
        }
    });

    it.each(KEYS)('rejects an empty or whitespace-only %s', async key => {
        for (const invalid of ['', ' ', '\t\n']) {
            await expect(loadAuth({ ...values, [key]: invalid })).rejects.toThrow(key);
        }
    });

    it.each(['', ' ', '\t\n'])('rejects all three explicitly blank settings (%j)', async blank => {
        await expect(loadAuth(Object.fromEntries(KEYS.map(key => [key, blank])))).rejects.toThrow('Refusing to start');
    });

    it.each(KEYS)('does not treat an explicitly empty %s as an absent setting', async key => {
        await expect(loadAuth({ [key]: '' })).rejects.toThrow('Refusing to start');
    });
});

it('uses stored credentials even when obsolete environment variables are blank', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-auth-config-'));
    directories.push(directory);
    const store = createAuthStore(join(directory, 'auth.json'));
    await store.loadAuth();
    await store.initializeAuth('administrator', values.CADDY_UI_PASSWORD);
    const service = await createAuthService({ store, env: { CADDY_UI_USER: '', JWT_SECRET: '' } });
    expect(service.getAuthState({ headers: {} }).setupRequired).toBe(false);
});

it('refuses damaged authentication storage rather than enabling enrollment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-auth-config-'));
    directories.push(directory);
    const path = join(directory, 'auth.json');
    await writeFile(path, '{');
    await expect(createAuthService({ store: createAuthStore(path), env: {} })).rejects.toThrow('Refusing to start');
});

it('rejects partial configuration in the actual backend before any listener is attempted', { timeout: 15000 }, async () => {
    const env = { ...process.env, CADDY_UI_USER: values.CADDY_UI_USER, CADDY_UI_PASSWORD: values.CADDY_UI_PASSWORD,
        CADDY_UI_UPDATE_CHECK: 'false', PORT: '0' };
    const directory = await mkdtemp(join(tmpdir(), 'caddy-auth-config-'));
    directories.push(directory);
    env.AUTH_PATH = join(directory, 'auth.json');
    delete env.JWT_SECRET;
    // Fail loudly on any attempted listener, without ever exposing a test API.
    const guard = Buffer.from("import { Server } from 'node:net'; Server.prototype.listen = () => { console.error('AUTH_TEST_LISTEN_ATTEMPT'); process.exit(99); };").toString('base64');
    const result = await execute(process.execPath, [
        '--import', `data:text/javascript;base64,${guard}`, fileURLToPath(new URL('../src/index.js', import.meta.url)),
    ], { env, timeout: 10000, maxBuffer: 64 * 1024 }).catch(error => error);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Refusing to start');
    expect(result.stderr).toContain('JWT_SECRET');
    expect(result.stderr).not.toContain('AUTH_TEST_LISTEN_ATTEMPT');
    for (const value of Object.values(values)) expect(result.stderr + result.stdout).not.toContain(value);
});
