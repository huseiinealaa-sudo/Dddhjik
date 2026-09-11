import { useCallback, useEffect, useRef, useState } from 'react';
import { settingsStore } from './core/SettingsStore';
import { telemetryStore } from './core/TelemetryStore';
import { emitCommand, onCommand } from './input/InputState';
import { Simulator } from './sim/Simulator';
import { Hud } from './ui/Hud';
import { SettingsPanel } from './ui/SettingsPanel';
import { StartOverlay } from './ui/StartOverlay';
import { TouchControls } from './ui/TouchControls';
import { useStore } from './ui/useStore';
import { formatTime } from './core/MathUtils';

interface Toast {
  id: number;
  text: string;
  kind: 'good' | 'bad' | 'info';
}

function detectTouch(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    window.matchMedia?.('(pointer: coarse)').matches === true
  );
}

export default function App(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulatorRef = useRef<Simulator | null>(null);
  const toastId = useRef(0);

  const settings = useStore(settingsStore);
  const telemetry = useStore(telemetryStore);

  const [started, setStarted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [hasTouch] = useState(detectTouch);

  const pushToast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-3), { id, text, kind }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 2200);
  }, []);

  // ------------------------------------------------------- boot the engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let simulator: Simulator;
    try {
      simulator = new Simulator(canvas, {
        onGate: (index, correct) => {
          if (correct) pushToast(`GATE ${index + 1}`, 'good');
          else pushToast('WRONG GATE', 'bad');
        },
        onLap: (time, best) => {
          pushToast(`${best ? 'BEST LAP' : 'LAP'} ${formatTime(time)}`, best ? 'good' : 'info');
        },
        onCrash: () => pushToast('CRASHED', 'bad'),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `WebGL could not be initialised: ${cause.message}`
          : 'WebGL could not be initialised on this device.',
      );
      return undefined;
    }

    simulatorRef.current = simulator;
    simulator.start();

    const handleResize = (): void => simulator.handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    // iOS reports the viewport late after a rotation; a couple of retries fix it.
    const settle = window.setTimeout(handleResize, 350);

    const handleVisibility = (): void => {
      if (document.hidden) simulator.stop();
      else simulator.start();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const gamepadPoll = window.setInterval(() => {
      setGamepadConnected(simulator.gamepadConnected);
    }, 1000);

    return () => {
      window.clearTimeout(settle);
      window.clearInterval(gamepadPoll);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
      simulator.dispose();
      simulatorRef.current = null;
    };
  }, [pushToast]);

  // --------------------------------------------------------- Esc → settings
  useEffect(() => {
    return onCommand((command) => {
      if (command === 'toggleMenu') {
        if (!started) return;
        setMenuOpen((open) => !open);
      }
    });
  }, [started]);

  // Block Safari's pinch-zoom and double-tap-to-zoom while flying.
  useEffect(() => {
    const prevent = (event: Event): void => event.preventDefault();
    document.addEventListener('gesturestart', prevent);
    document.addEventListener('gesturechange', prevent);
    document.addEventListener('dblclick', prevent);
    return () => {
      document.removeEventListener('gesturestart', prevent);
      document.removeEventListener('gesturechange', prevent);
      document.removeEventListener('dblclick', prevent);
    };
  }, []);

  const handleStart = useCallback((): void => {
    setStarted(true);
    const simulator = simulatorRef.current;
    if (simulator) {
      // Audio may only start from inside a user gesture on iOS/iPadOS.
      void simulator.audio.resume();
      simulator.audio.setEnabled(settings.audioEnabled);
      simulator.audio.setVolume(settings.masterVolume);
      simulator.handleResize();
    }
    pushToast('ARM TO SPIN THE MOTORS', 'info');
  }, [pushToast, settings.audioEnabled, settings.masterVolume]);

  if (error) {
    return (
      <div className="app">
        <div className="overlay">
          <div className="panel start">
            <h1 className="start__logo">FPV SIM</h1>
            <p className="panel__subtitle">{error}</p>
            <p className="card__body">
              This simulator needs WebGL. On iPadOS make sure Safari is up to date and that
              &ldquo;WebGL&rdquo; is not disabled in Settings → Safari → Advanced → Experimental Features.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Height reserved at the bottom of the HUD so the read-outs never end up
  // underneath a virtual stick.
  const stickClearance = `${Math.round(168 * settings.stickSize + 34)}px`;

  return (
    <div className="app" style={{ ['--stick-clearance' as string]: stickClearance }}>
      <canvas ref={canvasRef} className="viewport" />

      {started ? (
        <>
          <Hud telemetry={telemetry} visible={settings.hudEnabled && !menuOpen} gamepadConnected={gamepadConnected} />
          {!menuOpen ? (
            <TouchControls
              settings={settings}
              armed={telemetry.armed}
              canArm={telemetry.blockedBy === null}
              onOpenMenu={() => setMenuOpen(true)}
            />
          ) : null}
          <div className="toasts">
            {toasts.map((toast) => (
              <div key={toast.id} className={`toast toast--${toast.kind}`}>
                {toast.text}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {!started ? (
        <StartOverlay
          settings={settings}
          hasTouch={hasTouch}
          onStart={handleStart}
          onOpenSettings={() => {
            setStarted(true);
            setMenuOpen(true);
          }}
        />
      ) : null}

      {menuOpen ? (
        <SettingsPanel
          settings={settings}
          onClose={() => setMenuOpen(false)}
          onRestartCourse={() => {
            emitCommand('restartCourse');
            setMenuOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
