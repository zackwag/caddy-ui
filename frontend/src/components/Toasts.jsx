import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { createNotificationCenter } from "../utils/notificationCenter.js";

export function useToast() {
    // A single center owns incident lifetimes; a toast timing out must NOT
    // rearm its incident while a background failure is still ongoing.
    const [center] = useState(createNotificationCenter);
    const toasts = useSyncExternalStore(center.subscribe, center.getSnapshot, center.getSnapshot);
    useEffect(() => () => center.reset(), [center]);
    const success = useCallback(msg => center.notify(msg, "success"), [center]);
    const error = useCallback((msg, diagnostic, policy) => center.notify(msg, "error", diagnostic, policy), [center]);
    const info = useCallback((msg, diagnostic, policy) => center.notify(msg, "info", diagnostic, policy), [center]);
    const recover = useCallback((key, message) => center.recover(key, message), [center]);
    const clearStates = useCallback(() => center.clearStates(), [center]);

    return { toasts, success, error, info, recover, clearStates };
}

export function Toasts({ toasts }) {
    const { t } = useTranslation();
    return (
        <div className="toast-wrap" aria-live="polite">
            {toasts.map(toast => (
                <div key={toast.id} className={`toast toast-${toast.type}`}>
                    {toast.msg}
                    {toast.code && <code style={{ marginLeft: 8 }}>{toast.code}</code>}
                    {toast.requestId && (
                        <> {' · '}
                            <Link to={`/logs?dist=app&search=${encodeURIComponent(toast.requestId)}`}>
                                {t('errors.viewLogs')}
                            </Link>
                        </>
                    )}
                </div>
            ))}
        </div>
    );
}
