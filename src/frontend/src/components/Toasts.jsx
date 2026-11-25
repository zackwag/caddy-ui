import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { createNotificationCenter } from "../utils/notificationCenter.js";
import { createToast } from "../utils/toast.js";

// `toast` keeps its identity for the life of the app, so effects and callbacks
// can depend on it.
export function useToast() {
    const { t } = useTranslation();
    const translate = useRef(t);
    translate.current = t;
    // A single center owns incident lifetimes; a toast timing out must NOT
    // rearm its incident while a background failure is still ongoing.
    const [center] = useState(createNotificationCenter);
    const toasts = useSyncExternalStore(center.subscribe, center.getSnapshot, center.getSnapshot);
    useEffect(() => () => center.reset(), [center]);
    const toast = useMemo(() => createToast(center, (key, values) => translate.current(key, values)), [center]);

    return { toast, toasts };
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
