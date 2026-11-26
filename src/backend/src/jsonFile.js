import { randomBytes } from 'node:crypto';
import { constants, link, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import logger from './logger.js';
import { createSerialQueue } from './serialQueue.js';

// Contents that can't be used. A store's `parse` throws it for a file it
// can't make sense of, which is then set aside like one that isn't JSON.
export class CorruptJsonError extends Error {
    constructor(path, cause) {
        super(`Could not parse ${path}`, { cause });
        this.name = 'CorruptJsonError';
        this.path = path;
    }
}

// undefined when the file doesn't exist; CorruptJsonError when it can't be
// parsed, so an unreadable file is never mistaken for an empty one.
export async function readJsonFile(path, { noFollow = false } = {}) {
    let raw;
    try {
        if (noFollow) {
            const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                raw = await handle.readFile('utf8');
            } finally {
                await handle.close();
            }
        } else {
            raw = await readFile(path, 'utf8');
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new CorruptJsonError(path, error);
    }
}

// Readers never see a partial file: the content is synced to a temporary file
// beside the target, then renamed over it. `exclusive` links instead, which
// fails if the target already exists, across processes as well as requests.
export async function writeJsonFile(path, value, { mode = 0o644, dirMode, exclusive = false, space = 2 } = {}) {
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, ...(dirMode ? { mode: dirMode } : {}) });
    const temporary = join(directory, `.${basename(path)}-${randomBytes(8).toString('hex')}.tmp`);
    let handle;
    try {
        handle = await open(temporary, 'wx', mode);
        await handle.writeFile(JSON.stringify(value, null, space) + '\n');
        await handle.sync();
        await handle.close();
        handle = null;
        if (exclusive) {
            await link(temporary, path);
        } else {
            await rename(temporary, path);
        }
    } finally {
        if (handle) {
            await handle.close();
        }
        await unlink(temporary).catch(error => {
            if (error.code !== 'ENOENT') {
                logger.warn('Could not remove temporary file', { path: temporary, code: error.code });
            }
        });
    }
}

// Like readJsonFile, but a file that can't be parsed is moved out of the way
// and reads as missing, so starting from defaults can't overwrite it. `parse`
// turns the contents into state, and is told when the file was set aside.
export async function readJsonState(path, parse = value => value) {
    try {
        return parse(await readJsonFile(path));
    } catch (error) {
        if (!(error instanceof CorruptJsonError)) {
            throw error;
        }
        const target = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        await rename(path, target);
        logger.error('A state file could not be parsed; it was set aside and defaults are used', { path, savedAs: target, error: error.cause?.message });
        return parse(undefined, { setAside: true });
    }
}

// An in-memory copy of one JSON file. `parse` turns the file's contents
// (undefined when there is none) into state; `serialize` turns state back
// into the file's contents. `update` derives the next state from a copy of
// the current one inside a queue, and publishes it only after it is written,
// so a failed write leaves memory and disk in agreement.
export function createJsonStore(path, { parse, serialize = state => state, mode } = {}) {
    const queue = createSerialQueue();
    let state = parse(undefined);

    return {
        async load() {
            state = await readJsonState(path, parse);
            return state;
        },
        // Replaces the in-memory state without writing, for state derived at
        // load time that should only reach disk with the next change.
        hydrate(next) {
            state = next;
        },
        get() {
            return state;
        },
        update(change) {
            return queue(async () => {
                const draft = structuredClone(state);
                const result = await change(draft);
                if (result === false) {
                    return state;
                }
                const next = result === undefined ? draft : result;
                await writeJsonFile(path, serialize(next), { mode });
                state = next;
                return state;
            });
        },
        set(next) {
            return this.update(() => next);
        },
    };
}
