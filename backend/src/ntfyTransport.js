import http from 'node:http';
import https from 'node:https';
import { createNtfyPolicy } from './ntfyPolicy.js';

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
let policy;

/** Resolve once per delivery; never let the HTTP client resolve another address. */
export async function sendNtfy(url, notification, { resolveDestination, timeoutMs = TIMEOUT_MS } = {}) {
    const resolve = resolveDestination || (policy ||= createNtfyPolicy());
    const destination = await resolve(url);
    const { title, message, priority } = notification;
    const client = destination.url.protocol === 'https:' ? https : http;
    await new Promise((resolve, reject) => {
        const request = client.request(destination.url, {
            method: 'POST',
            headers: { Title: title, Priority: priority || 'default', 'Content-Type': 'text/plain; charset=utf-8' },
            // Keep the original Host and TLS server name/certificate verification.
            // A fresh connection cannot reuse a socket authorized by an older DNS answer.
            agent: false,
            family: destination.family,
            autoSelectFamily: false,
            lookup: (_host, options, callback) => {
                if (options.all) callback(null, [{ address: destination.address, family: destination.family }]);
                else callback(null, destination.address, destination.family);
            },
        }, response => {
            const chunks = [];
            let size = 0;
            response.on('error', reject);
            response.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_RESPONSE_BYTES) request.destroy(new Error('ntfy response exceeds size limit'));
                else chunks.push(chunk);
            });
            response.on('end', () => {
                if (response.statusCode >= 200 && response.statusCode < 300) resolve();
                else if (response.statusCode >= 300 && response.statusCode < 400) reject(new Error('ntfy redirects are not permitted; configure the final topic URL'));
                else reject(new Error(`ntfy responded ${response.statusCode}: ${Buffer.concat(chunks).toString('utf8')}`));
            });
        });
        // A wall-clock deadline also bounds a peer that continually sends tiny chunks.
        const timer = setTimeout(() => request.destroy(new Error('ntfy request timed out')), timeoutMs);
        request.on('close', () => clearTimeout(timer));
        request.on('error', reject);
        request.end(message);
    });
}
