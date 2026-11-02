import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuthService } from '../src/authService.js';
import { createAuthStore } from '../src/authStore.js';
import { initializeAuthentication } from '../src/middleware/auth.js';
import logger from '../src/logger.js';
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
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('authentication startup warnings', () => {
    const deployments = [undefined, 'http://ui.example:9877', 'https://ui.example:8443'];
    const cases = ['setup', 'legacy', 'stored'].flatMap(state => deployments.map(externalUrl => [state, externalUrl]));
    it.each(cases)('warns only for the relevant %s state at %s', async (state, externalUrl) => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const directory = await mkdtemp(join(tmpdir(), 'caddy-auth-config-'));
        directories.push(directory);
        const store = createAuthStore(join(directory, 'auth.json'));
        if (state === 'stored') {
            await store.loadAuth();
            await store.initializeAuth('administrator', values.CADDY_UI_PASSWORD);
        }
        const env = { CADDY_UI_EXTERNAL_URL: externalUrl,
            ...(state === 'legacy' ? values : {}),
        };
        const service = await initializeAuthentication({ store, env });
        expect(service.getAuthState({ headers: {} }).authEnabled).toBe(true);
        const messages = warn.mock.calls.map(([message]) => message);
        expect(messages.filter(message => message.includes('Administrator enrollment is open'))).toHaveLength(state === 'setup' ? 1 : 0);
        expect(messages.filter(message => message.includes('Secure session cookies are not enabled'))).toHaveLength(externalUrl?.startsWith('https:') !== true ? 1 : 0);
        if (state === 'setup') {
            expect(messages[0]).toContain('first person reaching the setup page can claim administrator access');
            expect(messages[0]).toContain('Restrict access until enrollment is complete');
        }
        if (externalUrl?.startsWith('https:') !== true) {
            expect(messages.at(-1)).toContain('For HTTPS deployments, set CADDY_UI_EXTERNAL_URL=https://your-public-hostname');
        }
        for (const message of messages) {
            for (const value of Object.values(values)) expect(message).not.toContain(value);
            if (externalUrl) expect(message).not.toContain(externalUrl);
        }
        // Polling authentication state must not repeat startup warnings.
        service.getAuthState({ headers: {} });
        service.getAuthState({ headers: {} });
        expect(warn).toHaveBeenCalledTimes(messages.length);
    });

    it.each([
        ['https://a.example,https://b.example', false],
        ['https://a.example,', false],
        ['https://a.example,,https://b.example', false],
        ['https://a.example,http://192.168.4.87:9877', true],
        ['http://ui.example', true],
    ])('cookie warning matches actual cookie policy for %s (warns=%s)', async (externalUrl, expectsWarning) => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const directory = await mkdtemp(join(tmpdir(), 'caddy-auth-config-'));
        directories.push(directory);
        const store = createAuthStore(join(directory, 'auth.json'));
        await initializeAuthentication({ store, env: { CADDY_UI_EXTERNAL_URL: externalUrl } });
        const warnings = warn.mock.calls.map(([m]) => m);
        expect(warnings.some(m => m.includes('Secure session cookies are not enabled'))).toBe(expectsWarning);
    });

    it.each([
        ['https://a.example,https://b.example', true],
        ['https://a.example,', true],
        ['https://a.example,,https://b.example', true],
        ['https://a.example,http://192.168.4.87:9877', false],
        ['http://ui.example', false],
        [undefined, false],
    ])('session cookies reflect CADDY_UI_EXTERNAL_URL=%s (secure=%s)', async (externalUrl, expectedSecure) => {
        const directory = await mkdtemp(join(tmpdir(), 'caddy-auth-config-'));
        directories.push(directory);
        const store = createAuthStore(join(directory, 'auth.json'));
        const env = { CADDY_UI_EXTERNAL_URL: externalUrl };
        vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const service = await createAuthService({ store, env });
        await store.initializeAuth('administrator', 'Test-Password-1!');
        const cookies = [];
        const res = { cookie: (name, value, opts) => cookies.push({ name, ...opts }) };
        service.sessions.createSession({ headers: {} }, res, 'management');
        expect(cookies[0].secure).toBe(expectedSecure);
    });

    it('emits each warning once to production container stdout', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'caddy-auth-config-'));
        directories.push(directory);
        const env = { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info', AUTH_PATH: join(directory, 'auth.json') };
        for (const key of [...KEYS, 'CADDY_UI_EXTERNAL_URL']) delete env[key];
        const script = `import { initializeAuthentication } from ${JSON.stringify(new URL('../src/middleware/auth.js', import.meta.url).href)};
            const authentication = await initializeAuthentication();
            authentication.getAuthState({ headers: {} });`;
        const { stdout, stderr } = await execute(process.execPath, ['--input-type=module', '--eval', script], { env, timeout: 10000 });
        expect(stderr).toBe('');
        const entries = stdout.trim().split('\n').map(line => JSON.parse(line));
        expect(entries).toHaveLength(2);
        expect(entries.every(entry => entry.level === 'warn')).toBe(true);
        expect(entries[0].message).toContain('Administrator enrollment is open');
        expect(entries[1].message).toContain('Secure session cookies are not enabled');
    });
});

describe('auth configuration', () => {
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
