import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../utils/api.js";
import { historyComparison } from "../utils/caddyfileHistory.js";

// The saved versions of the selected instance's Caddyfile: the list, the
// version being previewed and what it's compared with. Each is loaded
// separately, so a response that's no longer wanted is dropped.
export function useCaddyfileHistory(toast) {
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    // Kept until a load succeeds, so unreadable history isn't shown as "no snapshots"
    const [historyError, setHistoryError] = useState(null);
    const [previewEntry, setPreviewEntry] = useState(null);
    const [previewContent, setPreviewContent] = useState("");
    const [previewLoading, setPreviewLoading] = useState(false);
    const [compareLoading, setCompareLoading] = useState(false);
    const [compareTo, setCompareTo] = useState("current");
    const [compareContent, setCompareContent] = useState(null);
    const [previewObservation, setPreviewObservation] = useState(null);
    const snapshotCache = useRef(new Map());
    const previewRef = useRef(null);
    const previewRequest = useRef(0);
    const compareRequest = useRef(0);
    const historyRequest = useRef(0);
    const selectedFilename = useRef(null);
    const comparisonFilename = useRef("current");

    useEffect(() => () => {
        historyRequest.current++;
        previewRequest.current++;
        compareRequest.current++;
    }, []);

    const showPreview = (entry) => {
        previewRequest.current++;
        compareRequest.current++;
        selectedFilename.current = entry?.filename ?? null;
        comparisonFilename.current = "current";
        setPreviewEntry(entry); setPreviewContent(""); setPreviewLoading(!!entry);
        setPreviewObservation(null);
        setCompareTo("current"); setCompareContent(null); setCompareLoading(false);
    };

    const clearPreview = () => showPreview(null);

    const loadHistory = async (selectLatest = false) => {
        const request = ++historyRequest.current;
        setHistoryLoading(true);
        try {
            const entries = await apiFetch("/caddyfile/history");
            if (request !== historyRequest.current) {
                return;
            }
            setHistoryError(null);
            setHistory(entries);
            const selected = (!selectLatest && entries.find(entry => entry.filename === selectedFilename.current)) || entries[0];
            if (!selected) {
                clearPreview();
            } else if (selected.filename !== selectedFilename.current) {
                previewSnapshot(selected, entries);
            } else {
                setPreviewEntry(selected);
                if (comparisonFilename.current !== "current" && !entries.some(entry => entry.filename === comparisonFilename.current)) {
                    changeCompareTo("current");
                }
            }
        } catch (e) {
            if (request === historyRequest.current) { setHistoryError(e); toast.error(e); }
        } finally {
            if (request === historyRequest.current) {
                setHistoryLoading(false);
            }
        }
    };

    // Snapshots never change once written, so each is fetched at most once.
    const fetchSnapshot = async (filename) => {
        if (!snapshotCache.current.has(filename)) {
            snapshotCache.current.set(filename, await apiFetch(`/caddyfile/history/${filename}`));
        }
        return snapshotCache.current.get(filename);
    };

    const previewSnapshot = async (entry, entries = history) => {
        if (!entry) {
            return;
        }
        if (selectedFilename.current === entry.filename) {
            return;
        }
        showPreview(entry);
        const request = previewRequest.current;
        const comparison = entry.kind === 'external' ? 'current' : historyComparison(entry, entries);
        if (comparison !== 'current') {
            changeCompareTo(comparison);
        }
        previewRef.current?.scrollTo({ top: 0 });
        try {
            if (entry.kind === 'external') {
                const observation = await apiFetch(`/caddyfile/history/${entry.filename}/changes`);
                if (request === previewRequest.current) {
                    setPreviewObservation(observation);
                }
            } else {
                const text = await fetchSnapshot(entry.filename);
                if (request === previewRequest.current) {
                    setPreviewContent(text);
                }
            }
        } catch (e) {
            if (request === previewRequest.current) {
                selectedFilename.current = null;
                setPreviewEntry(null);
                toast.error(e);
            }
        } finally {
            if (request === previewRequest.current) {
                setPreviewLoading(false);
            }
        }
    };

    const changeCompareTo = async (target) => {
        const request = ++compareRequest.current;
        comparisonFilename.current = target;
        setCompareTo(target); setCompareContent(null);
        setCompareLoading(target !== "current");
        if (target === "current") {
            return;
        }
        try {
            const text = await fetchSnapshot(target);
            if (request === compareRequest.current) {
                setCompareContent(text);
            }
        } catch (e) {
            if (request === compareRequest.current) {
                comparisonFilename.current = "current";
                setCompareTo("current");
                toast.error(e);
            }
        } finally {
            if (request === compareRequest.current) {
                setCompareLoading(false);
            }
        }
    };

    const remove = async (entry) => {
        await apiFetch(`/caddyfile/history/${entry.filename}`, { method: "DELETE" });
        snapshotCache.current.delete(entry.filename);
        if (selectedFilename.current === entry.filename) {
            clearPreview();
        } else if (comparisonFilename.current === entry.filename) {
            changeCompareTo("current");
        }
        loadHistory();
    };

    return {
        entries: history, loading: historyLoading, error: historyError, load: loadHistory, clear: clearPreview, remove, fetchSnapshot,
        preview: {
            ref: previewRef, entry: previewEntry, content: previewContent, observation: previewObservation, loading: previewLoading,
            select: previewSnapshot,
        },
        comparison: { target: compareTo, content: compareContent, loading: compareLoading, change: changeCompareTo },
    };
}
