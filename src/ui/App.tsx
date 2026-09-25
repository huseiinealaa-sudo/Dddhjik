import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Game, type SessionSpec, type UiState } from '../game/game';
import { loadSettings, saveSettings, type Settings } from '../game/settings';
import { Store } from '../game/store';
import { DrillHud, HudButtons, RaceHud, Toasts } from './FlightHud';
import { I18nContext, makeT } from './i18n';
import { MainMenu } from './MainMenu';
import { Osd } from './Osd';
import { Loading, PauseMenu, Results } from './Overlays';
import { SettingsPanel } from './SettingsPanel';
import { TouchSticks } from './TouchSticks';

const placeholderUi = new Store<UiState | null>(null);

function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function useIsTouch(): boolean {
  const [touch, setTouch] = useState(() => typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  useEffect(() => {
    const on = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') setTouch(true);
    };
    window.addEventListener('pointerdown', on, { passive: true });
    return () => window.removeEventListener('pointerdown', on);
  }, []);
  return touch;
}

function toggleFullscreen(): void {
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => undefined);
    else doc.webkitExitFullscreen?.();
  } else if (el.requestFullscreen) {
    void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  } else {
    el.webkitRequestFullscreen?.();
  }
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const touch = useIsTouch();

  const i18n = useMemo(() => ({ lang: settings.language, t: makeT(settings.language) }), [settings.language]);

  useEffect(() => {
    document.documentElement.lang = settings.language;
    document.documentElement.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
    document.title = i18n.t('app.title');
  }, [settings.language, i18n]);

  // Build the game once the loading screen has painted.
  useEffect(() => {
    if (!hasWebGL2()) {
      setError(makeT(settingsRef.current.language)('loading.webgl'));
      return;
    }
    let disposed = false;
    let created: Game | null = null;
    const id = window.setTimeout(async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas || disposed) return;
        created = new Game(canvas, settingsRef.current);
        await created.warmup();
        if (disposed) {
          created.dispose();
          return;
        }
        created.start();
        setGame(created);
      } catch (e) {
        console.error(e);
        setError(`${makeT(settingsRef.current.language)('loading.error')} ${(e as Error)?.message ?? ''}`);
      }
    }, 60);
    return () => {
      disposed = true;
      window.clearTimeout(id);
      created?.dispose();
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  useEffect(() => {
    game?.applySettings(settings);
  }, [game, settings]);

  const uiStore = game?.ui ?? placeholderUi;
  const ui = useSyncExternalStore(uiStore.subscribe, uiStore.get) as UiState | null;

  // Keep the in-flight mode switch (M key, radio switch) reflected in saved settings.
  useEffect(() => {
    if (ui && ui.mode !== settingsRef.current.flightMode) update({ flightMode: ui.mode });
  }, [ui?.mode, ui, update]);

  // Block iOS page gestures (pinch zoom, bounce) while flying.
  useEffect(() => {
    const stop = (e: Event): void => e.preventDefault();
    document.addEventListener('gesturestart', stop);
    document.addEventListener('dblclick', stop);
    return () => {
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('dblclick', stop);
    };
  }, []);

  const start = (spec: SessionSpec): void => {
    game?.startSession(spec);
  };

  const inFlight = ui?.screen === 'flight';
  const paused = ui?.paused ?? false;

  return (
    <I18nContext.Provider value={i18n}>
      <div className={`app ${inFlight ? 'in-flight' : ''}`}>
        <canvas ref={canvasRef} className="scene" />
        {!game && <Loading error={error} progress="" />}

        {game && ui && ui.screen === 'menu' && (
          <MainMenu settings={settings} onChange={update} onStart={start} onSettings={() => setShowSettings(true)} onFullscreen={toggleFullscreen} />
        )}

        {game && ui && inFlight && (
          <>
            {settings.osd && ui.hud && <Osd game={game} ui={ui} units={settings.osdUnits} showFps={settings.showFps} />}
            {ui.hud && <RaceHud game={game} />}
            {ui.hud && <DrillHud game={game} />}
            {touch && !paused && (
              <TouchSticks
                stickMode={settings.stickMode}
                size={settings.touchSize}
                opacity={settings.touchOpacity}
                throttleCentering={settings.touchThrottleCentering}
                haptics={settings.haptics}
              />
            )}
            {!paused && <HudButtons ui={ui} touch={touch} />}
            <Toasts ui={ui} />
            {paused && !showSettings && (
              <PauseMenu
                onResume={() => game.setPaused(false)}
                onRestart={() => game.restartSession()}
                onMenu={() => game.toMenu()}
                onSettings={() => setShowSettings(true)}
              />
            )}
          </>
        )}

        {game && ui && ui.screen === 'results' && ui.result && (
          <Results result={ui.result} onAgain={() => game.restartSession()} onMenu={() => game.toMenu()} />
        )}

        {showSettings && (
          <SettingsPanel game={game} settings={settings} onChange={update} onClose={() => setShowSettings(false)} />
        )}
      </div>
    </I18nContext.Provider>
  );
}
