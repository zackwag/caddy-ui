import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Replaces `{{#marker}}` in every chapter with `render()`, rendered once and
// only when a chapter uses it.
export function replaceMarker(book, marker, render) {
    const tag = `{{#${marker}}}`;
    let rendered;
    function walk(sections) {
        for (const section of sections) {
            const chapter = section.Chapter;
            if (!chapter) continue;
            if (chapter.content.includes(tag)) {
                rendered ??= render();
                chapter.content = chapter.content.replaceAll(tag, () => rendered);
            }
            walk(chapter.sub_items || []);
        }
    }
    // mdBook 0.5 names the top-level list `items`; 0.4 named it `sections`
    walk(book.items || book.sections);
    return book;
}

// The mdBook preprocessor protocol, when `moduleUrl` is the script mdBook ran.
export function runPreprocessor(moduleUrl, name, preprocess) {
    if (!process.argv[1] || resolve(process.argv[1]) !== fileURLToPath(moduleUrl)) return;
    if (process.argv[2] === 'supports') {
        process.exit(process.argv[3] === 'html' ? 0 : 1);
    }
    try {
        const [context, book] = JSON.parse(readFileSync(0, 'utf8'));
        process.stdout.write(JSON.stringify(preprocess(context, book)));
    } catch (error) {
        process.stderr.write(`${name}: ${error.message}\n`);
        process.exitCode = 1;
    }
}
