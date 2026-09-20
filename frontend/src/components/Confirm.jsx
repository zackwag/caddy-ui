import { useCallback, useEffect, useRef, useState } from "react";

export function useConfirm() {
    const [dialog, setDialog] = useState(null);
    const resolveRef = useRef(null);

    const confirm = useCallback((message, opts = {}) => {
        return new Promise(resolve => {
            resolveRef.current = resolve;
            setDialog({
                message,
                danger: !!opts.danger,
                confirmLabel: opts.confirmLabel || "Confirm",
                cancelLabel: opts.cancelLabel || "Cancel",
            });
        });
    }, []);

    const resolve = useCallback(result => {
        resolveRef.current?.(result);
        resolveRef.current = null;
        setDialog(null);
    }, []);

    return { dialog, confirm, resolve };
}

export function ConfirmDialog({ dialog, resolve }) {
    useEffect(() => {
        if (!dialog) return;
        const onKey = e => {
            if (e.key === "Escape") resolve(false);
            if (e.key === "Enter") resolve(true);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [dialog, resolve]);

    if (!dialog) return null;

    return (
        <div className="modal-overlay" onClick={() => resolve(false)}>
            <div className="modal modal--confirm" onClick={e => e.stopPropagation()}>
                <div className="modal-title">{dialog.message}</div>
                <div className="btn-row flex-end">
                    <button className="btn btn-ghost" onClick={() => resolve(false)}>{dialog.cancelLabel}</button>
                    <button className={`btn ${dialog.danger ? "btn-danger" : "btn-primary"}`} onClick={() => resolve(true)} autoFocus>{dialog.confirmLabel}</button>
                </div>
            </div>
        </div>
    );
}
