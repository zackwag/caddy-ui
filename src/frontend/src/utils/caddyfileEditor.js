// The CodeMirror setup shared by the full Caddyfile editor and the route
// site-block editor, so both edit the same way. Components import this module
// dynamically, which keeps CodeMirror out of the main bundle.
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { StreamLanguage, bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import { caddyfile } from '../lib/caddyfileMode.js';
import { indentation, indentationKeymap } from './caddyfileIndentation.js';

// Colors read from the CSS theme variables (see styles.js) rather than being
// hardcoded per theme here, so a new theme needs no changes in this file.
function editorTheme({ dark, padding }) {
    return EditorView.theme({
        '&': { background: 'var(--editor-bg)', color: 'var(--text)', fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" },
        '.cm-content': { padding, caretColor: 'var(--accent)', lineHeight: '1.7' },
        '.cm-gutters': { background: 'var(--editor-gutter)', color: 'var(--muted)', border: 'none', borderRight: '1px solid var(--editor-border)', paddingRight: '8px' },
        '.cm-activeLineGutter': { background: 'var(--editor-active-gutter)' },
        '.cm-activeLine': { background: 'var(--editor-active-line)' },
        '.cm-cursor': { borderLeftColor: 'var(--accent)' },
        '.cm-selectionBackground, ::selection': { background: 'var(--editor-selection) !important' },
        '.cm-line': { padding: '0 4px' },
        '.tok-keyword': { color: 'var(--accent)' },
        '.tok-string': { color: 'var(--warn)' },
        '.tok-comment': { color: 'var(--muted)', fontStyle: 'italic' },
        '.tok-number': { color: 'var(--accent2)' },
        '.tok-operator': { color: 'var(--text)' },
        '.tok-variableName': { color: 'var(--danger)' },
        '.tok-typeName': { color: 'var(--accent)' },
        '.tok-atom': { color: 'var(--warn)' },
        '.tok-propertyName': { color: 'var(--accent2)' },
        '.tok-variableName2': { color: 'var(--accent3)' },
        '& .cm-scroller': { overflow: 'auto' },
    }, { dark });
}

// Creates an editor for `doc` in `parent`. `onChange` receives the full text
// after each edit. Nothing here rewrites the document on load: content only
// changes through the user's own edits.
export function createCaddyfileEditor({ parent, doc, dark, padding, onChange }) {
    const state = EditorState.create({
        doc,
        extensions: [
            lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
            history(), drawSelection(), indentOnInput(), bracketMatching(),
            syntaxHighlighting(classHighlighter),
            StreamLanguage.define(caddyfile), editorTheme({ dark, padding }),
            indentation,
            keymap.of([...indentationKeymap, ...defaultKeymap, ...historyKeymap]),
            EditorView.updateListener.of(update => {
                if (update.docChanged) {
                    onChange(update.state.doc.toString());
                }
            }),
            EditorView.lineWrapping,
        ],
    });
    return new EditorView({ state, parent });
}
