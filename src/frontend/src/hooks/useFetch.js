import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../utils/api.js";

// Loads a path when the component mounts: { data, error, loading }, plus
// `reload`, which resolves once settled, and `setData` for changes made here.
// `data` is null until a load succeeds and again after one fails.
export function useFetch(path) {
    const [state, setState] = useState({ data: null, error: null, loading: true });
    const latest = useRef(0);

    const reload = useCallback(async () => {
        latest.current += 1;
        const request = latest.current;
        const settle = result => {
            if (request === latest.current) setState({ ...result, loading: false });
        };
        setState(previous => ({ ...previous, error: null, loading: true }));
        try {
            settle({ data: await apiFetch(path), error: null });
        } catch (error) {
            settle({ data: null, error });
        }
    }, [path]);

    const setData = useCallback(change => setState(previous => ({ ...previous, data: change(previous.data) })), []);

    useEffect(() => {
        reload();
        return () => { latest.current += 1; };
    }, [reload]);

    return { ...state, reload, setData };
}
