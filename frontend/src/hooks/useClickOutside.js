import { useEffect, useRef } from "react";

export function useClickOutside(ref, onOutsideClick, enabled) {
    const callbackRef = useRef(onOutsideClick);
    callbackRef.current = onOutsideClick;

    useEffect(() => {
        if (!enabled) return;
        const handleClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) callbackRef.current();
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [ref, enabled]);
}
