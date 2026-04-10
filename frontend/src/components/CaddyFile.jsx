import { useEffect, useRef, useState } from "react";
import { apiFetch, getToken } from "../utils/api.js";
import { formatTs } from "../utils/format.js";

function CaddyfileCodeMirror({ value, onChange, theme }) {
    const containerRef = useRef(null);
    const viewRef = useRef(null);
    const onChangeRef = useRef(onChange);

    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

    useEffect(() => {
        if (!containerRef.current) return;
        let view;

        async function init() {
            const { EditorView, keymap, lineNumbers, highlightActiveLineGutter, drawSelection, highlightSpecialChars } = await import("@codemirror/view");
            const { EditorState } = await import("@codemirror/state");
            const { defaultKeymap, historyKeymap, history } = await import("@codemirror/commands");
            const { StreamLanguage, syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } = await import("@codemirror/language");
            const { nginx } = await import("@codemirror/legacy-modes/mode/nginx");

            const isDark = theme === 'dark';

            const editorTheme = EditorView.theme({
                "&": { background: isDark ? "#0a0c0f" : "#f0ebe4", color: isDark ? "#c9d1e0" : "#2c2825", fontSize: "13px", fontFamily: "'IBM Plex Mono', monospace" },
                ".cm-content": { padding: "16px", caretColor: "var(--accent)", lineHeight: "1.7" },
                ".cm-gutters": { background: isDark ? "#0d0f12" : "#e8e2db", color: isDark ? "#586275" : "#8a7f75", border: "none", borderRight: `1px solid ${isDark ? "#1e2329" : "#d0c8c0"}`, paddingRight: "8px" },
                ".cm-activeLineGutter": { background: isDark ? "rgba(0,229,160,0.05)" : "rgba(0,149,107,0.05)" },
                ".cm-activeLine": { background: isDark ? "rgba(0,229,160,0.03)" : "rgba(0,149,107,0.03)" },
                ".cm-cursor": { borderLeftColor: "var(--accent)" },
                ".cm-selectionBackground, ::selection": { background: isDark ? "rgba(0,153,255,0.2) !important" : "rgba(0,119,204,0.15) !important" },
                ".cm-line": { padding: "0 4px" },
                ".tok-keyword": { color: isDark ? "#00e5a0" : "#00956b" },
                ".tok-string": { color: isDark ? "#ffb830" : "#b36000" },
                ".tok-comment": { color: isDark ? "#586275" : "#8a7f75", fontStyle: "italic" },
                ".tok-number": { color: isDark ? "#0099ff" : "#0077cc" },
                ".tok-operator": { color: isDark ? "#c9d1e0" : "#2c2825" },
                ".tok-variableName": { color: isDark ? "#ff4d6a" : "#cc2233" },
                ".tok-typeName": { color: isDark ? "#00e5a0" : "#00956b" },
                ".tok-atom": { color: isDark ? "#ffb830" : "#b36000" },
                ".tok-def": { color: isDark ? "#00e5a0" : "#00956b" },
                ".tok-property": { color: isDark ? "#0099ff" : "#0077cc" },
                "& .cm-scroller": { overflow: "auto" },
            }, { dark: isDark });

            const startState = EditorState.create({
                doc: value,
                extensions: [
                    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
                    history(), drawSelection(), indentOnInput(), bracketMatching(),
                    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
                    StreamLanguage.define(nginx), editorTheme,
                    keymap.of([...defaultKeymap, ...historyKeymap]),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
                    }),
                    EditorView.lineWrapping,
                ],
            });

            view = new EditorView({ state: startState, parent: containerRef.current });
            viewRef.current = view;
        }

        init();
        return () => { view?.destroy(); viewRef.current = null; };
    }, [theme]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }, [value]);

    return <div ref={containerRef} style={{ minHeight: 420, background: theme === 'dark' ? "#0a0c0f" : "#f0ebe4" }} />;
}

