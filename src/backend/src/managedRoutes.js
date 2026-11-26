import { randomUUID } from 'node:crypto';
import { AppError, asAppError } from './AppError.js';
import { caddyDelete, caddyGetTagged, caddyPatch, caddyPost, caddyPut } from './caddy.js';
import { queueCaddyfileChange, readSiteEnv, saveCaddyfileChange } from './caddyfileChange.js';
import { appendSiteBlock, extractSiteBlock, removeSiteBlock, replaceSiteBlock } from './caddyfileSites.js';
import { routeExpectation } from './configExpectation.js';
import { verifyLiveObject, verifyLiveObjectRemoved } from './configVerification.js';
import logger from './logger.js';
import { buildReverseProxyRoute, buildSiteBlock } from './reverseProxyRoute.js';
import { getHost } from './upstreamChecks.js';

// Changes to an instance's routes: Caddyfile site blocks, and UI-managed
// routes (ones with an @id), which change both the running config and the
// site block they were added with.

// Admin API route edits send If-Match with the ETag of the read they're based
// on, so Caddy refuses them with 412 if that part of the config changed in
// between instead of overwriting someone else's change. That's a confirmed
// rejection, never retried: a retry would act on a state nobody reviewed.
// Without an ETag (Caddy before 2.6) the write is unconditional, as before.
function ifUnchanged(write) {
    return async () => {
        try {
            return await write();
        } catch (error) {
            if (error?.status === 412) {
                throw new AppError('CONFIG_CHANGED', { cause: error });
            }
            throw error;
        }
    };
}

// Adds a reverse proxy route to the instance's primary server and its site
// block to the Caddyfile. Resolves to { id, route, result }.
export async function addManagedRoute(instance, { domain, upstream, stripPrefix }, actor) {
    const { adminUrl, serverName: primaryServer } = instance;
    const id = `route-${randomUUID()}`;
    const route = buildReverseProxyRoute({ id, domain, upstream, stripPrefix });
    const routesPath = `/config/apps/http/servers/${primaryServer}/routes`;
    const result = await queueCaddyfileChange(instance, async ({ save }) => {
        // Read inside the queue, before changing the file, so a read that
        // fails or times out can't leave a saved route that was never sent to Caddy.
        let current, etag;
        try { ({ value: current, etag } = await caddyGetTagged('/config/apps/http/servers', adminUrl)); }
        catch (error) { throw asAppError(error, 'CADDY_CONFIG_UNAVAILABLE', { instanceId: instance.id }); }
        // Caddy happily accepts routes for a server ID that doesn't exist,
        // creating a server with no listen address, so the route would never serve traffic.
        const servers = Object.keys(current || {});
        if (!servers.includes(primaryServer)) {
            logger.warn('Route not added: primary server missing', { primaryServer, servers });
            throw new AppError('VALIDATION_FAILED', { context: { field: 'serverName', primaryServer, servers } });
        }
        // Caddy checks If-Match against the path the ETag names, so the
        // servers read guards the add, including the PUT that creates a
        // missing routes array (which has no ETag of its own yet).
        const addLive = ifUnchanged(() => current[primaryServer].routes
            ? caddyPost(routesPath, route, adminUrl, { ifMatch: etag })
            : caddyPut(routesPath, [route], adminUrl, { ifMatch: etag }));
        // The file still precedes the mutation, so a rejected write can
        // restore it and a dispatched write timeout can keep it.
        return save(previous => appendSiteBlock(previous, buildSiteBlock({ domain, upstream, stripPrefix })), {
            live: {
                apply: addLive,
                verify: () => verifyLiveObject(instance, id, route),
                expectLive: routeExpectation({ operation: 'add', serverName: primaryServer, route }),
            },
            actor, action: 'route.add',
        });
    });
    return { id, route, result };
}

// Changes the domain's site block: `edit(caddyfile, env)` gets a Caddyfile that
// has one and returns it changed. NOT_FOUND when it has none.
export function changeSite(instance, domain, edit, options) {
    return saveCaddyfileChange(instance, async previous => {
        const env = await readSiteEnv(instance);
        if (!extractSiteBlock(previous, domain, env)) {
            throw new AppError('NOT_FOUND');
        }
        return edit(previous, env);
    }, options);
}

// Changes a UI-managed route and the site block it was added with.
// `liveChange(ifMatch)` is how it reaches the running config and
// `edit(caddyfile, domain, env)` how it reaches the file. A route Caddy doesn't
// have, or one without a host, has no block to find, so only the running
// config changes.
function changeManagedRoute(instance, id, { liveChange, edit, actor, action }) {
    return queueCaddyfileChange(instance, async ({ save, applyLive }) => {
        let read = null;
        try {
            read = await caddyGetTagged(`/id/${id}`, instance.adminUrl);
        } catch (err) {
            if (err?.status !== 404) {
                throw asAppError(err, 'CADDY_CONFIG_UNAVAILABLE', { instanceId: instance.id });
            }
            logger.warn('The route to change is not in the running config', { id, action });
        }
        const domain = read?.value ? getHost(read.value) : null;
        const change = liveChange({ ifMatch: read?.etag });
        const live = { ...change, apply: ifUnchanged(change.apply) };
        if (!domain) {
            return applyLive(live);
        }
        return save(async previous => edit(previous, domain, await readSiteEnv(instance)), { live, actor, action });
    });
}

// Resolves to { route, result }.
export async function updateManagedRoute(instance, id, { domain, upstream, stripPrefix }, actor) {
    const route = buildReverseProxyRoute({ id, domain, upstream, stripPrefix });
    const result = await changeManagedRoute(instance, id, {
        liveChange: options => ({
            apply: () => caddyPatch(`/id/${id}`, route, instance.adminUrl, options),
            verify: () => verifyLiveObject(instance, id, route),
            expectLive: routeExpectation({ operation: 'replace', id, route }),
        }),
        edit: (caddyfile, oldDomain, env) => replaceSiteBlock(caddyfile, oldDomain, buildSiteBlock({ domain, upstream, stripPrefix }), env),
        actor, action: 'route.edit',
    });
    return { route, result };
}

export function deleteManagedRoute(instance, id, actor) {
    return changeManagedRoute(instance, id, {
        liveChange: options => ({
            apply: () => caddyDelete(`/id/${id}`, instance.adminUrl, options),
            verify: () => verifyLiveObjectRemoved(instance, id),
            expectLive: routeExpectation({ operation: 'remove', id }),
        }),
        edit: removeSiteBlock,
        actor, action: 'route.delete',
    });
}
