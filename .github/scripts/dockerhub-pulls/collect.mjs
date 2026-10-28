import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const repositories = ['zackwag/caddy-ui-backend', 'zackwag/caddy-ui-frontend'];
export const emptyHistory = () => ({ version: 1, repositories: {} });

export function validateHistory(history) {
    if (history?.version !== 1 || !history.repositories ||
        typeof history.repositories !== 'object' || Array.isArray(history.repositories)) {
        throw new Error('Unsupported pull history');
    }
    for (const samples of Object.values(history.repositories)) {
        if (!Array.isArray(samples)) {
            throw new Error('Invalid repository history');
        }
        let previousDay = '';
        for (const sample of samples) {
            const timestamp = sample?.observedAt;
            if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)) ||
                new Date(timestamp).toISOString() !== timestamp) {
                throw new Error('Invalid observation timestamp');
            }
            const day = timestamp.slice(0, 10);
            if (day <= previousDay) {
                throw new Error('Pull history must have one observation per day in chronological order');
            }
            previousDay = day;
            if (!Number.isSafeInteger(sample.pullCount) || sample.pullCount < 0) {
                throw new Error('Invalid stored pull count');
            }
        }
    }
    return history;
}

export async function collect(history, { fetchImpl = fetch, now = new Date() } = {}) {
    validateHistory(history);
    const observedAt = now.toISOString();
    const updates = await Promise.all(repositories.map(async repository => {
        const samples = history.repositories[repository] || [];
        const last = samples.at(-1);
        if (last && last.observedAt > observedAt) {
            throw new Error('Observation predates the latest stored sample');
        }
        // Keep the first successful observation, even if a manual rerun sees a
        // higher count. Failed runs never created an observation to replace.
        if (last?.observedAt.slice(0, 10) === observedAt.slice(0, 10)) {
            return [repository, samples];
        }
        const response = await fetchImpl(`https://hub.docker.com/v2/repositories/${repository}/`, {
            signal: AbortSignal.timeout(15000),
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`Docker Hub returned HTTP ${response.status} for ${repository}`);
        }
        const value = await response.json();
        const pullCount = value?.pull_count;
        if (!Number.isSafeInteger(pullCount) || pullCount < 0) {
            throw new Error(`Docker Hub returned an invalid pull count for ${repository}`);
        }
        return [repository, [...samples, { observedAt, pullCount }]];
    }));
    if (updates.every(([repository, samples]) => samples === history.repositories[repository])) {
        return history;
    }
    return validateHistory({ version: 1, repositories: { ...history.repositories, ...Object.fromEntries(updates) } });
}

export async function run(directory) {
    const historyPath = join(directory, 'history.json');
    let history;
    try {
        history = JSON.parse(await readFile(historyPath, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
        history = emptyHistory();
    }
    // Both API reads must succeed before either repository's history changes.
    const updated = await collect(history);
    await mkdir(directory, { recursive: true });
    await writeFile(historyPath, JSON.stringify(updated, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    run(resolve(process.argv[2] || 'dockerhub-pulls')).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
