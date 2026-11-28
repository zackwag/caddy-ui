import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replaceMarker, runPreprocessor } from './mdbook-preprocessor.mjs';

export function renderReleaseTable(changelog) {
    const rows = [];
    for (const section of changelog.replaceAll('\r\n', '\n').split(/^## /m).slice(1)) {
        const [heading, ...lines] = section.split('\n');
        const release = /^\[(\d+\.\d+\.\d+(?:-[\w.-]+)?)\]\((\S+)\) \((\d{4}-\d{2}-\d{2})\)$/.exec(heading);
        // Unreleased headings are not published versions.
        if (!release) {
            continue;
        }
        const [, version, url, date] = release;
        const description = lines.map(line => line.trim()).filter(Boolean).map(line => line
            .replace(/^### (.+)$/, '**$1**')
            .replace(/^[*-] /, '• ')
            .replace(/\\?\|/g, '\\|')).join('<br>');
        rows.push(`| [v${version}](${url}) | ${date} | ${description} |`);
    }
    if (!rows.length) {
        throw new Error('No release-please entries found in CHANGELOG.md');
    }
    return ['| Version | Date | Changes |', '|---------|------|---------|', ...rows].join('\n');
}

export function preprocess(context, book) {
    return replaceMarker(book, 'release-table', () => renderReleaseTable(readFileSync(resolve(context.root, '../CHANGELOG.md'), 'utf8')));
}

runPreprocessor(import.meta.url, 'Release table', preprocess);
