import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { screenshotRecords } from '../screenshots/replay.mjs';
import { createReplayFetch } from '../../dev/playground/capture-format.js';

const fixture = JSON.parse(await readFile(new URL('../screenshots/captures/screenshots.json', import.meta.url), 'utf8'));

test('documentation capture contains an authenticated installation without session or CSRF material', () => {
    const records = screenshotRecords(fixture);
    assert.equal(records.find(record => record.request.path === '/settings').response.body.firstTimeRun, false);
    assert(!JSON.stringify(records).includes('set-cookie'));
    assert(!JSON.stringify(fixture).includes('csrfToken'));
});

test('legacy disabled-auth and logged-out snapshots cannot silently produce login screenshots', () => {
    for (const body of [{ authEnabled: false }, { authEnabled: true, authenticated: false, setupRequired: false }]) {
        const stale = structuredClone(fixture);
        stale.scenarios[0].requests.find(record => record.request.path === '/auth/status').response.body = body;
        assert.throws(() => screenshotRecords(stale), /lacks an authenticated administrator/);
    }
});

test('read-only screenshots cannot silently invent CSRF or write responses', async () => {
    const replay = createReplayFetch(screenshotRecords(fixture));
    await assert.rejects(replay('/api/auth/csrf'), /Unrecorded request/);
    await assert.rejects(replay('/api/settings', { method: 'PUT', body: '{}' }), /Unrecorded request/);
});
