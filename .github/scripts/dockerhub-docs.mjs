import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const readmeUrl = 'https://github.com/zackwag/caddy-ui';
const maxBytes = 25_000;

const sourcePath = path.resolve(repoRoot, 'README.md');
const outputPaths = {
    backend: path.resolve(
        repoRoot,
        process.env.DOCKERHUB_BACKEND_PATH || 'backend/DOCKERHUB.md',
    ),
    frontend: path.resolve(
        repoRoot,
        process.env.DOCKERHUB_FRONTEND_PATH || 'frontend/DOCKERHUB.md',
    ),
};

const validMarker =
    /^<!-- dockerhub:(both|backend|frontend):(start|end) -->$/;

// Recognize small namespace typos without silently correcting them.
function editDistance(left, right) {
    let previous = Array.from(
        { length: right.length + 1 },
        (_, index) => index,
    );

    for (let row = 1; row <= left.length; row++) {
        const current = [row];

        for (let column = 1; column <= right.length; column++) {
            current[column] = Math.min(
                current[column - 1] + 1,
                previous[column] + 1,
                previous[column - 1] +
                (left[row - 1] === right[column - 1] ? 0 : 1),
            );
        }

        previous = current;
    }

    return previous[right.length];
}

function looksLikeMarker(line) {
    // Limit typo detection to comment-like lines.
    if (!line.trimStart().startsWith('<')) return false;

    const namespace = line.match(
        /\b([a-z][a-z0-9_-]*)\s*:/i,
    )?.[1];

    if (!namespace) return false;

    const normalized = namespace.toLowerCase().replace(/[-_]/g, '');
    return editDistance(normalized, 'dockerhub') <= 2;
}

function newMarkdownState() {
    return { commentLine: null, rawTag: null, inlineTicks: null };
}

function findInlineClose(line, from, length) {
    const runs = /`+/g;
    runs.lastIndex = from;
    for (let match; (match = runs.exec(line));) {
        if (match[0].length === length) {
            return { start: match.index, end: runs.lastIndex };
        }
    }
    return null;
}

function hasInlineClose(lines, lineIndex, from, length) {
    for (let index = lineIndex; index < lines.length; index++) {
        // Inline spans may cross lines, but not paragraph boundaries.
        if (index > lineIndex && lines[index].trim() === '') return false;
        if (findInlineClose(lines[index], index === lineIndex ? from : 0, length)) {
            return true;
        }
    }
    return false;
}

function escapedAt(line, index) {
    let count = 0;
    while (index > 0 && line[--index] === '\\') count++;
    return count % 2 === 1;
}

// Scan code/comment regions once; only ordinary Markdown is transformed.
// Raw HTML code regions are pre, code, script, style, and textarea elements.
function scanLine(line, lineIndex, lines, state, transform = text => text) {
    let result = '';
    let position = 0;

    while (position < line.length) {
        if (state.commentLine !== null) {
            const closing = line.indexOf('-->', position);
            const end = closing === -1 ? line.length : closing + 3;
            result += line.slice(position, end);
            position = end;
            if (closing !== -1) state.commentLine = null;
            continue;
        }
        if (state.rawTag) {
            const closing = new RegExp(`</${state.rawTag.name}\\s*>`, 'i');
            const match = closing.exec(line.slice(position));
            const end = match ? position + match.index + match[0].length : line.length;
            result += line.slice(position, end);
            position = end;
            if (match) state.rawTag = null;
            continue;
        }
        if (state.inlineTicks !== null) {
            const closing = findInlineClose(line, position, state.inlineTicks);
            const end = closing ? closing.end : line.length;
            result += line.slice(position, end);
            position = end;
            if (closing) state.inlineTicks = null;
            continue;
        }

        const tokens = /`+|<!--|<(pre|code|script|style|textarea)\b[^>]*>/gi;
        tokens.lastIndex = position;
        const token = tokens.exec(line);
        if (!token) {
            result += transform(line.slice(position));
            break;
        }

        result += transform(line.slice(position, token.index));
        result += token[0];
        position = tokens.lastIndex;

        if (escapedAt(line, token.index)) continue;
        if (token[0][0] === '`') {
            if (hasInlineClose(lines, lineIndex, position, token[0].length)) {
                state.inlineTicks = token[0].length;
            }
        } else if (token[0] === '<!--') {
            state.commentLine = lineIndex + 1;
        } else {
            state.rawTag = { name: token[1].toLowerCase(), line: lineIndex + 1 };
        }
    }
    return result;
}

