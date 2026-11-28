import { isDeepStrictEqual } from 'node:util';

const pointer = segments => segments.map(segment => '/' + segment.replace(/~/g, '~0').replace(/\//g, '~1')).join('') || '/';

// JSON Pointers to every difference between two JSON values: keys and indexes
// only, never values.
export function changedPaths(before, after, segments = [], paths = []) {
    const container = value => value !== null && typeof value === 'object';
    if (!container(before) || !container(after) || Array.isArray(before) !== Array.isArray(after)) {
        if (!isDeepStrictEqual(before, after)) {
            paths.push(pointer(segments));
        }
        return paths;
    }
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    // Array indexes keep their order; object keys are sorted.
    for (const key of Array.isArray(before) ? keys : keys.sort()) {
        if (!Object.hasOwn(before, key) || !Object.hasOwn(after, key)) {
            paths.push(pointer([...segments, key]));
        } else {
            changedPaths(before[key], after[key], [...segments, key], paths);
        }
    }
    return paths;
}
