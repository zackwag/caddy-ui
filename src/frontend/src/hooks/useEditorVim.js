import { useState } from "react";

/* eslint-disable i18next/no-literal-string -- Storage key and value, not UI copy */
const STORAGE_KEY = "caddy_ui_editor_vim";
const ENABLED = "true";
/* eslint-enable i18next/no-literal-string */

// Vim mode changes how typing works, so it is a per-browser preference rather
// than a shared server setting: enabling it never affects another user.
function readEditorVim() {
    try { return localStorage.getItem(STORAGE_KEY) === ENABLED; }
    catch { return false; }
}

export function useEditorVim() {
    const [editorVim, setEditorVim] = useState(readEditorVim);
    const change = (enabled) => {
        setEditorVim(enabled);
        try {
            if (enabled) localStorage.setItem(STORAGE_KEY, ENABLED);
            else localStorage.removeItem(STORAGE_KEY);
        } catch { /* Storage unavailable: the choice lasts for this page only */ }
    };
    return [editorVim, change];
}
