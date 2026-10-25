"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Hands every motion primitive the same rules: honour the OS "reduce motion"
 * preference (transforms collapse to fades) and keep springs snappy.
 */
export default function MotionShell({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
