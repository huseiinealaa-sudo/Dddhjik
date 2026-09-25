import { useEffect, useRef } from 'react';
import { touchSticks } from '../input/bus';
import { STICK_LAYOUT, type StickMode } from '../input/inputManager';

interface Props {
  stickMode: StickMode;
  size: number;
  opacity: number;
  /** Throttle stick springs back to centre (game-pad style) instead of staying put. */
  throttleCentering: boolean;
  haptics: boolean;
}

interface StickState {
  pointer: number | null;
  /** Normalised position, ±1, +y up. */
  x: number;
  y: number;
}

/**
 * Two virtual gimbals. Each owns half of the screen: a finger landing anywhere
 * on that half grabs the stick and moves it *absolutely* relative to the
 * gimbal's centre, like a real radio. Roll/pitch/yaw spring back on release;
 * the throttle axis stays where it was left (a real throttle gimbal has no
 * spring). Positions are written straight into `touchSticks` — no React state.
 */
export function TouchSticks({ stickMode, size, opacity, throttleCentering, haptics }: Props) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const leftKnob = useRef<HTMLDivElement>(null);
  const rightKnob = useRef<HTMLDivElement>(null);
  const state = useRef<{ left: StickState; right: StickState }>({
    left: { pointer: null, x: 0, y: 0 },
    right: { pointer: null, x: 0, y: 0 },
  });

  const layout = STICK_LAYOUT[stickMode];
  const leftThrottle = layout.leftY === 'throttle';

  // Initialise the throttle stick at the bottom (throttle off).
  useEffect(() => {
    const s = state.current;
    if (leftThrottle) {
      s.left.y = throttleCentering ? 0 : -1;
      s.right.y = 0;
    } else {
      s.right.y = throttleCentering ? 0 : -1;
      s.left.y = 0;
    }
    write();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftThrottle, throttleCentering]);

  const write = (): void => {
    const s = state.current;
    touchSticks.leftX = s.left.x;
    touchSticks.leftY = s.left.y;
    touchSticks.rightX = s.right.x;
    touchSticks.rightY = s.right.y;
    touchSticks.leftActive = s.left.pointer !== null;
    touchSticks.rightActive = s.right.pointer !== null;
    const place = (knob: HTMLDivElement | null, st: StickState): void => {
      if (!knob) return;
      knob.style.transform = `translate(${st.x * 50}%, ${-st.y * 50}%)`;
    };
    place(leftKnob.current, s.left);
    place(rightKnob.current, s.right);
  };

  // Keep the knobs in sync with values changed elsewhere (e.g. throttle zeroed on reset).
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      const s = state.current;
      if (s.left.pointer === null && touchSticks.leftY !== s.left.y) s.left.y = touchSticks.leftY;
      if (s.right.pointer === null && touchSticks.rightY !== s.right.y) s.right.y = touchSticks.rightY;
      write();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlers = (side: 'left' | 'right') => {
    const gimbal = side === 'left' ? leftRef : rightRef;
    const isThrottle = side === 'left' ? leftThrottle : !leftThrottle;
    const move = (e: React.PointerEvent): void => {
      const st = state.current[side];
      if (st.pointer !== e.pointerId || !gimbal.current) return;
      const r = gimbal.current.getBoundingClientRect();
      const half = r.width / 2;
      const x = (e.clientX - (r.left + half)) / half;
      const y = -(e.clientY - (r.top + r.height / 2)) / half;
      st.x = Math.max(-1, Math.min(1, x));
      st.y = Math.max(-1, Math.min(1, y));
      write();
    };
    return {
      onPointerDown: (e: React.PointerEvent) => {
        const st = state.current[side];
        if (st.pointer !== null) return;
        st.pointer = e.pointerId;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        if (haptics && navigator.vibrate) navigator.vibrate(5);
        move(e);
        e.preventDefault();
      },
      onPointerMove: move,
      onPointerUp: (e: React.PointerEvent) => {
        const st = state.current[side];
        if (st.pointer !== e.pointerId) return;
        st.pointer = null;
        st.x = 0;
        if (!isThrottle || throttleCentering) st.y = 0;
        write();
      },
      onPointerCancel: (e: React.PointerEvent) => {
        const st = state.current[side];
        if (st.pointer !== e.pointerId) return;
        st.pointer = null;
        st.x = 0;
        if (!isThrottle || throttleCentering) st.y = 0;
        write();
      },
    };
  };

  const px = Math.round(150 * size);
  const style = { '--stick': `${px}px`, opacity } as React.CSSProperties;
  const label = (side: 'left' | 'right'): string => {
    const x = side === 'left' ? layout.leftX : layout.rightX;
    const y = side === 'left' ? layout.leftY : layout.rightY;
    return `${y === 'throttle' ? 'THR' : 'PIT'} · ${x === 'yaw' ? 'YAW' : 'ROL'}`;
  };

  return (
    <div className="touch-layer" style={style}>
      {(['left', 'right'] as const).map((side) => {
        const isThrottle = side === 'left' ? leftThrottle : !leftThrottle;
        return (
          <div key={side} className={`touch-zone touch-zone-${side}`} {...handlers(side)}>
            <div ref={side === 'left' ? leftRef : rightRef} className={`gimbal ${isThrottle ? 'gimbal-throttle' : ''}`}>
              <div className="gimbal-cross" />
              <div ref={side === 'left' ? leftKnob : rightKnob} className="gimbal-knob-track">
                <div className="gimbal-knob" />
              </div>
              <span className="gimbal-label">{label(side)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
