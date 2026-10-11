// Records freshly pushed image versions in versions.json, which the backend's
// update check (backend/src/updateCheck.js) reads from the `versions` branch.
//
// Usage: node record-versions.mjs <file> <channel> <component>=<version>...
//   e.g. node record-versions.mjs versions.json edge frontend=edge-abc1234
//
// Each channel/component keeps its newest HISTORY_LIMIT versions, newest
// first. The history lets the backend tell an older edge/beta build (offer
// an update) from one it hasn't seen yet (stay quiet).
import { readFileSync, writeFileSync } from 'fs';

const HISTORY_LIMIT = 20;
const CHANNELS = ['stable', 'beta', 'edge'];
const COMPONENTS = ['frontend', 'backend'];

function recordVersions(data, channel, entries) {
    const next = data?.schema === 1 && data.channels ? structuredClone(data) : { schema: 1, channels: {} };
    next.channels[channel] ??= {};
    for (const [component, version] of entries) {
        const history = (next.channels[channel][component] || []).filter(v => v !== version);
        next.channels[channel][component] = [version, ...history].slice(0, HISTORY_LIMIT);
    }
    return next;
}

function main([file, channel, ...pairs]) {
    if (!CHANNELS.includes(channel)) throw new Error(`channel must be one of ${CHANNELS.join(', ')}`);
    const entries = pairs.map(pair => {
        const [component, version] = pair.split('=');
        if (!COMPONENTS.includes(component) || !version) throw new Error(`bad entry: ${pair}`);
        return [component, version];
    });
    if (!entries.length) throw new Error('nothing to record');

    let data = null;
    try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first run */ }
    writeFileSync(file, `${JSON.stringify(recordVersions(data, channel, entries), null, 2)}\n`);
}

main(process.argv.slice(2));
