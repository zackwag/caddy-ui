import { useEffect, useId, useRef } from "react";

// Open modals, newest last: Escape closes only the one on top.
const openModals = [];
// eslint-disable-next-line i18next/no-literal-string -- CSS selector
const FIELD_SELECTOR = "input:not([type=checkbox], [type=radio]), textarea, select";

// A dialog over the page, named by its title. Clicking beside it closes it,
// unless the press started inside, such as a text selection dragged past the
// edge; so does Escape, except in a field, where it would discard what was
// typed (and editors use it themselves), or while `dirty` says it holds unsaved
// changes. Without `onClose` it stays until its content closes it.
export default function Modal({ title, onClose, dirty = false, className = "", style, children }) {
    const titleId = useId();
    const pressedOutside = useRef(false);
    const onCloseRef = useRef(onClose);
    const dirtyRef = useRef(dirty);

    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
    useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

    useEffect(() => {
        const modal = {};
        openModals.push(modal);
        const onKey = e => {
            const inField = e.target.isContentEditable || e.target.matches?.(FIELD_SELECTOR);
            if (e.key !== "Escape" || e.defaultPrevented || openModals.at(-1) !== modal || inField || dirtyRef.current) {
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
            onClick={e => { if (pressedOutside.current && e.target === e.currentTarget) { onClose?.(); } }}
        >
            <div className={`modal ${className}`.trim()} style={style} role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <div className="modal-title" id={titleId}>{title}</div>
                {children}
            </div>
        </div>
    );
}