function trimBlankLines(lines) {
    let first = 0;
    let last = lines.length;
    while (first < last && lines[first].trim() === '') first++;
    while (last > first && lines[last - 1].trim() === '') last--;
    return lines.slice(first, last).join('\n');
}

export function parseBlocks(markdown) {
    const blocks = {
        backend: [],
        frontend: [],
    };
    const diagnostics = [];

    let active = null;
    let fence = null;
    const state = newMarkdownState();

    function report(line, message) {
        diagnostics.push(`README.md:${line}: ${message}`);
    }

    const lines = markdown.split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const lineNumber = index + 1;

        // A marker-looking line inside a comment or code span is literal text.
        if (state.commentLine !== null || state.rawTag || state.inlineTicks !== null) {
            if (active) active.lines.push(line);
            scanLine(line, index, lines, state);
            continue;
        }

        // Inside a fenced code block, markers are literal text.
        if (fence) {
            if (active) active.lines.push(line);

            const closing = line.match(/^ {0,3}(`+|~+)\s*$/);
            if (
                closing &&
                closing[1][0] === fence.character &&
                closing[1].length >= fence.length
            ) {
                fence = null;
            }

            continue;
        }

        const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if (
            openingFence &&
            !(
                openingFence[1][0] === '`' &&
                openingFence[2].includes('`')
            )
        ) {
            fence = {
                character: openingFence[1][0],
                length: openingFence[1].length,
                line: lineNumber,
            };

            if (active) active.lines.push(line);
            continue;
        }

        // Indented code, blockquotes, and list examples are not markers.
        if (
            /^(?: {4}|\t)/.test(line) ||
            /^\s*>/.test(line) ||
            /^\s*(?:[-+*]|\d+[.)])\s+/.test(line)
        ) {
            if (active) active.lines.push(line);
            continue;
        }

        const marker = line.trimEnd().match(validMarker);

        if (marker) {
            const [, destination, operation] = marker;

            if (operation === 'start') {
                if (active) {
                    report(
                        lineNumber,
                        `Cannot open ${destination}: ${active.destination} ` +
                        `was opened on line ${active.line} and is still active.`,
                    );
                } else {
                    active = {
                        destination,
                        line: lineNumber,
                        lines: [],
                    };
                }
            } else if (!active) {
                report(lineNumber, `Unexpected ${destination} end marker.`);
            } else if (active.destination !== destination) {
                report(
                    lineNumber,
                    `End marker is ${destination}, but the active block is ` +
                    `${active.destination} from line ${active.line}.`,
                );
            } else {
                const content = trimBlankLines(active.lines);

                if (!content) {
                    report(active.line, 'Routing block is empty.');
                } else {
                    const destinations = destination === 'both'
                        ? ['backend', 'frontend']
                        : [destination];

                    for (const target of destinations) {
                        blocks[target].push(content);
                    }
                }

                active = null;
            }

            continue;
        }

        if (looksLikeMarker(line)) {
            report(
                lineNumber,
                'WARNING: malformed Docker Hub marker. Expected an unindented ' +
                '"<!-- dockerhub:both|backend|frontend:start|end -->" ' +
                'comment with one destination and one operation.',
            );
            continue;
        }

        scanLine(line, index, lines, state);

        if (active) active.lines.push(line);
    }

    if (active) {
        report(active.line, `Unclosed ${active.destination} routing block.`);
    }
    if (fence) {
        report(fence.line, 'Unclosed fenced code block.');
    }
    if (state.commentLine !== null) {
        report(state.commentLine, 'Unclosed HTML comment.');
    }
    if (state.rawTag) {
        report(state.rawTag.line, `Unclosed HTML ${state.rawTag.name} code region.`);
    }

    for (const destination of ['backend', 'frontend']) {
        if (!blocks[destination].length) {
            report(1, `No content selected for ${destination}.`);
        }
    }

    if (diagnostics.length) {
        throw new Error(diagnostics.join('\n'));
    }

    return blocks;
}

