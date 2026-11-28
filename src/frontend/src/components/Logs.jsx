import { UtilityIcon } from "./Icons.jsx";
import { localizeError } from "../utils/errorMessages.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import ConfigCard from "./ConfigCard.jsx";
import SearchInput from "./SearchInput.jsx";
import Select from "./Select.jsx";
import { apiFetch, instanceUrl } from "../utils/api.js";
import { downloadText } from "../utils/download.js";
import { LEVEL_CLASSES, lineLevel, readLogResponse, resolveLogSource, SOURCES } from "../utils/logSource.js";

export default function Logs({ toast, noInstances }) {
    const { t } = useTranslation();
    const location = useLocation();
    const [lines, setLines] = useState([]);
    const [loadError, setLoadError] = useState(null);
    // Manual tab selection lasts only for this navigation. A new link to /logs
    // must apply its destination even when the component is already mounted.
    const [selection, setSelection] = useState(null);
    const source = noInstances ? "app" : selection?.key === location.key
        ? selection.source : resolveLogSource(location.search);
    const setSource = source => setSelection({ key: location.key, source });
    const [live, setLive] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [logConfig, setLogConfig] = useState(null);
    const [configError, setConfigError] = useState(null);
    const [configDirty, setConfigDirty] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);
    // eslint-disable-next-line i18next/no-literal-string -- URL query parameter, not translatable UI text
    const [logSearch, setLogSearch] = useState(() => new URLSearchParams(location.search).get("search") || "");
    // eslint-disable-next-line i18next/no-literal-string -- URL query parameter, not translatable UI text
    useEffect(() => { setLogSearch(new URLSearchParams(location.search).get("search") || ""); }, [location.search]);
    const [levelFilter, setLevelFilter] = useState("all");
    const [refreshing, setRefreshing] = useState(false);
    const bottomRef = useRef(null);
    const esRef = useRef(null);
    // The latest load's, aborted by the next load, so a response for another
    // source or an older load is ignored
    const loadRef = useRef(null);

    const loadLines = useCallback(async () => {
        loadRef.current?.abort();
        loadRef.current = new AbortController();
        const { signal } = loadRef.current;
        setRefreshing(true);
        try {
            const lines = await toast.track('logs.load.' + source, apiFetch(SOURCES[source].path, { signal }).then(data => readLogResponse(data, source)), { signal });
            setLoadError(null);
            setLines(lines);
        } catch (error) {
            setLoadError(error);
        } finally {
            setRefreshing(false);
        }
    }, [source, toast]);

    useEffect(() => {
        setLines([]);
        setLoadError(null);
        loadLines();
        return () => {
            loadRef.current?.abort();
            esRef.current?.close();
            esRef.current = null;
            setLive(false);
        };
    }, [loadLines]);

    const needsConfig = source === "caddy" && !logConfig;
    useEffect(() => {
        if (!needsConfig) {
            return;
        }
        const controller = new AbortController();
        const { signal } = controller;
        setConfigError(null);
        toast.track('logs.config', apiFetch("/logs/config", { signal }), { signal })
            .then(setLogConfig, setConfigError);
        return () => controller.abort();
    }, [needsConfig, toast]);

    useEffect(() => {
        if (!logSearch && levelFilter === "all") {
            if (bottomRef.current) {
                bottomRef.current.scrollIntoView({ behavior: "smooth" });
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only auto-scroll when new lines arrive, not on every search/filter keystroke
    }, [lines]);

    const toggleLive = () => {
        if (live) { esRef.current?.close(); esRef.current = null; setLive(false); return; }
        const es = new EventSource(instanceUrl(`${SOURCES[source].path}/stream`));
        const stream = toast.incident('logs.stream.' + source);
        const load = toast.incident('logs.load.' + source);
        const failStream = error => {
            setLoadError(error);
            stream.fail(error);
            es.close();
            esRef.current = null;
            setLive(false);
        };
        es.onmessage = e => {
            if (esRef.current !== es) {
                return;
            }
            let data;
            try { data = JSON.parse(e.data); }
            catch {
                // eslint-disable-next-line i18next/no-literal-string -- Protocol code; displayed through localizeError.
                failStream({ code: 'CLIENT_PARSE_FAILED' });
                return;
            }
            if (data.error) {
                // eslint-disable-next-line i18next/no-literal-string -- Protocol code; displayed through localizeError.
                failStream({ code: data.code || 'LOG_STREAM_ERROR', requestId: data.requestId });
                return;
            }
            const line = data.line || (data.entry ? JSON.stringify(data.entry) : null);
            if (line) {
                stream.recover();
                load.recover();
                setLoadError(null);
                setLines(l => [...l.slice(-500), line]);
            }
        };
        // The browser retries dropped connections itself; a closed source means
        // the stream was refused (e.g. an expired session) and will not recover.
        es.onerror = () => {
            if (esRef.current !== es || es.readyState !== EventSource.CLOSED) {
                return;
            }
            // eslint-disable-next-line i18next/no-literal-string -- Protocol code; displayed through localizeError.
            failStream({ code: 'LOG_STREAM_ERROR' });
        };
        esRef.current = es;
        setLive(true);
    };

    const matchesSearch = line => line.toLowerCase().includes(logSearch.toLowerCase());
    const filteredLines = lines.filter(line => matchesSearch(line) && (levelFilter === "all" || lineLevel(line) === levelFilter));

    const lineCountText = loadError && lines.length === 0 ? t("logs.unavailable") : logSearch || levelFilter !== "all"
        ? t("logs.lineCountFiltered", { filtered: filteredLines.length, total: lines.length })
        : t("logs.lineCount", { count: filteredLines.length });

    const exportLogs = () => {
        const linesToExport = (logSearch || levelFilter !== "all") && filteredLines.length > 0 ? filteredLines : lines;
        downloadText(`${SOURCES[source].filename}-${new Date().toISOString().slice(0, 10)}.log`, linesToExport.join('\n'));
    };

    const updateConfig = (key, value) => { setLogConfig(c => ({ ...c, [key]: value })); setConfigDirty(true); };

    const saveConfig = async () => {
        setSavingConfig(true);
        try {
            const result = await apiFetch("/logs/config", { method: "PUT", json: logConfig });
            toast.saved(result, t("logs.configSaved"));
            setConfigDirty(false);
        } catch (e) { toast.error(e); }
        finally { setSavingConfig(false); }
    };

    const levelBtn = (level, label) => (
        <button
            className={`btn btn-ghost btn--icon level-btn level-btn--${level} ${levelFilter === level ? "is-active" : ""}`}
            style={{ fontSize: 10 }}
            onClick={() => setLevelFilter(levelFilter === level ? "all" : level)}
        >
            {label}
        </button>
    );

    return (
        <div className="gap-16 logs-page">
            <div className="btn-row">
                <button className={`btn ${source === "caddy" ? "btn-primary" : "btn-ghost"}`} onClick={() => setSource("caddy")} disabled={noInstances} title={noInstances ? t("logs.caddyUnavailable") : undefined}>{t("logs.caddySource")}</button>
                <button className={`btn ${source === "app" ? "btn-primary" : "btn-ghost"}`} onClick={() => setSource("app")}>caddy/ui</button>
            </div>

            {source === "caddy" && (
            <ConfigCard title={t("logs.configuration")} enabled={logConfig?.enabled} open={configOpen} onToggle={() => setConfigOpen(o => !o)}>
                {!logConfig && (
                    configError ? <div className="card-body" role="alert">{localizeError(configError, t)}</div>
                        : <div className="card-body loading">{t("common.loading")}</div>
                )}
                {logConfig && (
                    <div className="card-body">
                        <div className="config-grid">
                            <div className="log-config-enabled">
                                <span className="field-label">{t("logs.logging")}</span>
                                <button
                                    type="button"
                                    className={`btn log-enabled-btn ${logConfig.enabled ? "btn-danger" : "btn-primary"}`}
                                    onClick={() => updateConfig("enabled", !logConfig.enabled)}
                                >
                                    {logConfig.enabled ? t("common.disable") : t("common.enable")}
                                </button>
                            </div>
                            <div>
                                <span className="field-label">{t("logs.format")}</span>
                                <Select value={logConfig.format} onChange={e => updateConfig("format", e.target.value)} disabled={!logConfig.enabled}>
                                    <option value="json">json</option>
                                    <option value="console">console</option>
                                </Select>
                            </div>
                            <div>
                                <span className="field-label">{t("logs.level")}</span>
                                <Select value={logConfig.level} onChange={e => updateConfig("level", e.target.value)} disabled={!logConfig.enabled}>
                                    <option value="DEBUG">DEBUG</option>
                                    <option value="INFO">INFO</option>
                                    <option value="WARN">WARN</option>
                                    <option value="ERROR">ERROR</option>
                                </Select>
                            </div>
                            <div className="config-grid-full">
                                <span className="field-label">{t("logs.logFilePath")}</span>
                                <input className="config-input" value={logConfig.path} onChange={e => updateConfig("path", e.target.value)} disabled={!logConfig.enabled} />
                            </div>
                            <div>
                                <span className="field-label">{t("logs.rollSize")}</span>
                                <input className="config-input" value={logConfig.rollSize} onChange={e => updateConfig("rollSize", e.target.value)} placeholder="50mb" disabled={!logConfig.enabled} />
                            </div>
                            <div>
                                <span className="field-label">{t("logs.rollKeep")}</span>
                                <input type="number" className="config-input" value={logConfig.rollKeep} onChange={e => updateConfig("rollKeep", parseInt(e.target.value))} min={1} max={20} disabled={!logConfig.enabled} />
                            </div>
                        </div>
                        <div className="flex-end">
                            <button className="btn btn-primary log-save-btn" onClick={saveConfig} disabled={savingConfig || !configDirty}>{savingConfig ? t("common.saving") : <><UtilityIcon name="arrowUp" /> {t("common.save")}</>}</button>
                        </div>
                    </div>
                )}
            </ConfigCard>
            )}

            <div className="log-toolbar">
                <div className="btn-row">
                    <SearchInput value={logSearch} onChange={setLogSearch} placeholder={t("logs.searchPlaceholder")} clearLabel={t("common.clearSearch")} />
                    {levelBtn("error", "ERROR")}
                    {levelBtn("warn", "WARN")}
                    {levelBtn("info", "INFO")}
                    <span className="log-line-count log-line-count--mobile">{lineCountText}</span>
                </div>
                <div className="btn-row">
                    <span className="log-line-count log-line-count--desktop">{lineCountText}</span>
                    {live && <div className="live-dot" />}
                    <button className={`btn ${live ? "btn-danger" : "btn-ghost"}`} onClick={toggleLive}><UtilityIcon name={live ? "stop" : "play"} /> {t(live ? "logs.stop" : "logs.live")}</button>
                    <button className="btn btn-ghost" onClick={loadLines} disabled={refreshing}><UtilityIcon name="refresh" /> {refreshing ? t("common.refreshing") : t("common.refresh")}</button>
                    <button className="btn btn-ghost" onClick={exportLogs}><UtilityIcon name="arrowDown" /> {t("common.export")}</button>
                </div>
            </div>
            <div className="log-wrap">
                {loadError && <div className="log-empty" role="alert">{localizeError(loadError, t)}</div>}
                {filteredLines.length === 0 ? (
                    !loadError && <div className="log-empty">{logSearch || levelFilter !== "all" ? t("logs.noMatchingLines") : t("logs.noLinesLoaded")}</div>
                ) : (
                    filteredLines.map((line, i) => (
                        <div key={i} className={`log-line ${LEVEL_CLASSES[lineLevel(line)] || ""} ${logSearch && matchesSearch(line) ? "highlight" : ""}`}>{line}</div>
                    ))
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}
