import { readFile } from 'fs/promises';
import { getCaddyEnv, resolveEnvVars } from './docker.js';
import logger from './logger.js';

const ROUTE_NOTES_PATH = process.env.ROUTE_NOTES_PATH || '/etc/caddy-ui/route-notes.json';

let _enabled = null;

export async function initCaddyfileTitles() {
    const envVal = process.env.CADDYFILE_TITLES;
    if (envVal !== undefined) {
        _enabled = envVal.toLowerCase() !== 'false' && envVal !== '0';
        logger.info('Caddyfile titles', { enabled: _enabled, source: 'env' });
        return;
    }

    let reason = 'no route-notes.json file found';
    try {
        const data = await readFile(ROUTE_NOTES_PATH, 'utf8');
        const notes = JSON.parse(data);
        if (Object.keys(notes).length > 0) {
            _enabled = false;
            logger.info('Caddyfile titles', { enabled: false, source: 'auto', reason: 'existing route-notes.json entries found' });
            return;
        }
        reason = 'route-notes.json has no entries';
    } catch {
        // file doesn't exist or is invalid
    }

    _enabled = true;
    logger.info('Caddyfile titles', { enabled: true, source: 'auto', reason });
}

export function caddyfileTitlesEnabled() {
    return _enabled === true;
}

export function extractTitleComment(blockContent) {
    const lines = blockContent.split('\n');
    let titleLine = -1;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === '' || trimmed.endsWith('{')) continue;
        if (trimmed.startsWith('#')) {
            titleLine = i;
        }
        break;
    }

    if (titleLine === -1) return { title: '', content: blockContent };

    const title = lines[titleLine].trim().replace(/^#\s*/, '');
    const remaining = [...lines.slice(0, titleLine), ...lines.slice(titleLine + 1)];
    return { title, content: remaining.join('\n') };
}

export function injectTitleComment(blockContent, title) {
    if (!title || !title.trim()) return blockContent;

    const lines = blockContent.split('\n');
    let insertAt = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().endsWith('{')) {
            insertAt = i + 1;
            break;
        }
    }

    if (insertAt === -1) return blockContent;

    const indent = lines[insertAt]?.match(/^(\s*)/)?.[1] || '    ';
    lines.splice(insertAt, 0, `${indent}# ${title.trim()}`);
    return lines.join('\n');
}

export async function parseCaddyfileTitles(caddyfileContent, containerName) {
    const env = await getCaddyEnv(containerName);
    const titles = {};
    const lines = caddyfileContent.split('\n');
    let i = 0;

    while (i < lines.length) {
        const trimmed = lines[i].trim();
        const blockMatch = trimmed.match(/^(\S+)\s*\{$/);
        if (!blockMatch) { i++; continue; }

        const rawAddr = blockMatch[1];
        const resolved = resolveEnvVars(rawAddr, env);
        const domain = resolved.replace(/^https?:\/\//, '');
        let depth = 1;
        i++;

        for (; i < lines.length && depth > 0; i++) {
            const lt = lines[i].trim();
            if (depth === 1 && lt.startsWith('#') && !titles[domain]) {
                titles[domain] = lt.replace(/^#\s*/, '');
            } else if (lt !== '' && !lt.startsWith('#')) {
                break;
            }
            for (const ch of lines[i]) {
                if (ch === '{') depth++;
                if (ch === '}') depth--;
            }
        }

        while (i < lines.length) {
            for (const ch of lines[i]) {
                if (ch === '{') depth++;
                if (ch === '}') depth--;
            }
            i++;
            if (depth === 0) break;
        }
    }

    return titles;
}
