import { useCallback, useState } from "react";
import { apiFetch } from "../utils/api.js";
import { STATUS_INTERVAL_MS, usePoll } from "./usePoll.js";

export function useInstanceStatus() {
    const [instanceStatus, setInstanceStatus] = useState({});

    const fetchStatus = useCallback(() =>
        apiFetch("/instances/status").then(results => {
            const map = {};
            for (const r of results) map[r.id] = r.online;
            setInstanceStatus(map);
        }).catch(() => { }), []);

    usePoll(fetchStatus, STATUS_INTERVAL_MS);

    return instanceStatus;
}
