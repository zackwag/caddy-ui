import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "./Modal.jsx";

export function useConfirm() {
    const [dialog, setDialog] = useState(null);
    const resolveRef = useRef(null);

    const confirm = useCallback((message, { confirmLabel, danger = false }) => {
        return new Promise(resolve => {
            resolveRef.current = resolve;
            setDialog({ message, confirmLabel, danger });
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
    const { t } = useTranslation();

    useEffect(() => {
        if (!dialog) return;
        const onKey = e => { if (e.key === "Escape") resolve(false); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [dialog, resolve]);

    if (!dialog) return null;

    return (
        <Modal className="modal--confirm" title={dialog.message} onClose={() => resolve(false)}>
            <div className="btn-row flex-end">
                <button className="btn btn-ghost" onClick={() => resolve(false)}>{t("common.cancel")}</button>
                <button className={`btn ${dialog.danger ? "btn-danger" : "btn-primary"}`} onClick={() => resolve(true)} autoFocus>{dialog.confirmLabel}</button>
            </div>
        </Modal>
    );
}
