import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../utils/api.js";
import { getRouteStatus } from "../utils/routes.js";
import { REFRESH_INTERVAL_MS, usePoll } from "./usePoll.js";

// While a route check hasn't recorded anything yet, such as just after route
// checks are turned on, its first round is picked up this soon.
const PENDING_INTERVAL_MS = 5000;
// One route-check round (monitoring.js): a host still without results after
// that waits for the normal interval.
const PENDING_LIMIT_MS = 5 * 60_000;

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
    const [routeUptimeFailed, setRouteUptimeFailed] = useState(false);
    // The pending hosts the fast poll stopped waiting for
    const [gaveUpOn, setGaveUpOn] = useState(null);
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
            routeChecks && apiFetch("/health/uptime?kind=route", { signal })
                .then(data => { setRouteUptimeFailed(false); setRouteUptime(data); }, () => setRouteUptimeFailed(true)),
        ]).finally(() => setChecking(false));
    }, [toast, routeChecks]);

    const excludes = useMemo(() => new Set(routeCheckExcludes), [routeCheckExcludes]);
    const statusOf = useCallback(route => getRouteStatus(route, { uptime, routeUptime, routeChecks, excludes }),
        [uptime, routeUptime, routeChecks, excludes]);

    // Results that failed to load aren't pending: polling faster won't bring them
    const pendingHosts = routeUptimeFailed ? '' : (routes || []).map(statusOf)
        .filter(({ checkHost, stats }) => checkHost && !stats).map(({ checkHost }) => checkHost).sort().join(' ');
    useEffect(() => {
        if (!pendingHosts) {
            return;
        }
        const timer = setTimeout(() => setGaveUpOn(pendingHosts), PENDING_LIMIT_MS);
        return () => clearTimeout(timer);
    }, [pendingHosts]);
    const checkPending = !!pendingHosts && pendingHosts !== gaveUpOn;
    usePoll(reload, checkPending ? PENDING_INTERVAL_MS : REFRESH_INTERVAL_MS);

    return { routes, routesError, notes, setNotes, notesError, excludes, statusOf, checking, reload };
}
