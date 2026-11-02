import { randomBytes } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { authClient, authFixture } from './fixtures/auth.mjs';

const fixtures = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

it('derives the account identity from a management session and resolves its current name', async () => {
    const fixture = await authFixture();
    fixtures.push(fixture);
    const client = authClient(fixture.url);
    const password = randomBytes(24).toString('base64url');
    await client.request('/auth/setup', { method: 'POST', body: { username: 'administrator', password } });
    const req = { headers: { cookie: client.cookie }, body: { actor: { type: 'user', id: 'forged', name: 'Someone else' } } };
    const actor = fixture.service.getActor(req);
    expect(actor).toEqual({ type: 'user', id: fixture.store.getAccountId(), name: 'administrator' });
    expect(fixture.service.getActor({ headers: {} })).toBeNull();
    await fixture.store.updateCredentials('renamed');
    expect(fixture.service.resolveActor({ type: 'user', id: actor.id })).toEqual({ ...actor, name: 'renamed' });
});

it('uses token IDs independently of account IDs and stops resolving revoked tokens', async () => {
    const fixture = await authFixture();
    fixtures.push(fixture);
    await fixture.store.initializeAuth('administrator', randomBytes(24).toString('base64url'));
    const issued = await fixture.store.issueApiToken({ name: 'Automation', scopes: ['status:read'], instanceIds: ['default'], expiresInDays: 1 });
    const trustedToken = fixture.service.verifyApiToken(issued.token);
    const actor = fixture.service.getActor({ apiToken: trustedToken });
    expect(actor).toEqual({ type: 'api-token', id: issued.id, name: 'Automation' });
    expect(actor.id).not.toBe(fixture.store.getAccountId());
    expect(fixture.service.resolveActor({ type: 'api-token', id: issued.id })).toEqual(actor);
    expect(JSON.stringify(actor)).not.toContain(issued.token);
    await fixture.store.revokeApiToken(issued.id);
    expect(fixture.service.resolveActor(actor)).toBeNull();
});