// Use the same protected-region scanner for parsing and link conversion.
export function absoluteLinks(markdown) {
    const state = newMarkdownState();
    const lines = markdown.split('\n');
    let fence = null;

    return lines.map((line, index) => {
        if (state.commentLine !== null || state.rawTag || state.inlineTicks !== null) {
            return scanLine(line, index, lines, state, rewriteAnchors);
        }
        if (fence) {
            const closing = line.match(/^ {0,3}(`+|~+)\s*$/);
            if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
                fence = null;
            }
            return line;
        }
        const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
            fence = { character: opening[1][0], length: opening[1].length };
            return line;
        }
        if (/^(?: {4}|\t)/.test(line)) return line;
        return scanLine(line, index, lines, state, rewriteAnchors);
    }).join('\n');
}

function rewriteAnchors(text) {
    return text.replace(/\]\((#[^\s)]+)\)/g, `](${readmeUrl}$1)`);
}

export function renderPage(destination, selectedBlocks, version) {
    const title = destination === 'backend' ? 'Backend' : 'Frontend';

    const page = [
        `<!-- AUTO-GENERATED using .github/scripts/dockerhub-docs.mjs from README.md for release ${version}. Do not edit directly. -->`,
        '',
        `# caddy/ui — ${title}`,
        '',
        absoluteLinks(selectedBlocks.join('\n\n')),
        '',
        '## Full Documentation',
        '',
        `See the [GitHub README](${readmeUrl}#readme) for complete setup, ` +
        'features, configuration, and API documentation.',
        '',
    ].join('\n');

    const bytes = Buffer.byteLength(page, 'utf8');

    if (bytes > maxBytes) {
        throw new Error(
            `${destination} description is ${bytes} bytes; maximum is ${maxBytes}.`,
        );
    }

    return { page, bytes };
}

async function main() {
    const argumentsList = process.argv.slice(2);
    if (
        argumentsList.length > 1 ||
        (argumentsList.length === 1 && argumentsList[0] !== '--dry-run')
    ) {
        throw new Error(
            'Usage: node scripts/dockerhub-docs.mjs [--dry-run]',
        );
    }

    if (
        outputPaths.backend === outputPaths.frontend ||
        Object.values(outputPaths).includes(sourcePath)
    ) {
        throw new Error('Output paths must be distinct and must not overwrite README.md.');
    }

    const markdown = await readFile(sourcePath, 'utf8');
    const blocks = parseBlocks(markdown);

    const manifest = JSON.parse(
        await readFile(
            path.join(repoRoot, '.release-please-manifest.json'),
            'utf8',
        ),
    );
    const version = manifest['.'];

    if (
        typeof version !== 'string' ||
        !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
    ) {
        throw new Error('Missing or invalid root release version in manifest.');
    }

    // Validate BOTH complete pages before writing either output.
    const pages = {};
    for (const destination of ['backend', 'frontend']) {
        pages[destination] = renderPage(destination, blocks[destination], version);
    }

    const dryRun = argumentsList.includes('--dry-run');

    for (const destination of ['backend', 'frontend']) {
        const outputPath = outputPaths[destination];
        const { page, bytes } = pages[destination];

        if (!dryRun) {
            await mkdir(path.dirname(outputPath), { recursive: true });
            await writeFile(outputPath, page, 'utf8');
        }

        console.log(
            `${dryRun ? 'Validated' : 'Wrote'} ` +
            `${path.relative(repoRoot, outputPath)}: ${bytes}/${maxBytes} bytes`,
        );
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
