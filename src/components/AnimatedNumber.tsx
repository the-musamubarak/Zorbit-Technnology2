import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

/**
 * Animates from its previous value to a new one whenever `value` changes,
 * rather than snapping instantly — used on the Reports/Dashboard summary
 * cards so a period change or a fresh sale feels alive rather than just
 * re-rendering text. Respects the OS-level reduce-motion preference.
 */
export function AnimatedNumber({
  value,
  format = (n: number) => String(Math.round(n)),
  duration = 0.7,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(value);
  const prevValue = useRef(value);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplay(value);
      prevValue.current = value;
      return;
    }
    const controls = animate(prevValue.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
      onComplete: () => {
        prevValue.current = value;
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{format(display)}</>;
}
