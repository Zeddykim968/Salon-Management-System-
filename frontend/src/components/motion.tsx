"use client";

import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
  type MotionStyle,
} from "framer-motion";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** Shared easing — a soft "arrive" curve used everywhere. */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const SPRING = { stiffness: 260, damping: 20, mass: 0.4 } as const;

/* -------------------------------------------------------------------------- */
/* Reveal — element rises into place the first time it scrolls into view.      */
/* -------------------------------------------------------------------------- */
export function Reveal({
  children,
  className = "",
  delay = 0,
  y = 26,
  duration = 0.7,
  once = true,
  style,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  duration?: number;
  once?: boolean;
  style?: MotionStyle;
}) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "-60px" }}
      transition={{ duration, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stagger — a container whose children cascade in one after another.          */
/* -------------------------------------------------------------------------- */
export function Stagger({
  children,
  className = "",
  delay = 0,
  gap = 0.07,
  style,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  gap?: number;
  style?: MotionStyle;
}) {
  return (
    <motion.div
      className={className}
      style={style}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: gap, delayChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function Item({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: MotionStyle;
}) {
  return (
    <motion.div
      className={`motion-item ${className}`.trim()}
      style={style}
      variants={{
        hidden: { opacity: 0, y: 22, scale: 0.98 },
        show: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { duration: 0.55, ease: EASE },
        },
      }}
      // Gesture transitions live on the gesture itself: a top-level
      // `transition` would also apply to the variants and make the entrance
      // spring instead of easing, which read as a stutter.
      whileHover={{
        y: -6,
        transition: { type: "spring", stiffness: 340, damping: 22, mass: 0.4 },
      }}
      whileTap={{ scale: 0.985, transition: { duration: 0.12 } }}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Magnetic — the wrapper leans toward the cursor (mouse) and squashes on tap   */
/* (touch), so buttons feel like they are being pulled into the click.          */
/* -------------------------------------------------------------------------- */
export function Magnetic({
  children,
  className = "",
  strength = 0.3,
  style,
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
  style?: MotionStyle;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, SPRING);
  const y = useSpring(my, SPRING);

  return (
    <motion.div
      ref={ref}
      className={`magnetic ${className}`}
      style={{ x, y, ...style }}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse") return;
        const el = ref.current;
        if (!el) return;
        const box = el.getBoundingClientRect();
        mx.set((event.clientX - (box.left + box.width / 2)) * strength);
        my.set((event.clientY - (box.top + box.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        mx.set(0);
        my.set(0);
      }}
      whileTap={{ scale: 0.94 }}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tilt — a card that pitches and yaws under the pointer for a little depth.   */
/* -------------------------------------------------------------------------- */
export function Tilt({
  children,
  className = "",
  max = 7,
  style,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
  style?: MotionStyle;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const rotateX = useSpring(rx, SPRING);
  const rotateY = useSpring(ry, SPRING);

  return (
    <motion.div
      ref={ref}
      className={`tilt ${className}`}
      style={{ rotateX, rotateY, ...style }}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse") return;
        const el = ref.current;
        if (!el) return;
        const box = el.getBoundingClientRect();
        const px = (event.clientX - box.left) / box.width - 0.5;
        const py = (event.clientY - box.top) / box.height - 0.5;
        ry.set(px * max * 2);
        rx.set(-py * max * 2);
      }}
      onPointerLeave={() => {
        rx.set(0);
        ry.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Float — slow ambient bobbing for decorative art and badges.                 */
/* -------------------------------------------------------------------------- */
export function Float({
  children,
  className = "",
  distance = 14,
  duration = 6,
  delay = 0,
  style,
}: {
  children: ReactNode;
  className?: string;
  distance?: number;
  duration?: number;
  delay?: number;
  style?: MotionStyle;
}) {
  return (
    <motion.div
      className={className}
      style={style}
      animate={{ y: [distance, -distance, distance] }}
      transition={{
        duration,
        repeat: Infinity,
        ease: "easeInOut",
        delay,
      }}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* DragRow — a carousel you can throw with a finger or the mouse.              */
/* Arrows nudge it with a spring so desktop users get the same feel.           */
/* -------------------------------------------------------------------------- */
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function DragRow({
  children,
  className = "",
  step = 340,
  nav = true,
}: {
  children: ReactNode;
  className?: string;
  /** How far an arrow press moves the row. */
  step?: number;
  /** Show the ← → controls (hidden automatically on very narrow screens). */
  nav?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const [bounds, setBounds] = useState({ left: 0, right: 0 });
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const overflow = useCallback(() => {
    const view = viewport.current;
    const row = track.current;
    if (!view || !row) return 0;
    return Math.max(0, row.scrollWidth - view.clientWidth);
  }, []);

  const sync = useCallback(() => {
    const total = overflow();
    const current = clamp(x.get(), -total, 0);
    if (current !== x.get()) x.set(current);
    setBounds({ left: -total, right: 0 });
    setCanPrev(current < -2);
    setCanNext(current > -total + 2);
  }, [overflow, x]);

  useEffect(() => {
    sync();
    window.addEventListener("resize", sync);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => sync())
        : null;
    if (observer && track.current) observer.observe(track.current);
    return () => {
      window.removeEventListener("resize", sync);
      observer?.disconnect();
    };
  }, [sync]);

  // Keep the ← → states truthful while the row is moving.
  useMotionValueEvent(x, "change", () => {
    const total = overflow();
    const current = clamp(x.get(), -total, 0);
    const prev = current < -2;
    const next = current > -total + 2;
    if (prev !== canPrev) setCanPrev(prev);
    if (next !== canNext) setCanNext(next);
  });

  const nudge = (direction: 1 | -1) => {
    const target = clamp(x.get() - direction * step, -overflow(), 0);
    animate(x, target, { type: "spring", stiffness: 240, damping: 30 });
  };

  return (
    <div className={`drag ${className}`}>
      <div className="drag-viewport" ref={viewport}>
        <motion.div
          className="drag-track"
          ref={track}
          style={{ x }}
          drag="x"
          dragConstraints={bounds}
          dragElastic={0.08}
          dragMomentum
          dragTransition={{ power: 0.28, timeConstant: 240 }}
        >
          {children}
        </motion.div>
      </div>

      {nav ? (
        <div className="drag-nav" aria-hidden={false}>
          <button
            type="button"
            className="drag-btn"
            onClick={() => nudge(-1)}
            disabled={!canPrev}
            aria-label="Scroll left"
          >
            ←
          </button>
          <button
            type="button"
            className="drag-btn"
            onClick={() => nudge(1)}
            disabled={!canNext}
            aria-label="Scroll right"
          >
            →
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PageWrap — every page drifts up into place on entry.                        */
/* -------------------------------------------------------------------------- */
export function PageWrap({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* CountUp — rolls from the previous figure to the new one as soon as the data
   lands (the stats live in the hero, so there is nothing to wait for).        */
/* -------------------------------------------------------------------------- */
export function CountUp({
  to,
  duration = 1.3,
  prefix = "",
  suffix = "",
}: {
  to: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
}) {
  const [value, setValue] = useState(0);
  const shown = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(to) || to <= 0) return;
    const controls = animate(shown.current, to, {
      duration,
      ease: "easeOut",
      onUpdate: (latest) => {
        shown.current = latest;
        setValue(Math.round(latest));
      },
      onComplete: () => {
        shown.current = to;
        setValue(to);
      },
    });
    return () => controls.stop();
  }, [to, duration]);

  return (
    <span>
      {prefix}
      {value.toLocaleString()}
      {suffix}
    </span>
  );
}
