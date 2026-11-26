import { useEffect, useId, useRef } from "react";

// Open modals, newest last: Escape closes only the one on top.
const openModals = [];
// eslint-disable-next-line i18next/no-literal-string -- CSS selector
const EDITOR_SELECTOR = ".cm-editor";

// A dialog over the page, named by its title. Clicking beside it or pressing
// Escape closes it, unless the press started inside, such as a text selection
// dragged past the edge. Without `onClose` it stays until its content closes it.
export default function Modal({ title, onClose, className = "", style, children }) {
    const titleId = useId();
    const pressedOutside = useRef(false);
    const onCloseRef = useRef(onClose);

    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    useEffect(() => {
        const modal = {};
        openModals.push(modal);
        const onKey = e => {
            // The editor uses Escape itself (Vim, completions, leaving the editor),
            // and closing would discard its text.
            if (e.key !== "Escape" || e.defaultPrevented || openModals.at(-1) !== modal || e.target.closest?.(EDITOR_SELECTOR)) {
                return;
            }
            onCloseRef.current?.();
        };
        window.addEventListener("keydown", onKey);
        return () => {
            openModals.splice(openModals.indexOf(modal), 1);
            window.removeEventListener("keydown", onKey);
        };
    }, []);

    return (
        <div
            className="modal-overlay"
            onMouseDown={e => { pressedOutside.current = e.target === e.currentTarget; }}
            onClick={e => { if (pressedOutside.current && e.target === e.currentTarget) onClose?.(); }}
        >
            <div className={`modal ${className}`.trim()} style={style} role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <div className="modal-title" id={titleId}>{title}</div>
                {children}
            </div>
        </div>
    );
}
