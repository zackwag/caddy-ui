import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCaddyfileHistory } from "../hooks/useCaddyfileHistory.js";
import { apiFetch, apiRequest, instanceUrl } from "../utils/api.js";
import { formatTs } from "../utils/format.js";
import CaddyfileDiff from "./CaddyfileDiff.jsx";
import CaddyfileEditor from "./CaddyfileEditor.jsx";
import CaddyfileHistory from "./CaddyfileHistory.jsx";
import { UtilityIcon } from "./Icons.jsx";
import Modal from "./Modal.jsx";
import PaneDivider, { DEFAULT_PRIMARY_SHARE } from "./PaneDivider.jsx";

// eslint-disable-next-line i18next/no-literal-string -- Caddy CLI command, not translatable UI copy
const CADDY_FMT_LABEL = "caddy fmt";
// eslint-disable-next-line i18next/no-literal-string -- Stable DOM identifier linking the divider to the editor pane
const EDITOR_PANE_ID = "caddyfile-editor-pane";
// eslint-disable-next-line i18next/no-literal-string -- HTTP header name, not translatable UI copy
const ETAG_HEADER = "ETag";

export default function CaddyFile({ toast, theme, confirm, editorVim, onEditorVimChange }) {
    const { t } = useTranslation();
    const [content, setContent] = useState("");
    const [original, setOriginal] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [validating, setValidating] = useState(false);
    const [runFmt, setRunFmt] = useState(true);
    const [runSort, setRunSort] = useState(true);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [editorShare, setEditorShare] = useState(DEFAULT_PRIMARY_SHARE);
    const history = useCaddyfileHistory(toast);
    const historyView = { mode: useState("diff"), list: useState(false) };
    // A save refused because the file changed since it was loaded: the
    // current file and its ETag, and whether it was a force save
    const [conflict, setConflict] = useState(null);
    const [conflictCompare, setConflictCompare] = useState(false);
    // The ETag of the file the editor was loaded from, sent back as If-Match
    const savedETag = useRef(null);
    const importInputRef = useRef(null);
    const pageRef = useRef(null);
    const toolbarRef = useRef(null);
    const historyHeaderRef = useRef(null);
    const historyControlsRef = useRef(null);

    const readCaddyfile = async (signal) => {
        const { body, headers } = await apiRequest("/caddyfile", { signal });
        return { text: body, etag: headers.get(ETAG_HEADER) };
    };

    const showSaved = ({ text, etag }) => {
        savedETag.current = etag;
        setContent(text); setOriginal(text);
    };

    useEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;
        toast.track('caddyfile.load', readCaddyfile(signal), { signal })
            .then(showSaved)
            .catch(() => { })
            .finally(() => setLoading(false));
        return () => controller.abort();
        // Reloading would discard unsaved edits
    }, [toast]);

    const toggleHistory = () => {
        if (!historyOpen) {
            history.load();
        }
        setHistoryOpen(o => !o);
    };

    // Replaces the file and reloads the editor, and the open history, from it.
    // The save's own outcome is reported first, so a failed refresh only adds
    // its error and keeps the current editor contents.
    const putCaddyfile = async (path, text, { ifMatch, message }) => {
        const headers = { "Content-Type": "text/plain", ...(ifMatch ? { "If-Match": ifMatch } : {}) };
        const result = await apiFetch(path, { method: "PUT", headers, body: text });
        toast.saved(result, message);
        if (historyOpen) {
            history.load(true);
        }
        try { showSaved(await readCaddyfile()); }
        catch (e) { toast.error(e); }
    };

    const restoreSnapshot = async (entry) => {
        const message = t("caddyfile.restoreConfirm", { timestamp: formatTs(entry.timestamp) });
        if (!await confirm(entry.kind === 'external' ? `${message} ${t('caddyfile.externalRestoreHint')}` : message, { confirmLabel: t("caddyfile.restore") })) {
            return;
        }
        try {
            const text = await history.fetchSnapshot(entry.filename);
            await putCaddyfile("/caddyfile?action=restore&fmt=false&sort=false", text, { message: t("caddyfile.restoredFrom", { timestamp: formatTs(entry.timestamp) }) });
            setHistoryOpen(false); history.clear();
        } catch (e) { toast.error(e); }
    };

    const deleteSnapshot = async (entry) => {
        if (!await confirm(t("caddyfile.deleteSnapshotConfirm", { timestamp: formatTs(entry.timestamp) }), { confirmLabel: t("common.delete"), danger: true })) {
            return;
        }
        try {
            await history.remove(entry);
            toast.success(t("caddyfile.snapshotDeleted"));
        } catch (e) { toast.error(e); }
    };

    const validate = async () => {
        setValidating(true);
        try {
            const result = await apiFetch(`/caddyfile/validations?fmt=${runFmt}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: content });
            if (result.formatted) {
                setContent(result.formatted);
            }
            toast.success(t("caddyfile.valid"));
        } catch (e) { toast.error(e); }
        finally { setValidating(false); }
    };

    // Shows the file that blocked a save, so its changes can be compared with
    // the editor's before choosing which to keep.
    const showConflict = async (force, error) => {
        try {
            setConflict({ file: await readCaddyfile(), force });
        } catch (e) {
            toast.error(error);
            toast.error(e);
        }
    };

    const closeConflict = () => { setConflict(null); setConflictCompare(false); };

    // Saves only over the file `basis` names, when given: a file changed since
    // is refused with CADDYFILE_CHANGED rather than overwritten.
    const saveContent = async ({ force, basis }) => {
        setSaving(true);
        try {
            const path = `/caddyfile?fmt=${runFmt}&sort=${runSort}${force ? "&validate=false" : ""}`; // eslint-disable-line i18next/no-literal-string -- API query parameter
            await putCaddyfile(path, content, { ifMatch: basis, message: t("caddyfile.savedReloaded") });
            closeConflict();
        } catch (e) {
            if (e.code === "CADDYFILE_CHANGED") {
                await showConflict(force, e);
            } else {
                toast.error(e);
            }
        }
        finally { setSaving(false); }
    };

    const save = async ({ force = false } = {}) => {
        if (force && !await confirm(t("caddyfile.forceSaveConfirm"), { confirmLabel: t("caddyfile.forceSave"), danger: true })) {
            return;
        }
        await saveContent({ force, basis: savedETag.current });
    };

    // Discards the editor's changes for the file that blocked the save.
    const loadConflictingFile = () => {
        showSaved(conflict.file);
        closeConflict();
    };

    // Saves the editor's text over the file the user just reviewed; one changed
    // again since then is refused again.
    const overwriteConflictingFile = () => saveContent({ force: conflict.force, basis: conflict.file.etag });

    const reload = async () => {
        try {
            const result = await apiFetch("/caddyfile/reloads", { method: "POST" });
            toast.saved(result, t("caddyfile.reloadedFromDisk"));
        }
        catch (e) { toast.error(e); }
    };

    const importFile = (e) => {
        const file = e.target.files?.[0];
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const text = ev.target.result;
            if (!await confirm(t("caddyfile.importConfirm"), { confirmLabel: t("caddyfile.import") })) {
                return;
            }
            try {
                await putCaddyfile("/caddyfile?action=import", text, { message: t("caddyfile.importedReloaded") });
            } catch (err) { toast.error(err); }
        };
        reader.readAsText(file);
        e.target.value = "";
    };

    const isDirty = content !== original;

    if (loading) {
        return <div className="loading">{t("caddyfile.loading")}</div>;
    }

    return (
        <div
            ref={pageRef}
            className={`gap-16 caddyfile-page${historyOpen ? " caddyfile-page--history" : ""}`}
            style={{ "--editor-share": `${editorShare}fr`, "--history-share": `${100 - editorShare}fr` }}
        >
            <div id={EDITOR_PANE_ID} className="editor-wrap">
                <CaddyfileEditor className="caddyfile-editor" padding="16px" value={content} onChange={setContent} onSave={() => { if (!saving && isDirty) { save(); } }} theme={theme} vimMode={editorVim} />
                <div ref={toolbarRef} className="editor-toolbar">
                    <div className="btn-row">
                        <label className="editor-checkbox-label">
                            <input type="checkbox" className="editor-checkbox" checked={runFmt} onChange={e => setRunFmt(e.target.checked)} />
                            {CADDY_FMT_LABEL}
                        </label>
                        <label className="editor-checkbox-label">
                            <input type="checkbox" className="editor-checkbox" checked={runSort} onChange={e => setRunSort(e.target.checked)} />
                            {t("caddyfile.sortEntries")}
                        </label>
                        <label className="editor-checkbox-label">
                            <input type="checkbox" className="editor-checkbox" checked={editorVim} onChange={e => onEditorVimChange(e.target.checked)} />
                            {t("caddyfile.vimMode")}
                        </label>
                        <span className="editor-hint editor-hint--mobile"><UtilityIcon name={isDirty ? "dot" : "check"} size={10} /> {t(isDirty ? "caddyfile.unsavedChanges" : "caddyfile.upToDate")}</span>
                    </div>
                    <div className="btn-row editor-toolbar-actions">
                        <span className="editor-hint editor-hint--desktop"><UtilityIcon name={isDirty ? "dot" : "check"} size={10} /> {t(isDirty ? "caddyfile.unsavedChanges" : "caddyfile.upToDate")}</span>
                        <button className="btn btn-ghost" onClick={validate} disabled={validating}>{validating ? t("caddyfile.validating") : <><UtilityIcon name="check" /> {t("caddyfile.validate")}</>}</button>
                        <button className="btn btn-ghost" onClick={toggleHistory}><UtilityIcon name="history" /> {t("caddyfile.history")}{history.entries.length > 0 && !history.loading ? ` (${history.entries.length})` : ""}</button>
                        <button className="btn btn-ghost" onClick={() => window.open(instanceUrl('/caddyfile?download=true'), '_blank')}><UtilityIcon name="arrowDown" /> {t("common.export")}</button>
                        <button className="btn btn-ghost" onClick={() => importInputRef.current?.click()}><UtilityIcon name="arrowUp" /> {t("caddyfile.import")}</button>
                        <input ref={importInputRef} type="file" accept="text/plain,.txt" style={{ display: "none" }} onChange={importFile} />
                        <button className="btn btn-ghost" onClick={reload}><UtilityIcon name="refresh" /> {t("caddyfile.reload")}</button>
                        <button className="btn btn-ghost" onClick={() => save({ force: true })} disabled={saving || !isDirty} title={t("caddyfile.forceSaveTitle")}>{saving ? "..." : <><UtilityIcon name="warning" /> {t("caddyfile.forceSave")}</>}</button>
                        <button className="btn btn-primary" onClick={() => save()} disabled={saving || !isDirty}>{saving ? t("common.saving") : <><UtilityIcon name="arrowUp" /> {t("common.save")}</>}</button>
                    </div>
                </div>
            </div>

            {historyOpen && (
                <PaneDivider
                    containerRef={pageRef}
                    primaryMinimumRef={toolbarRef}
                    secondaryMinimumRef={historyHeaderRef}
                    secondaryControlsRef={historyControlsRef}
                    primaryPaneId={EDITOR_PANE_ID}
                    value={editorShare}
                    onChange={setEditorShare}
                />
            )}
            {historyOpen && (
                <CaddyfileHistory
                    history={history}
                    saved={original}
                    isDirty={isDirty}
                    view={historyView}
                    onRestore={restoreSnapshot}
                    onDelete={deleteSnapshot}
                    headerRef={historyHeaderRef}
                    controlsRef={historyControlsRef}
                />
            )}

            {conflict && (
                <Modal title={t("caddyfile.conflictTitle")} style={{ width: 720 }} onClose={closeConflict}>
                    <div className="modal-hint">{t("errors.caddyfileChanged")} {t("caddyfile.conflictHint")}</div>
                    {conflictCompare && <CaddyfileDiff oldText={conflict.file.text} newText={content} label={t("caddyfile.conflictDiff")} />}
                    <div className="btn-row" style={{ justifyContent: "space-between", marginTop: 16 }}>
                        <button className="btn btn-ghost" onClick={() => setConflictCompare(open => !open)} aria-expanded={conflictCompare}>
                            {t(conflictCompare ? "caddyfile.conflictHideCompare" : "caddyfile.conflictCompare")}
                        </button>
                        <div className="btn-row">
                            <button className="btn btn-ghost" onClick={closeConflict}>{t("caddyfile.conflictKeepEditing")}</button>
                            <button className="btn btn-ghost" onClick={loadConflictingFile} disabled={saving}>{t("caddyfile.conflictLoadCurrent")}</button>
                            <button className="btn btn-danger" onClick={overwriteConflictingFile} disabled={saving}>{saving ? t("common.saving") : t("caddyfile.conflictOverwrite")}</button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
}
