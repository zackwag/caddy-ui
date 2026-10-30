import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { options } from './history-inventory.mjs';

const exec = promisify(execFile);

export async function collectHistory({ repository, timeoutMs = 95 * 60 * 1000, pollMs = 15000,
    execute = exec, sleep = delay, signal, notify = console.log }) {
    if (!/^[A-Za-z0-9-]+\/(?!\.{1,2}$)[\w.-]+$/.test(repository || '')) throw new Error('Expected an explicit archive owner/repository');
    const bounded = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    const api = async args => {
        bounded.throwIfAborted();
        return (await execute('gh', ['api', ...args], { signal: bounded, timeout: 30000, maxBuffer: 4 * 1024 * 1024 })).stdout;
    };
    // Dispatch exactly once. A failed/ambiguous response is not retried, since
    // GitHub may already have accepted the request.
    const dispatched = JSON.parse(await api(['--method', 'POST', `repos/${repository}/actions/workflows/docs.yml/dispatches`,
        '-f', 'ref=main', '-f', 'inputs[archive_history]=true', '-F', 'return_run_details=true']));
    const id = dispatched?.workflow_run_id;
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Dispatch did not return a valid archive workflow run ID; inspect the fork before retrying');
    const url = `https://github.com/${repository}/actions/runs/${id}`;
    notify(`Requested archive collection: ${url}`);
    let previous;
    let pollFailures = 0;
    try {
        while (true) {
            let response;
            try {
                response = await api([`repos/${repository}/actions/runs/${id}`]);
                pollFailures = 0;
            } catch (error) {
                bounded.throwIfAborted();
                // Reads are safe to retry. Three consecutive failures are
                // tolerated; a fourth stops publication. Never redispatch.
                if (++pollFailures >= 4) throw error;
                notify(`Archive status lookup failed (${pollFailures}/4); retrying: ${url}`);
                await sleep(pollMs, undefined, { signal: bounded });
                continue;
            }
            const run = JSON.parse(response);
            if (run?.id !== id || run.event !== 'workflow_dispatch' || run.head_branch !== 'main'
                || !['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'].includes(run.status)) {
                throw new Error('Invalid dispatched archive workflow run');
            }
            if (previous !== run.status) notify(`Archive collection ${run.status}: ${url}`);
            previous = run.status;
            if (run.status === 'completed') {
                if (run.conclusion !== 'success') throw new Error(`Archive collection ${run.conclusion || 'did not succeed'}: ${url}`);
                return id;
            }
            await sleep(pollMs, undefined, { signal: bounded });
        }
    } catch (error) {
        signal?.throwIfAborted();
        if (bounded.aborted) throw new Error(`Timed out waiting for archive collection ${url}`, { cause: error });
        throw error;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const controller = new AbortController();
    const stop = () => controller.abort(new Error('Collection wait interrupted'));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
        const args = options(process.argv.slice(2), ['repository']);
        await collectHistory({ repository: args.repository, signal: controller.signal });
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
    }
}
