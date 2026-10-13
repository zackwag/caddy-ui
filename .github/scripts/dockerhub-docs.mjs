import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readHtmlRegion } from '../../docs/scripts/html-region.mjs';

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

function newMarkdownState(lines) {
    let offset = 0;
    const lineOffsets = lines.map(line => {
        const start = offset;
        offset += line.length + 1;
        return start;
    });
    return { htmlRegion: null, inlineTicks: null, source: lines.join('\n'), lineOffsets };
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
// HTML boundaries come from parse5; Markdown code spans keep their own rules.
function scanLine(line, lineIndex, lines, state, transform = text => text) {
    let result = '';
    let position = 0;

    while (position < line.length) {
        if (state.htmlRegion) {
            const end = Math.min(line.length, state.htmlRegion.endOffset - state.lineOffsets[lineIndex]);
            result += line.slice(position, end);
            position = end;
            if (!state.htmlRegion.unclosed &&
                state.htmlRegion.endOffset <= state.lineOffsets[lineIndex] + position) {
                state.htmlRegion = null;
            }
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

        const tokens = /`+|</g;
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
        } else {
            const offset = state.lineOffsets[lineIndex] + token.index;
            const region = readHtmlRegion(state.source.slice(offset));
            if (region) {
                state.htmlRegion = { ...region, endOffset: offset + region.endOffset, line: lineIndex + 1 };
            }
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

    function report(line, message) {
        diagnostics.push(`README.md:${line}: ${message}`);
    }

    const lines = markdown.split(/\r?\n/);
    const state = newMarkdownState(lines);

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const lineNumber = index + 1;

        // A marker-looking line inside a comment or code span is literal text.
        if (state.htmlRegion || state.inlineTicks !== null) {
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
    if (state.htmlRegion?.unclosed) {
        const message = state.htmlRegion.kind === 'comment'
            ? 'Unclosed HTML comment.'
            : `Unclosed HTML ${state.htmlRegion.name} code region.`;
        report(state.htmlRegion.line, message);
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
    const lines = markdown.split('\n');
    const state = newMarkdownState(lines);
    let fence = null;

    return lines.map((line, index) => {
        if (state.htmlRegion || state.inlineTicks !== null) {
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
