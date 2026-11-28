import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

// The Caddyfile editor. `onQuit` and `isModified` back Vim's quit commands, where
// there is something to quit.
export default function CaddyfileEditor({ value, onChange, onSave, onQuit, isModified, theme, vimMode, padding, className }) {
    const { t, i18n } = useTranslation();
    const containerRef = useRef(null);
    const viewRef = useRef(null);
    const onChangeRef = useRef(onChange);
    const onSaveRef = useRef(onSave);
    const onQuitRef = useRef(onQuit);
    const isModifiedRef = useRef(isModified);
    // Keep the current setting available while the editor module loads.
    const vimModeRef = useRef(vimMode);

    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
    useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
    useEffect(() => { onQuitRef.current = onQuit; }, [onQuit]);
    useEffect(() => { isModifiedRef.current = isModified; }, [isModified]);
    useEffect(() => {
        vimModeRef.current = vimMode;
        viewRef.current?.setVimMode(vimMode);
    }, [vimMode]);

    useEffect(() => {
        if (!containerRef.current) return;
        let view;
        let cancelled = false;

        async function init() {
            const { createCaddyfileEditor } = await import("../utils/caddyfileEditor.js");
            if (cancelled) return;
            view = createCaddyfileEditor({
                parent: containerRef.current, doc: value, dark: theme === 'dark', padding, vimMode: vimModeRef.current,
                onChange: doc => onChangeRef.current(doc), onSave: () => onSaveRef.current?.(), t,
                onQuit: onQuit && (() => onQuitRef.current()), isModified: () => isModifiedRef.current?.() ?? false,
            });
            viewRef.current = view;
        }

        init();
        return () => { cancelled = true; view?.destroy(); viewRef.current = null; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only rebuild the editor on theme change; including `value` would tear it down on every keystroke
    }, [theme]);

    useEffect(() => { viewRef.current?.updatePhrases?.(t); }, [i18n.language, t]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }, [value]);

    return <div ref={containerRef} className={className} />;
}
