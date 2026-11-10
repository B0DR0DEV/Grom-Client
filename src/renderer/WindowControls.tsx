import { useEffect, useState } from 'react';

type WindowControlsProps = {
  mode?: 'embedded' | 'floating';
};

export default function WindowControls({ mode = 'embedded' }: WindowControlsProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    void window.grom.windowControls.isMaximized().then((value) => {
      if (active) setMaximized(value);
    }).catch(() => undefined);
    const unsubscribe = window.grom.windowControls.onMaximized((value) => setMaximized(value));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const minimize = () => { void window.grom.windowControls.minimize(); };
  const toggleMaximize = async () => {
    try {
      const value = await window.grom.windowControls.toggleMaximize();
      setMaximized(value);
    } catch {
      // Keep the current UI state if the native window can't be changed.
    }
  };
  const close = () => { void window.grom.windowControls.close(); };

  return (
    <div className={`grom-windowbar ${mode === 'floating' ? 'grom-windowbar-floating' : 'grom-windowbar-embedded'}`}>
      {mode === 'floating' && (
        <div
          className="grom-windowbar-drag-surface"
          onDoubleClick={() => { void toggleMaximize(); }}
          aria-hidden="true"
        >
          <span className="grom-windowbar-mark">ϟ</span>
          <span className="grom-windowbar-title">GROM CLIENT</span>
        </div>
      )}
      <div className="grom-window-controls-buttons">
        <button className="grom-window-control" type="button" aria-label="Свернуть окно" title="Свернуть" onClick={minimize}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
        </button>
        <button className="grom-window-control" type="button" aria-label={maximized ? 'Восстановить окно' : 'Развернуть окно'} title={maximized ? 'Восстановить' : 'Развернуть'} onClick={() => { void toggleMaximize(); }}>
          {maximized ? (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5h7v7h-7z" /><path d="M3.5 6.5v6h6" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx=".5" /></svg>
          )}
        </button>
        <button className="grom-window-control grom-window-control-close" type="button" aria-label="Закрыть окно" title="Закрыть" onClick={close}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>
      </div>
    </div>
  );
}
