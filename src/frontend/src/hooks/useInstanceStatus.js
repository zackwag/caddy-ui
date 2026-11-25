import { useEffect, useState } from "react";
import { apiFetch } from "../utils/api.js";

const POLL_INTERVAL_MS = 15000;

export function useInstanceStatus() {
    const [instanceStatus, setInstanceStatus] = useState({});

    useEffect(() => {
        const fetchStatus = () =>
            apiFetch("/instances/status").then(results => {
                const map = {};
                for (const r of results) map[r.id] = r.online;
                setInstanceStatus(map);
            }).catch(() => { });
        fetchStatus();
        const t = setInterval(fetchStatus, POLL_INTERVAL_MS);
        return () => clearInterval(t);
    }, []);

    return instanceStatus;
}
