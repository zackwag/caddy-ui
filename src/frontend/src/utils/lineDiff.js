// Line-level diff (Myers' O(ND) algorithm) for comparing Caddyfile versions.
// Caddyfiles are small, so this skips the linear-space refinement and just
// keeps the frontier of each edit step for the backtrack -- O(D^2) memory,
// capped by MAX_EDITS.

// Past this many edits the files have little in common anyway, so show the
// changed region as a plain delete + add instead of searching further.
const MAX_EDITS = 2000;

function splitLines(text) {
    if (text === '') return [];
    const lines = text.split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
}

// Returns the shortest edit script from `a` to `b` as ops in order:
// { type: 'equal' | 'del' | 'add', text }
function myers(a, b) {
    const n = a.length, m = b.length, max = Math.min(n + m, MAX_EDITS), off = max + 1;
    const v = new Int32Array(2 * max + 3);
    // trace[d] holds v[-d-1..d+1] as it stood before step d: the only
    // diagonals step d (and so the backtrack through it) ever reads.
    const trace = [];
    let found = false;
    for (let d = 0; d <= max && !found; d++) {
        trace.push(v.slice(off - d - 1, off + d + 2));
        for (let k = -d; k <= d; k += 2) {
            let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) { x++; y++; }
            v[off + k] = x;
            if (x >= n && y >= m) { found = true; break; }
        }
    }
    if (!found) {
        return [...a.map(text => ({ type: 'del', text })), ...b.map(text => ({ type: 'add', text }))];
    }

    const ops = [];
    let x = n, y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
        const vd = trace[d], base = d + 1;
        const k = x - y;
        const prevK = (k === -d || (k !== d && vd[base + k - 1] < vd[base + k + 1])) ? k + 1 : k - 1;
        const prevX = vd[base + prevK];
        const prevY = prevX - prevK;
        while (x > prevX && y > prevY) { ops.push({ type: 'equal', text: a[x - 1] }); x--; y--; }
        if (d === 0) break;
        if (x === prevX) { ops.push({ type: 'add', text: b[y - 1] }); y--; }
        else { ops.push({ type: 'del', text: a[x - 1] }); x--; }
    }
    return ops.reverse();
}

// Diffs two texts line by line. Each line carries its 1-based line number on
// the old side (`oldNo`) and/or new side (`newNo`).
export function diffLines(oldText, newText) {
    const a = splitLines(oldText), b = splitLines(newText);

    // Trim the shared prefix/suffix first so the O(ND) part only sees the edits.
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length, endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

    const ops = [
        ...a.slice(0, start).map(text => ({ type: 'equal', text })),
        ...myers(a.slice(start, endA), b.slice(start, endB)),
        ...a.slice(endA).map(text => ({ type: 'equal', text })),
    ];

    let oldNo = 0, newNo = 0;
    return ops.map(op => {
        if (op.type === 'equal') return { ...op, oldNo: ++oldNo, newNo: ++newNo };
        if (op.type === 'del') return { ...op, oldNo: ++oldNo, newNo: null };
        return { ...op, oldNo: null, newNo: ++newNo };
    });
}

// Collapses long unchanged runs, keeping `context` lines around each change.
// Collapsed runs become { type: 'skip', count }.
export function collapseUnchanged(lines, context = 3) {
    const keep = new Uint8Array(lines.length);
    lines.forEach((line, i) => {
        if (line.type === 'equal') return;
        for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep[j] = 1;
    });

    const out = [];
    let skipped = 0;
    lines.forEach((line, i) => {
        if (keep[i]) {
            if (skipped) { out.push({ type: 'skip', count: skipped }); skipped = 0; }
            out.push(line);
        } else {
            skipped++;
        }
    });
    if (skipped) out.push({ type: 'skip', count: skipped });
    return out;
}
