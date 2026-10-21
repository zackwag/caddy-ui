import { caddyfileEntries } from './caddyfileBlocks.js';
import { getCaddyEnv, resolveEnvVars } from './docker.js';
import logger from './logger.js';
import { hasStoredNotes } from './routeNotes.js';

let _enabled = null;

export async function initCaddyfileTitles() {
    const envVal = process.env.CADDYFILE_TITLES;
    if (envVal !== undefined) {
        _enabled = envVal.toLowerCase() !== 'false' && envVal !== '0';
        logger.info('Caddyfile titles', { enabled: _enabled, source: 'env' });
        return;
    }

    if (await hasStoredNotes()) {
        _enabled = false;
        logger.info('Caddyfile titles', { enabled: false, source: 'auto', reason: 'existing route-notes.json entries found' });
        return;
    }
    _enabled = true;
    logger.info('Caddyfile titles', { enabled: true, source: 'auto', reason: 'no route notes stored' });
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

    for (const entry of caddyfileEntries(caddyfileContent)) {
        if (!entry.block || !entry.name || entry.args.length) continue;
        const domain = resolveEnvVars(entry.name, env).replace(/^https?:\/\//, '');
        // The title is the first comment before the block's first directive.
        // Skip the remainder of the opening `{` line, as the header did before.
        for (const line of entry.block.inner.split('\n').slice(1)) {
            const trimmed = line.trim();
            if (trimmed.startsWith('#')) {
                if (!titles[domain]) titles[domain] = trimmed.replace(/^#\s*/, '');
                break;
            }
            if (trimmed !== '') break;
        }
    }

    return titles;
}
