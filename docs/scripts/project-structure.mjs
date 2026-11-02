import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function repositoryFiles(root) {
    // Include new, non-ignored files, but exclude deleted tracked files.
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root, encoding: 'utf8',
    }).split('\0').filter(path => path && existsSync(join(root, path)));
}

export function renderTree(paths, notes = {}) {
    if (!notes || typeof notes !== 'object' || Array.isArray(notes)
        || Object.values(notes).some(note => typeof note !== 'string')) {
        throw new Error('Project structure notes must map repository paths to strings.');
    }
    const root = new Map();
    for (const path of new Set(paths)) {
        let children = root;
        for (const part of path.split('/')) {
            if (!children.has(part)) children.set(part, new Map());
            children = children.get(part);
        }
    }
    const lines = ['caddy-ui/'];
    function walk(children, prefix = '', parent = '') {
        const entries = [...children].sort(([a, ac], [b, bc]) => {
            if (Boolean(ac.size) !== Boolean(bc.size)) return ac.size ? -1 : 1;
            return a < b ? -1 : a > b ? 1 : 0;
        });
        entries.forEach(([name, descendants], index) => {
            const last = index === entries.length - 1;
            const directory = descendants.size > 0;
            const path = `${parent}${name}${directory ? '/' : ''}`;
            const note = notes[path];
            const label = path.slice(parent.length).replace(/[\r\n]/g, ' ');
            lines.push(`${prefix}${last ? '└── ' : '├── '}${label}${note ? `  ← ${note.replace(/[\r\n]/g, ' ')}` : ''}`);
            if (directory) walk(descendants, `${prefix}${last ? '    ' : '│   '}`, path);
        });
    }
    walk(root);
    const content = lines.join('\n');
    const fence = '`'.repeat(Math.max(3, ...[...content.matchAll(/`+/g)].map(match => match[0].length + 1)));
    return `${fence}text\n${content}\n${fence}`;
}

export function preprocess(context, book) {
    const root = resolve(context.root, '..');
    const notes = JSON.parse(readFileSync(join(context.root, 'project-structure-notes.json'), 'utf8'));
    const tree = renderTree(repositoryFiles(root), notes);
    function walk(sections) {
        for (const section of sections) {
            const chapter = section.Chapter;
            if (!chapter) continue;
            if (chapter.content.includes('{{#project-structure}}')) {
                chapter.content = chapter.content.replaceAll('{{#project-structure}}', tree);
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
        process.stderr.write(`Project structure: ${error.message}\n`);
        process.exitCode = 1;
    }
}
