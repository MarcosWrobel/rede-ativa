"use client";

import { useEffect, useRef, useState } from "react";

export interface ScrollHideInput {
  currentY: number;
  lastY: number;
  currentlyHidden: boolean;
  topThreshold?: number;
  hideDelta?: number;
  showDelta?: number;
}

/**
 * Calcula se o cabeçalho fixo deve permanecer oculto de acordo com a posição e direção da rolagem.
 */
export function computeNextHeaderHiddenState({
  currentY,
  lastY,
  currentlyHidden,
  topThreshold = 48,
  hideDelta = 8,
  showDelta = 6,
}: ScrollHideInput): boolean {
  const safeY = Math.max(0, currentY);
  if (safeY <= topThreshold) {
    return false;
  }

  const delta = safeY - lastY;
  if (delta > hideDelta) {
    return true;
  }
  if (delta < -showDelta) {
    return false;
  }

  return currentlyHidden;
}

/**
 * Oculta o cabeçalho ao rolar para baixo e o reexibe ao rolar para cima ou retornar ao topo.
 */
export function useAutoHideHeader(): boolean {
  const [isHidden, setIsHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  const hiddenRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    lastScrollYRef.current = Math.max(0, window.scrollY || 0);

    const handleScroll = () => {
      const currentY = Math.max(0, window.scrollY || 0);
      const nextHidden = computeNextHeaderHiddenState({
        currentY,
        lastY: lastScrollYRef.current,
        currentlyHidden: hiddenRef.current,
      });

      lastScrollYRef.current = currentY;
      if (nextHidden !== hiddenRef.current) {
        hiddenRef.current = nextHidden;
        setIsHidden(nextHidden);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return isHidden;
}
