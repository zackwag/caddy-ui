import { useCallback, useMemo, useState } from "react";
import { apiFetch } from "../utils/api.js";
import { getRouteStatus } from "../utils/routes.js";
import { REFRESH_INTERVAL_MS, usePoll } from "./usePoll.js";

// The live routes, their notes and their status, kept current. Status comes
// from the monitor's recorded state, like uptime and history, so the three
// never disagree. `routes` is null until a load succeeds; each error is kept
// until a load succeeds.
export function useRouteStatuses({ toast, routeChecks, routeCheckExcludes }) {
    const [routes, setRoutes] = useState(null);
    const [routesError, setRoutesError] = useState(null);
    const [notes, setNotes] = useState({});
    // Set while notes couldn't be loaded, so a blank title isn't saved over a real note
    const [notesError, setNotesError] = useState(null);
    const [uptime, setUptime] = useState({});
    const [routeUptime, setRouteUptime] = useState({});
    const [checking, setChecking] = useState(false);

    // Resolves once every request has settled; never once `signal` aborts.
    const reload = useCallback(signal => {
        setChecking(true);
        return Promise.allSettled([
            toast.track('routes.load', apiFetch("/routes", { signal }), { signal })
                .then(data => { setRoutesError(null); setRoutes(data); }, setRoutesError),
            toast.track('routeNotes.load', apiFetch("/route-notes", { signal }), { signal })
                .then(data => { setNotesError(null); setNotes(data); }, setNotesError),
            apiFetch("/health/uptime", { signal }).then(setUptime),
            routeChecks && apiFetch("/health/uptime?kind=route", { signal }).then(setRouteUptime),
        ]).finally(() => setChecking(false));
    }, [toast, routeChecks]);

    usePoll(reload, REFRESH_INTERVAL_MS);

    const excludes = useMemo(() => new Set(routeCheckExcludes), [routeCheckExcludes]);
    const statusOf = useCallback(route => getRouteStatus(route, { uptime, routeUptime, routeChecks, excludes }),
        [uptime, routeUptime, routeChecks, excludes]);

    return { routes, routesError, notes, setNotes, notesError, excludes, statusOf, checking, reload };
}