export default function CaddyFile({ toast, onUnauth, theme }) {
    const [content, setContent] = useState("");
    const [original, setOriginal] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [validating, setValidating] = useState(false);
    const [runFmt, setRunFmt] = useState(true);
    const [runSort, setRunSort] = useState(true);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [previewEntry, setPreviewEntry] = useState(null);
    const [previewContent, setPreviewContent] = useState("");
    const fileInputRef = useRef(null);
    const historyRef = useRef(null);

    useEffect(() => {
        apiFetch("/caddyfile", {}, onUnauth)
            .then(t => { setContent(t); setOriginal(t); })
            .catch(e => toast.error(e.message))
            .finally(() => setLoading(false));
    }, []);

    const loadHistory = () => {
        setHistoryLoading(true);
        apiFetch("/caddyfile/history", {}, onUnauth).then(setHistory).catch(() => setHistory([])).finally(() => setHistoryLoading(false));
    };

    const toggleHistory = () => {
        if (!historyOpen) {
            loadHistory();
            setTimeout(() => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
        }
        setHistoryOpen(o => !o);
        setPreviewEntry(null);
        setPreviewContent("");
    };

    const previewSnapshot = async (entry) => {
        if (previewEntry?.filename === entry.filename) { setPreviewEntry(null); setPreviewContent(""); return; }
        try {
            const text = await apiFetch(`/caddyfile/history/${entry.filename}`, {}, onUnauth);
            setPreviewEntry(entry); setPreviewContent(text);
        } catch (e) { toast.error(e.message); }
    };

    const restoreSnapshot = async (entry) => {
        if (!confirm(`Restore Caddyfile from ${formatTs(entry.timestamp)}? The current file will be snapshotted first.`)) return;
        try {
            const text = await apiFetch(`/caddyfile/history/${entry.filename}`, {}, onUnauth);
            await apiFetch("/caddyfile/restore", { method: "POST", headers: { "Content-Type": "text/plain" }, body: text }, onUnauth);
            const fresh = await apiFetch("/caddyfile", {}, onUnauth);
            setContent(fresh); setOriginal(fresh); setHistoryOpen(false); setPreviewEntry(null);
            toast.success(`Restored from ${formatTs(entry.timestamp)}`);
            loadHistory();
        } catch (e) { toast.error(e.message); }
    };

    const deleteSnapshot = async (entry) => {
        if (!confirm(`Delete snapshot from ${formatTs(entry.timestamp)}?`)) return;
        try {
            await apiFetch(`/caddyfile/history/${entry.filename}`, { method: "DELETE" }, onUnauth);
            toast.success("Snapshot deleted");
            if (previewEntry?.filename === entry.filename) { setPreviewEntry(null); setPreviewContent(""); }
            loadHistory();
        } catch (e) { toast.error(e.message); }
    };

    const validate = async () => {
        setValidating(true);
        try {
            const result = await apiFetch("/caddyfile/validate", { method: "POST", headers: { "Content-Type": "text/plain" }, body: content }, onUnauth);
            if (result.warnings?.length) result.warnings.forEach(w => toast.info(w));
            else toast.success("Caddyfile is valid");
        } catch (e) { toast.error(e.message); }
        finally { setValidating(false); }
    };

    const save = async () => {
        setSaving(true);
        try {
            await apiFetch(`/caddyfile?fmt=${runFmt}&sort=${runSort}`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: content }, onUnauth);
            const fresh = await apiFetch("/caddyfile", {}, onUnauth);
            setContent(fresh); setOriginal(fresh);
            toast.success("Caddyfile saved and reloaded");
            if (historyOpen) loadHistory();
        } catch (e) { toast.error(e.message); }
        finally { setSaving(false); }
    };

    const reload = async () => {
        try { await apiFetch("/caddyfile/reload", { method: "POST" }, onUnauth); toast.success("Caddy reloaded from disk"); }
        catch (e) { toast.error(e.message); }
    };

    const download = () => {
        const token = getToken();
        window.open(token ? `/api/caddyfile/download?token=${token}` : `/api/caddyfile/download`, '_blank');
    };

    const restore = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const text = ev.target.result;
            if (!confirm("Restore this Caddyfile? This will validate, reload Caddy, and overwrite the current file.")) return;
            try {
                await apiFetch("/caddyfile/restore", { method: "POST", headers: { "Content-Type": "text/plain" }, body: text }, onUnauth);
                const fresh = await apiFetch("/caddyfile", {}, onUnauth);
                setContent(fresh); setOriginal(fresh);
                toast.success("Caddyfile restored and reloaded");
                if (historyOpen) loadHistory();
            } catch (err) { toast.error(err.message); }
        };
        reader.readAsText(file);
        e.target.value = "";
    };

    const isDirty = content !== original;

    if (loading) return <div style={{ color: "var(--muted)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading Caddyfile...</div>;

    return (
        <div className="gap-16">
            <div className="editor-wrap">
                <CaddyfileCodeMirror value={content} onChange={setContent} theme={theme} />
                <div className="editor-toolbar">
                    <div className="btn-row">
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)", cursor: "pointer" }}>
                            <input type="checkbox" checked={runFmt} onChange={e => setRunFmt(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
                            caddy fmt
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)", cursor: "pointer" }}>
                            <input type="checkbox" checked={runSort} onChange={e => setRunSort(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
                            sort entries
                        </label>
                    </div>
                    <div className="btn-row">
                        <span className="editor-hint">{isDirty ? "● unsaved changes" : "✓ up to date"}</span>
                        <button className="btn btn-ghost" onClick={validate} disabled={validating}>{validating ? "Validating..." : "✓ Validate"}</button>
                        <button className="btn btn-ghost" onClick={toggleHistory}>⊙ History{history.length > 0 && !historyLoading ? ` (${history.length})` : ""}</button>
                        <button className="btn btn-ghost" onClick={download}>↓ Backup</button>
                        <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>↑ Restore</button>
                        <input ref={fileInputRef} type="file" accept="text/plain,.txt" style={{ display: "none" }} onChange={restore} />
                        <button className="btn btn-ghost" onClick={reload}>↺ Reload</button>
                        <button className="btn btn-primary" onClick={save} disabled={saving || !isDirty}>{saving ? "Saving..." : "↑ Save"}</button>
                    </div>
                </div>
            </div>

            {historyOpen && (
                <div ref={historyRef} className="card" style={{ padding: 0, overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--muted)" }}>Version History</span>
                        <button className="btn btn-ghost" onClick={loadHistory} disabled={historyLoading} style={{ fontSize: 11 }}>↺ Refresh</button>
                    </div>
                    {historyLoading ? (
                        <div style={{ padding: 16, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--muted)" }}>Loading...</div>
                    ) : history.length === 0 ? (
                        <div style={{ padding: 24, textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--muted)" }}>No snapshots yet — save your Caddyfile to create one</div>
                    ) : (
                        <div style={{ padding: "0 16px" }}>
                            {history.map((entry, i) => (
                                <div key={entry.filename}>
                                    <div className="history-row">
                                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: previewEntry?.filename === entry.filename ? "var(--accent)" : "var(--text)", cursor: "pointer", flex: 1 }} onClick={() => previewSnapshot(entry)}>
                                            {formatTs(entry.timestamp)}
                                            {i === 0 && <span style={{ marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)" }}>latest</span>}
                                        </div>
                                        <div className="btn-row">
                                            <button className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => restoreSnapshot(entry)}>↺ Restore</button>
                                            <button className="btn btn-danger" style={{ padding: "3px 10px", fontSize: 11 }} title="Delete snapshot" onClick={() => deleteSnapshot(entry)}>✕</button>
                                        </div>
                                    </div>
                                    {previewEntry?.filename === entry.filename && <div className="history-preview">{previewContent}</div>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
