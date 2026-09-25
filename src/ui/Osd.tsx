import { useEffect, useRef } from 'react';
import { live, type Game, type Telemetry, type UiState } from '../game/game';
import { useI18n } from './i18n';

interface Props {
  game: Game;
  ui: UiState;
  units: 'metric' | 'imperial';
  showFps: boolean;
}

const OSD_FONT = '600 {px}px "SF Mono", "Roboto Mono", ui-monospace, Menlo, Consolas, monospace';

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/**
 * Betaflight/DJI-style on-screen display, drawn on a canvas every animation
 * frame (the artificial horizon needs the full frame rate; the numbers come
 * from the 15 Hz telemetry snapshot).
 */
export function Osd({ game, ui, units, showFps }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { t } = useI18n();
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      render(ctx, w, h, game.telemetry.get(), uiRef.current, units, showFps, tRef.current);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [game, units, showFps]);

  return <canvas ref={canvas} className="osd-canvas" />;
}

function render(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tel: Telemetry,
  ui: UiState,
  units: 'metric' | 'imperial',
  showFps: boolean,
  t: (k: string) => string,
): void {
  const scale = Math.max(0.75, Math.min(1.35, Math.min(w, h) / 700));
  const fs = Math.round(17 * scale);
  const font = (px: number): string => OSD_FONT.replace('{px}', String(Math.round(px)));
  const now = performance.now() / 1000;
  const blink = Math.floor(now * 3) % 2 === 0;
  const fpv = live.cameraMode === 'fpv';

  ctx.lineJoin = 'round';
  const text = (s: string, x: number, y: number, align: CanvasTextAlign = 'left', color = '#f1f5f9', size = fs): void => {
    ctx.font = font(size);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2.5, size * 0.2);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  };

  const cx = w / 2;
  const cy = h / 2;
  const padX = Math.max(18, w * 0.04);
  const top = Math.max(22, h * 0.06) + 6;

  // ------------------------------------------------------------ horizon (AHI)
  if (fpv) {
    const pxPerDeg = h / Math.max(20, live.fov);
    const roll = (live.roll * Math.PI) / 180;
    const pitchPx = Math.max(-h * 0.3, Math.min(h * 0.3, live.pitch * pxPerDeg));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-roll);
    ctx.translate(0, pitchPx);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 4;
    const half = Math.min(w * 0.16, 170 * scale);
    const gap = 26 * scale;
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(-gap, 0);
    ctx.moveTo(gap, 0);
    ctx.lineTo(half, 0);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(241,245,249,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Crosshair.
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 4;
    const c = 9 * scale;
    ctx.beginPath();
    ctx.moveTo(cx - c * 2, cy);
    ctx.lineTo(cx - c, cy);
    ctx.moveTo(cx + c, cy);
    ctx.lineTo(cx + c * 2, cy);
    ctx.moveTo(cx, cy - c);
    ctx.lineTo(cx, cy - c * 0.4);
    ctx.stroke();
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ------------------------------------------------------------ compass strip
  {
    const stripW = Math.min(w * 0.36, 360 * scale);
    const y = top;
    const pxPerDeg = stripW / 120;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - stripW / 2, y - fs, stripW, fs * 2);
    ctx.clip();
    const labels: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    const hdg = live.heading;
    for (let d = Math.floor((hdg - 70) / 15) * 15; d <= hdg + 70; d += 15) {
      const x = cx + (d - hdg) * pxPerDeg;
      const n = ((d % 360) + 360) % 360;
      const major = n % 45 === 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y + fs * 0.25);
      ctx.lineTo(x, y + fs * (major ? 0.8 : 0.55));
      ctx.stroke();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (major) text(labels[n] ?? '', x, y - fs * 0.25, 'center', n === 0 ? '#fbbf24' : '#f1f5f9', fs * 0.85);
    }
    ctx.restore();
    text(String(Math.round(hdg) % 360).padStart(3, '0'), cx, y + fs * 1.45, 'center', '#f1f5f9', fs * 0.8);
  }

  // ------------------------------------------------------------ corners
  const vColor = tel.lowBattery === 2 ? '#f87171' : tel.lowBattery === 1 ? '#fbbf24' : '#f1f5f9';
  text(`${tel.voltage.toFixed(1)}V`, padX, top, 'left', vColor, fs * 1.2);
  text(`${tel.cellVoltage.toFixed(2)}V/c  ${Math.round(tel.batteryPercent)}%`, padX, top + fs * 1.35, 'left', vColor, fs * 0.8);
  text(`${Math.round(tel.mah)}mAh  ${tel.current.toFixed(1)}A`, padX, top + fs * 2.45, 'left', '#cbd5e1', fs * 0.8);

  const rightX = w - padX;
  text(fmtTime(tel.flightTime), rightX, top, 'right', '#f1f5f9', fs * 1.2);
  const lq = Math.round(tel.signal * 100);
  text(`LQ ${lq}`, rightX, top + fs * 1.35, 'right', lq < 40 ? '#f87171' : lq < 70 ? '#fbbf24' : '#f1f5f9', fs * 0.8);
  if (showFps) text(`${Math.round(tel.fps)} FPS`, rightX, top + fs * 2.45, 'right', '#94a3b8', fs * 0.75);

  // ------------------------------------------------------------ speed & altitude
  const imperial = units === 'imperial';
  const speed = imperial ? tel.speed * 2.23694 : tel.speed * 3.6;
  const alt = imperial ? tel.altitude * 3.28084 : tel.altitude;
  const dist = imperial ? tel.distanceHome * 3.28084 : tel.distanceHome;
  const midY = cy + h * 0.02;
  text(`${Math.round(speed)}`, padX + fs * 0.2, midY, 'left', '#f1f5f9', fs * 1.35);
  text(imperial ? 'MPH' : 'KM/H', padX + fs * 0.2, midY + fs * 1.2, 'left', '#94a3b8', fs * 0.7);
  text(`${alt.toFixed(1)}`, rightX, midY, 'right', '#f1f5f9', fs * 1.35);
  const arrow = tel.climb > 0.4 ? '▲' : tel.climb < -0.4 ? '▼' : '';
  text(`${arrow} ${imperial ? 'FT' : 'M'}`, rightX, midY + fs * 1.2, 'right', '#94a3b8', fs * 0.7);

  // ------------------------------------------------------------ bottom centre
  const bottom = h - Math.max(18, h * 0.045);
  const modeName = ui.turtle ? 'TURTLE' : ui.mode === 'acro' ? 'ACRO' : ui.mode === 'angle' ? 'ANGL' : 'HOR';
  text(`${modeName}   THR ${Math.round(tel.throttle * 100)}%   ⌂ ${Math.round(dist)}${imperial ? 'ft' : 'm'}`, cx, bottom, 'center', '#e2e8f0', fs * 0.85);

  // ------------------------------------------------------------ warnings
  const warnY = cy + h * 0.16;
  if (ui.crashed) {
    text(t('hud.crashed'), cx, warnY, 'center', '#f87171', fs * 1.6);
  } else if (ui.turtle) {
    text(t('hud.turtle'), cx, warnY, 'center', '#fbbf24', fs * 1.4);
  } else if (!ui.armed) {
    if (blink || tel.flightTime === 0) text(t('hud.disarmed'), cx, warnY, 'center', '#f1f5f9', fs * 1.4);
  } else if (tel.lowBattery === 2) {
    if (blink) text(t('hud.landNow'), cx, warnY, 'center', '#f87171', fs * 1.4);
  } else if (tel.lowBattery === 1) {
    if (blink) text(t('hud.lowBattery'), cx, warnY, 'center', '#fbbf24', fs * 1.2);
  } else if (tel.signal < 0.35) {
    if (blink) text(t('hud.signal'), cx, warnY, 'center', '#fbbf24', fs * 1.2);
  }
}
