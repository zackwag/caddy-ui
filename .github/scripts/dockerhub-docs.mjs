import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function parseBlocks(markdown) {
    const blocks = {
        backend: [],
        frontend: [],
    };
    const diagnostics = [];

    let active = null;
    let fence = null;
    let commentLine = null;

    function report(line, message) {
        diagnostics.push(`README.md:${line}: ${message}`);
    }

    const lines = markdown.split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const lineNumber = index + 1;

        // Ordinary multiline HTML comments, including the README guide.
        if (commentLine !== null) {
            if (active) active.lines.push(line);
            if (line.includes('-->')) commentLine = null;
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
                const content = active.lines.join('\n').trim();

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

        // Other HTML comments are ordinary Markdown content.
        const commentStart = line.indexOf('<!--');
        if (
            commentStart !== -1 &&
            line.indexOf('-->', commentStart + 4) === -1
        ) {
            commentLine = lineNumber;
        }

        if (active) active.lines.push(line);
    }

    if (active) {
        report(active.line, `Unclosed ${active.destination} routing block.`);
    }
    if (fence) {
        report(fence.line, 'Unclosed fenced code block.');
    }
    if (commentLine !== null) {
        report(commentLine, 'Unclosed HTML comment.');
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

// Convert README anchor links while preserving fenced and inline code.
function absoluteLinks(markdown) {
    let fence = null;

    return markdown.split('\n').map(line => {
        const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);

        if (fence) {
            if (
                marker &&
                marker[1][0] === fence.character &&
                marker[1].length >= fence.length &&
                marker[2].trim() === ''
            ) {
                fence = null;
            }
            return line;
        }

        if (marker) {
            fence = {
                character: marker[1][0],
                length: marker[1].length,
            };
            return line;
        }

        if (/^(?: {4}|\t)/.test(line)) return line;

        // Code spans on this line stay untouched.
        return line.replace(
            /(`+)(.*?)\1|\]\((#[^\s)]+)\)/g,
            (match, ticks, code, anchor) =>
                ticks ? match : `](${readmeUrl}${anchor})`,
        );
    }).join('\n');
}

function renderPage(destination, selectedBlocks, version) {
    const companion = destination === 'backend' ? 'frontend' : 'backend';
    const title = destination === 'backend' ? 'Backend' : 'Frontend';

    const page = [
        `<!-- AUTO-GENERATED from README.md for release ${version}. Do not edit directly. -->`,
        '',
        `# caddy/ui — ${title}`,
        '',
        `This is the **${destination}** image. Use it alongside the ` +
        `[${companion} image](https://hub.docker.com/r/zackwag/caddy-ui-${companion}).`,
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

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});