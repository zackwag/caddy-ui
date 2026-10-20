import { notifyConfigurationSave } from '../utils/caddyfileHistory.js';
import { UtilityIcon } from "./Icons.jsx";
import { localizeError } from "../utils/errorMessages.js";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { API, apiFetch, getInstanceId } from "../utils/api.js";
import { stateNotificationKey } from "../utils/notificationCenter.js";
import { resolveLogSource } from "../utils/logSource.js";

export default function Logs({ toast, onUnauth,  noInstances }) {
    const { t } = useTranslation();
    const location = useLocation();
    const [lines, setLines] = useState([]);
    // Manual tab selection lasts only for this navigation. A new link to /logs
    // must apply its destination even when the component is already mounted.
    const [selection, setSelection] = useState(null);
    const source = noInstances ? "app" : selection?.key === location.key
        ? selection.source : resolveLogSource(location.search, noInstances);
    const setSource = source => setSelection({ key: location.key, source });
    const [live, setLive] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [logConfig, setLogConfig] = useState(null);
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
    const loadIdRef = useRef(0);

    useEffect(() => {
        let ignore = false;
        loadIdRef.current += 1;
        setLines([]);
        setRefreshing(false);
        const path = source === "caddy" ? "/logs" : "/logs/app";
        // App's first /status response can arrive after the initial log request.
        const loadKey = stateNotificationKey('logs.load.' + source, getInstanceId());
        const configKey = stateNotificationKey('logs.config', getInstanceId());
        const reportError = (e, key) => {
            if (!ignore && e.code !== 'NO_INSTANCES') toast.error(localizeError(e, t), e, { mode: 'state', key });
        };
        apiFetch(path, {}, onUnauth)
            .then(data => {
                if (!ignore) {
                    toast.recover(loadKey);
                    setLines(source === "caddy" ? (data.lines || []) : (data.entries || []).map(entry => JSON.stringify(entry)));
                }
            })
            .catch(e => reportError(e, loadKey));

        if (source === "caddy" && !logConfig) {
            apiFetch("/logs/config", {}, onUnauth)
                .then(data => { if (!ignore) { toast.recover(configKey); setLogConfig(data); } })
                .catch(e => reportError(e, configKey));
        }

        esRef.current?.close();
        esRef.current = null;
        setLive(false);
        return () => { ignore = true; loadIdRef.current += 1; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when source changes; toast isn't stable across renders
    }, [onUnauth, source]);

    useEffect(() => {
        if (!logSearch && levelFilter === "all") {
            if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only auto-scroll when new lines arrive, not on every search/filter keystroke
    }, [lines]);

    const toggleLive = () => {
        if (live) { esRef.current?.close(); esRef.current = null; setLive(false); return; }
        const streamPath = source === "caddy" ? "/logs/stream" : "/logs/app/stream";
        const url = `${API}${streamPath}`;
        const es = new EventSource(url);
        const streamKey = stateNotificationKey('logs.stream.' + source, getInstanceId());
        es.onmessage = e => {
            if (esRef.current !== es) return;
            const data = JSON.parse(e.data);
            if (data.error && data.code !== 'LOG_FILE_MISSING') {
                toast.error(localizeError(data, t), data, { mode: 'state', key: streamKey });
            }
            const line = data.line || (data.entry ? JSON.stringify(data.entry) : null);
            if (line) {
                toast.recover(streamKey);
                setLines(l => [...l.slice(-500), line]);
            }
        };
        esRef.current = es;
        setLive(true);
    };

    useEffect(() => () => esRef.current?.close(), []);

    const classify = (line) => {
        const l = line.toLowerCase();
        if (l.includes('"level":"error"') || l.includes('error')) return 'err';
        if (l.includes('"level":"warn"') || l.includes('warn')) return 'warn';
        if (l.includes('"level":"info"')) return 'info';
        return '';
    };

    const matchesLevel = (line) => {
        if (levelFilter === "all") return true;
        if (levelFilter === "error") return line.toLowerCase().includes('"level":"error"');
        if (levelFilter === "warn") return line.toLowerCase().includes('"level":"warn"');
        if (levelFilter === "info") return line.toLowerCase().includes('"level":"info"');
        return true;
    };

    const filteredLines = lines.filter(line => (!logSearch || line.toLowerCase().includes(logSearch.toLowerCase())) && matchesLevel(line));

    const lineCountText = logSearch || levelFilter !== "all"
        ? t("logs.lineCountFiltered", { filtered: filteredLines.length, total: lines.length })
        : t("logs.lineCount", { count: filteredLines.length });

    const exportLogs = () => {
        const linesToExport = (logSearch || levelFilter !== "all") && filteredLines.length > 0 ? filteredLines : lines;
        const blob = new Blob([linesToExport.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${source === "caddy" ? "caddy-access" : "caddy-ui"}-${new Date().toISOString().slice(0, 10)}.log`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const refreshLogs = () => {
        setRefreshing(true);
        const loadId = loadIdRef.current;
        const path = source === "caddy" ? "/logs" : "/logs/app";
        apiFetch(path, {}, onUnauth)
            .then(d => {
                if (loadId === loadIdRef.current) {
                    toast.recover(stateNotificationKey('logs.load.' + source, getInstanceId()));
                    setLines(source === "caddy" ? (d.lines || []) : (d.entries || []).map(entry => JSON.stringify(entry)));
                }
            })
            .catch(e => { if (loadId === loadIdRef.current) toast.error(localizeError(e, t), e); })
            .finally(() => { if (loadId === loadIdRef.current) setRefreshing(false); });
    };

    const updateConfig = (key, value) => { setLogConfig(c => ({ ...c, [key]: value })); setConfigDirty(true); };

    const saveConfig = async () => {
        setSavingConfig(true);
        try {
            const result = await apiFetch("/logs/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(logConfig) }, onUnauth);
            notifyConfigurationSave(toast, t, result, t("logs.configSaved"));
            setConfigDirty(false);
        } catch (e) { toast.error(localizeError(e, t), e); }
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
            <div className="card card-flush">
                <div className={`card-header--clickable ${configOpen ? "is-open" : ""}`} onClick={() => setConfigOpen(o => !o)}>
                    <span className="section-label">{t("logs.configuration")}</span>
                    <div className="flex-center">
                        {logConfig && <span className={`badge ${logConfig.enabled ? "badge-green" : "badge-muted"}`}>{logConfig.enabled ? t("common.enabledUpper") : t("common.disabledUpper")}</span>}
                        <span className="chevron"><UtilityIcon name={configOpen ? "caretUp" : "caretDown"} /></span>
                    </div>
                </div>
                {configOpen && !logConfig && (
                    <div className="card-body loading">{t("common.loading")}</div>
                )}
                {configOpen && logConfig && (
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
                                <div className="select-wrap">
                                    <select className="config-select" value={logConfig.format} onChange={e => updateConfig("format", e.target.value)} disabled={!logConfig.enabled}>
                                        <option value="json">json</option>
                                        <option value="console">console</option>
                                    </select>
                                    <span className="select-arrow"><UtilityIcon name="caretDown" size={10} /></span>
                                </div>
                            </div>
                            <div>
                                <span className="field-label">{t("logs.level")}</span>
                                <div className="select-wrap">
                                    <select className="config-select" value={logConfig.level} onChange={e => updateConfig("level", e.target.value)} disabled={!logConfig.enabled}>
                                        <option value="DEBUG">DEBUG</option>
                                        <option value="INFO">INFO</option>
                                        <option value="WARN">WARN</option>
                                        <option value="ERROR">ERROR</option>
                                    </select>
                                    <span className="select-arrow"><UtilityIcon name="caretDown" size={10} /></span>
                                </div>
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
            </div>
            )}

            <div className="log-toolbar">
                <div className="btn-row">
                    <div className="search-wrap">
                        <input className="search-input search-input--clearable" placeholder={t("logs.searchPlaceholder")} value={logSearch} onChange={e => setLogSearch(e.target.value)} />
                        {logSearch && <button className="search-clear" onClick={() => setLogSearch("")} title={t("common.clearSearch")}><UtilityIcon name="close" /></button>}
                    </div>
                    {levelBtn("error", "ERROR")}
                    {levelBtn("warn", "WARN")}
                    {levelBtn("info", "INFO")}
                    <span className="log-line-count log-line-count--mobile">{lineCountText}</span>
                </div>
                <div className="btn-row">
                    <span className="log-line-count log-line-count--desktop">{lineCountText}</span>
                    {live && <div className="live-dot" />}
                    <button className={`btn ${live ? "btn-danger" : "btn-ghost"}`} onClick={toggleLive}><UtilityIcon name={live ? "stop" : "play"} /> {t(live ? "logs.stop" : "logs.live")}</button>
                    <button className="btn btn-ghost" onClick={refreshLogs} disabled={refreshing}><UtilityIcon name="refresh" /> {refreshing ? t("common.refreshing") : t("common.refresh")}</button>
                    <button className="btn btn-ghost" onClick={exportLogs}><UtilityIcon name="arrowDown" /> {t("common.export")}</button>
                </div>
            </div>
            <div className="log-wrap">
                {filteredLines.length === 0 ? (
                    <div className="log-empty">{logSearch || levelFilter !== "all" ? t("logs.noMatchingLines") : t("logs.noLinesLoaded")}</div>
                ) : (
                    filteredLines.map((line, i) => (
                        <div key={i} className={`log-line ${classify(line)} ${logSearch && line.toLowerCase().includes(logSearch.toLowerCase()) ? "highlight" : ""}`}>{line}</div>
                    ))
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}
