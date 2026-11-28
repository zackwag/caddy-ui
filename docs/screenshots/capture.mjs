import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { docker } from '../../dev/dev-caddy/harness.mjs';
import { EXAMPLE_SITES as SITES, containerAddress, exampleCaddyfile, exampleUpstreamCaddyfile } from '../../dev/dev-caddy/examples.mjs';
import { captureFromCommandLine, hideInstance, runCapture } from '../../dev/playground/capture-session.mjs';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');

// Seed the normal persisted history format, not an invented API response.
// These illustrative samples are distinct from the traffic measured below.
async function seedHistory(path, address) {
    const now = Date.now();
    const entries = Array.from({ length: 48 }, (_, i) => ({ at: now - (48 - i) * 30 * 60_000, online: i !== 10 }));
    const entry = { firstSeen: entries[0].at, entries };
    await writeFile(path, JSON.stringify(Object.fromEntries([
        ...SITES.map(site => ['default:' + address + ':' + site.port, entry]),
        ...SITES.map(site => ['default#' + site.domain, entry]),
    ])));
}

// Only HTTP and the admin API are published, so request the HTTPS sites from
// inside the container. Prints "<domain> <path> <status>" per request.
function trafficScript(paths) {
    const domains = SITES.map(site => site.domain).join(' ');
    return `echo "127.0.0.1 ${domains}" >> /etc/hosts
for domain in ${domains}; do
    for path in ${paths.join(' ')}; do
        status=$(wget -S --no-check-certificate -O /dev/null "https://$domain$path" 2>&1 | awk '$1 ~ /^HTTP\\// { print $2 }' | tail -n 1)
        echo "$domain $path $status"
    done
done`;
}

export function captureScreenshots({ output = resolve(import.meta.dirname, 'captures/screenshots.json'), ...options } = {}) {
    return runCapture({ name: 'screenshots', output, ...options }, async ({ harness, until, environment, startBackend }) => {
        const info = await harness.create('screenshots');
        // The second owned Caddy serves each example site's upstream port.
        const staging = await harness.create('staging', { caddyfile: exampleUpstreamCaddyfile() });
        const address = await containerAddress(harness, staging.instance.containerName);
        const appVersion = JSON.parse(await readFile(resolve(root, '.release-please-manifest.json'), 'utf8'))['.'];
        const env = environment(info.instance, { APP_VERSION: appVersion });
        await mkdir(resolve(env.UPTIME_HISTORY_PATH, '..'), { recursive: true });
        await seedHistory(env.UPTIME_HISTORY_PATH, address);
        const { successful } = await startBackend(env);

        await successful('/settings', 'PUT', { firstTimeRun: false, language: 'en', theme: 'dark' });

        // Exercise the real session/CSRF-protected configuration-write path.
        await successful('/server-names/srv0', 'PUT', { name: 'Production HTTPS' });
        await successful('/caddyfile?fmt=false&sort=false', 'PUT', exampleCaddyfile(address));
        for (const site of SITES) {
            await successful('/route-notes/' + encodeURIComponent(site.domain), 'PUT', { note: site.title });
        }

        // Local certificates are issued asynchronously; wait for actual storage.
        await until(() => successful('/tls'), record => record.response.body.length >= SITES.length, 'Caddy did not issue the example site certificates');

        // Populate logs and request counters with real HTTPS traffic to owned services.
        const paths = ['/', '/media', '/error'];
        const traffic = await docker(['exec', info.instance.containerName, 'sh', '-c', trafficScript(paths)]);
        assert.deepEqual(traffic.trim().split('\n'), SITES.flatMap(site => paths.map(path => `${site.domain} ${path} ${path === '/error' ? 503 : 200}`)));

        // Configure notifications. Nothing is sent: upstreams stay online, the
        // first check only records a baseline, and expiry alerts skip local
        // certificates. The update check would query GitHub, so it stays off.
        await successful('/notifications/config', 'PUT', {
            enabled: true, provider: 'ntfy', ntfy: { url: 'https://ntfy.example.com/caddy-alerts' },
            triggers: { upstreamOffline: true, upstreamOnline: true, certExpiring: true, updateAvailable: false, routeOffline: true, routeOnline: true },
            debounceMinutes: 30,
        });

        // Both entries belong to disposable Caddy instances, so capture never
        // probes an unrelated LAN service to populate the Instances view.
        await successful('/instances', 'POST', {
            ...staging.instance, name: 'Staging Server',
        });

        // Capture global endpoints.
        const requests = [];
        requests.push(await successful('/languages'));
        requests.push(await successful('/settings'));
        requests.push(await successful('/custom-themes'));
        requests.push(await successful('/version'));
        // The renderer builds the frontend as this version, so the footer shows one.
        requests.push(await successful('/version?frontend=' + encodeURIComponent(appVersion)));
        requests.push(await successful('/instances'));
        requests.push(await successful('/instances/status'));
        requests.push(await successful('/auth/status'));

        // Dashboard.
        requests.push(await successful('/status'));
        requests.push(await successful('/status/process'));
        requests.push(await successful('/server-names'));
        requests.push(await successful('/health'));

        // Caddyfile.
        requests.push(await successful('/caddyfile'));
        const history = await successful('/caddyfile/history');
        requests.push(history);
        for (const entry of history.response.body) {
            requests.push(await successful('/caddyfile/history/' + encodeURIComponent(entry.filename)));
        }

        // Routes.
        requests.push(await successful('/routes'));
        requests.push(await successful('/tls'));
        requests.push(await successful('/route-notes'));
        requests.push(await successful('/routes/maintenance'));
        requests.push(await successful('/health/uptime'));
        requests.push(await successful('/health/uptime?kind=route'));

        // TLS (shares /tls from routes above).

        // Logs.
        requests.push(await successful('/logs'));
        requests.push(await successful('/logs/config'));

        // Metrics.
        requests.push(await successful('/metrics'));
        requests.push(await successful('/metrics/config'));

        // Notifications.
        requests.push(await successful('/notifications/config'));

        // Instances — server-names/all and per-instance server query.
        requests.push(await successful('/server-names/all'));
        requests.push(await successful('/instances/servers?adminUrl=' + encodeURIComponent(info.instance.adminUrl)));
        requests.push(await successful('/instances/servers?adminUrl=' + encodeURIComponent(staging.instance.adminUrl)));

        return {
            source: { sampleHistory: 'Illustrative 24-hour uptime history seeded into backend storage; request metrics and certificates are generated live.' },
            scenarios: [{ id: 'screenshots', requests }],
            replacements: [
                ...hideInstance(staging, 'caddy-staging'),
                ...SITES.map(site => [address + ':' + site.port, site.service + ':' + site.port]),
                ...hideInstance(info, 'caddy-screenshots'),
            ],
        };
    });
}

await captureFromCommandLine(import.meta.url, captureScreenshots, capture => `Captured ${capture.scenarios[0].requests.length} API responses`);
