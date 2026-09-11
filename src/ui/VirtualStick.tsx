import { useCallback, useEffect, useRef } from 'react';
import { clamp, clampUnit } from '../core/MathUtils';
import { touchSticks } from '../input/InputState';

export interface VirtualStickProps {
  side: 'left' | 'right';
  /** Labels for the horizontal and vertical channel, shown under the stick. */
  labelX: string;
  labelY: string;
  /** When false the vertical axis keeps its position after the finger lifts. */
  selfCenterY: boolean;
  /** Vertical axis is a 0..1 throttle rather than a ±1 channel. */
  verticalIsThrottle: boolean;
  size: number;
}

/**
 * Touch stick for tablets and phones.
 *
 * Two details make the difference between "usable" and "unflyable":
 *
 *  1. **Relative dragging.** The knob does not jump to the finger. Movement is
 *     measured from wherever the touch started, so re-gripping the throttle
 *     stick mid-flight never produces a step change in power.
 *  2. **No React re-renders.** The knob is moved by writing a transform
 *     directly to the DOM node, and the value is written into a plain shared
 *     object that the physics loop reads. React never re-renders while flying.
 */
export function VirtualStick({
  side,
  labelX,
  labelY,
  selfCenterY,
  verticalIsThrottle,
  size,
}: VirtualStickProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLDivElement>(null);

  // Current normalised stick position, ±1 on both axes.
  const value = useRef({ x: 0, y: verticalIsThrottle ? -1 : 0 });
  const pointer = useRef<{ id: number; originX: number; originY: number; startX: number; startY: number } | null>(
    null,
  );

  const publish = useCallback(() => {
    const { x, y } = value.current;
    if (side === 'left') {
      touchSticks.leftX = x;
      touchSticks.leftY = y;
      touchSticks.leftActive = pointer.current !== null;
    } else {
      touchSticks.rightX = x;
      touchSticks.rightY = y;
      touchSticks.rightActive = pointer.current !== null;
    }
  }, [side]);

  const render = useCallback(() => {
    const knob = knobRef.current;
    if (knob) {
      const travel = size * 0.32;
      knob.style.transform = `translate(${value.current.x * travel}px, ${-value.current.y * travel}px)`;
    }
    const readout = valueRef.current;
    if (readout) {
      readout.textContent = verticalIsThrottle
        ? `THR ${Math.round(((value.current.y + 1) / 2) * 100)}%`
        : `${value.current.x >= 0 ? '+' : ''}${(value.current.x * 100).toFixed(0)} / ${
            value.current.y >= 0 ? '+' : ''
          }${(value.current.y * 100).toFixed(0)}`;
    }
  }, [size, verticalIsThrottle]);

  // Reset the vertical axis when the throttle behaviour changes.
  useEffect(() => {
    if (verticalIsThrottle && selfCenterY) {
      value.current.y = -1;
    }
    render();
    publish();
  }, [verticalIsThrottle, selfCenterY, render, publish]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;

    const radius = () => element.getBoundingClientRect().width * 0.5 * 0.72;

    const onPointerDown = (event: PointerEvent): void => {
      if (pointer.current) return;
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      pointer.current = {
        id: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        startX: value.current.x,
        startY: value.current.y,
      };
      element.classList.add('stick--active');
      publish();
    };

    const onPointerMove = (event: PointerEvent): void => {
      const active = pointer.current;
      if (!active || active.id !== event.pointerId) return;
      event.preventDefault();
      const r = radius();
      value.current.x = clampUnit(active.startX + (event.clientX - active.originX) / r);
      value.current.y = clampUnit(active.startY - (event.clientY - active.originY) / r);
      render();
      publish();
    };

    const onPointerUp = (event: PointerEvent): void => {
      const active = pointer.current;
      if (!active || active.id !== event.pointerId) return;
      pointer.current = null;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      element.classList.remove('stick--active');

      value.current.x = 0;
      if (selfCenterY) value.current.y = verticalIsThrottle ? -1 : 0;
      render();
      publish();
    };

    element.addEventListener('pointerdown', onPointerDown, { passive: false });
    element.addEventListener('pointermove', onPointerMove, { passive: false });
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);

    render();
    publish();

    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      pointer.current = null;
      if (side === 'left') {
        touchSticks.leftActive = false;
      } else {
        touchSticks.rightActive = false;
      }
    };
  }, [publish, render, selfCenterY, side, verticalIsThrottle]);

  const dimension = `${clamp(size, 100, 240)}px`;

  return (
    <div
      ref={rootRef}
      className={`stick stick--${side}`}
      style={{ ['--stick-size' as string]: dimension }}
      aria-label={`${labelX} / ${labelY} stick`}
      role="application"
    >
      <div className="stick__grid" />
      <svg className="stick__cross" viewBox="0 0 100 100" aria-hidden="true">
        <line x1="50" y1="16" x2="50" y2="84" stroke="rgba(150,180,210,0.25)" strokeWidth="0.8" />
        <line x1="16" y1="50" x2="84" y2="50" stroke="rgba(150,180,210,0.25)" strokeWidth="0.8" />
        <circle cx="50" cy="50" r="3" fill="rgba(150,180,210,0.3)" />
      </svg>
      <div ref={valueRef} className="stick__value" />
      <div ref={knobRef} className="stick__knob" />
      <div className="stick__label">
        {labelX} · {labelY}
      </div>
    </div>
  );
}
