import { useId, useRef } from "react";

// A dialog over the page, named by its title. Clicking beside it closes it,
// unless the press started inside, such as a text selection dragged past the edge.
export default function Modal({ title, onClose, className = "", style, children }) {
    const titleId = useId();
    const pressedOutside = useRef(false);
    return (
        <div
            className="modal-overlay"
            onMouseDown={e => { pressedOutside.current = e.target === e.currentTarget; }}
            onClick={e => { if (pressedOutside.current && e.target === e.currentTarget) onClose(); }}
        >
            <div className={`modal ${className}`.trim()} style={style} role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <div className="modal-title" id={titleId}>{title}</div>
                {children}
            </div>
        </div>
    );
}
