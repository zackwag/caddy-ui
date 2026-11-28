import { useEffect } from "react";

// How often views refresh what they show, and the connection status.
export const REFRESH_INTERVAL_MS = 30000;
export const STATUS_INTERVAL_MS = 15000;

// Calls `load` now and then every `ms`, until it changes or the component
// unmounts, when the AbortSignal it's passed aborts. Pass null to stop.
export function usePoll(load, ms) {
    useEffect(() => {
        if (!load) {
            return;
        }
        const controller = new AbortController();
        load(controller.signal);
        const timer = setInterval(() => load(controller.signal), ms);
        return () => { clearInterval(timer); controller.abort(); };
    }, [load, ms]);
}

// usePoll without repeating: `load` runs once, until it changes or the
// component unmounts.
export function useLoad(load) {
    useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        return () => controller.abort();
    }, [load]);
}
