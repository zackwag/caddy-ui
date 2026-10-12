import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function useToast() {
    const [toasts, setToasts] = useState([]);
    const add = useCallback((msg, type = "info", diagnostic = null) => {
        const id = `${Date.now()}-${Math.random()}`;
        // Only server-confirmed failures provide a useful log correlation ID.
        const requestId = diagnostic?.requestId || null;
        const code = diagnostic?.code || diagnostic?.warningCode || null;
        setToasts(t => [...t, { id, msg, type, requestId, code }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000);
    }, []);
    return {
        toasts,
        success: m => add(m, "success"),
        error: (m, diagnostic) => add(m, "error", diagnostic),
        info: (m, diagnostic) => add(m, "info", diagnostic),
    };
}

export function Toasts({ toasts }) {
    const { t } = useTranslation();
    return (
        <div className="toast-wrap">
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
