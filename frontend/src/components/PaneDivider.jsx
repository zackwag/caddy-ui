import { useEffect, useRef, useState } from "react";

export default function PaneDivider({ containerRef, primaryMinimumRef, secondaryMinimumRef, primaryPaneId, value, onChange }) {
    const dividerRef = useRef(null);
    const [limits, setLimits] = useState({ min: 0, max: 100 });

    useEffect(() => {
        const container = containerRef.current;
        const primaryMinimum = primaryMinimumRef.current;
        const secondaryMinimum = secondaryMinimumRef.current;
        const divider = dividerRef.current;
        if (!container || !primaryMinimum || !secondaryMinimum || !divider) return;

        const measure = () => {
            const available = container.clientHeight - divider.offsetHeight;
            if (available <= 0) return;
            // Leave room for the controls and content in each pane.
            const min = Math.min(100, (primaryMinimum.offsetHeight + 34) / available * 100);
            const max = Math.max(min, 100 - (secondaryMinimum.offsetHeight + 34) / available * 100);
            setLimits(previous => previous.min === min && previous.max === max ? previous : { min, max });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        observer.observe(primaryMinimum);
        observer.observe(secondaryMinimum);
        measure();
        return () => observer.disconnect();
    }, [containerRef, primaryMinimumRef, secondaryMinimumRef]);

    useEffect(() => {
        const clamped = Math.max(limits.min, Math.min(limits.max, value));
        if (clamped !== value) onChange(clamped);
    }, [limits, value, onChange]);

    const resize = next => onChange(Math.max(limits.min, Math.min(limits.max, next)));

    const move = event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const container = containerRef.current;
        const available = container.clientHeight - event.currentTarget.offsetHeight;
        if (available <= 0) return;
        const offset = event.clientY - container.getBoundingClientRect().top - event.currentTarget.offsetHeight / 2;
        resize(offset / available * 100);
    };

    const release = event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const onKeyDown = event => {
        const targets = { ArrowUp: value - 5, ArrowDown: value + 5, Home: limits.min, End: limits.max };
        if (!(event.key in targets)) return;
        event.preventDefault();
        resize(targets[event.key]);
    };

    return (
        <div
            ref={dividerRef}
            className="pane-divider"
            role="separator"
            aria-label="Resize editor and history panes"
            aria-orientation="horizontal"
            aria-controls={primaryPaneId}
            aria-valuemin={Math.round(limits.min)}
            aria-valuemax={Math.round(limits.max)}
            aria-valuenow={Math.round(value)}
            aria-valuetext={`${Math.round(value)}% editor, ${Math.round(100 - value)}% history`}
            tabIndex={0}
            title="Drag or use arrow keys to resize. Double-click to reset."
            onPointerDown={event => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={move}
            onPointerUp={release}
            onPointerCancel={release}
            onKeyDown={onKeyDown}
            onDoubleClick={() => resize(60)}
        />
    );
}
