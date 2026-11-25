import { useRef } from "react";

// A dialog over the page. Clicking beside it closes it, unless the press
// started inside, such as a text selection dragged past the edge.
export default function Modal({ onClose, className = "", children, ...props }) {
    const pressedOutside = useRef(false);
    return (
        <div
            className="modal-overlay"
            onMouseDown={e => { pressedOutside.current = e.target === e.currentTarget; }}
            onClick={e => { if (pressedOutside.current && e.target === e.currentTarget) onClose(); }}
        >
            <div className={`modal ${className}`.trim()} role="dialog" aria-modal="true" {...props}>{children}</div>
        </div>
    );
}
