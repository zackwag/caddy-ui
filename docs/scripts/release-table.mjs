import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function renderReleaseTable(changelog) {
    const rows = [];
    for (const section of changelog.replaceAll('\r\n', '\n').split(/^## /m).slice(1)) {
        const [heading, ...lines] = section.split('\n');
        const release = /^\[(\d+\.\d+\.\d+(?:-[\w.-]+)?)\]\((\S+)\) \((\d{4}-\d{2}-\d{2})\)$/.exec(heading);
        // Unreleased headings are not published versions.
        if (!release) continue;
        const [, version, url, date] = release;
        const description = lines.map(line => line.trim()).filter(Boolean).map(line => line
            .replace(/^### (.+)$/, '**$1**')
            .replace(/^[*-] /, '• ')
            .replace(/\\?\|/g, '\\|')).join('<br>');
        rows.push(`| [v${version}](${url}) | ${date} | ${description} |`);
    }
    if (!rows.length) throw new Error('No release-please entries found in CHANGELOG.md');
    return ['| Version | Date | Changes |', '|---------|------|---------|', ...rows].join('\n');
}

export function preprocess(context, book) {
    let table;
    function walk(sections) {
        for (const section of sections) {
            const chapter = section.Chapter;
            if (!chapter) continue;
            if (chapter.content.includes('{{#release-table}}')) {
                table ??= renderReleaseTable(readFileSync(resolve(context.root, '../CHANGELOG.md'), 'utf8'));
                chapter.content = chapter.content.replaceAll('{{#release-table}}', () => table);
            }
            walk(chapter.sub_items || []);
        }
    }
    walk(book.items || book.sections);
    return book;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv[2] === 'supports') {
        process.exit(process.argv[3] === 'html' ? 0 : 1);
    }
    try {
        const [context, book] = JSON.parse(readFileSync(0, 'utf8'));
        process.stdout.write(JSON.stringify(preprocess(context, book)));
    } catch (error) {
        process.stderr.write(`Release table: ${error.message}\n`);
        process.exitCode = 1;
    }
}
