import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { AppState, type View } from "react-native";
import { observeWebWake } from "./pad-web";

/** Ages are shown in minutes, so a tick this often keeps them right. */
const TICK_MS = 15_000;
/** Pointer moves fire in bursts; refetch at most this often. */
const REFETCH_MIN_MS = 2_000;

/**
 * The clock the pad's "3m" ages read. The pad query polls, but an unchanged
 * pad keeps its data reference, so nothing re-rendered and the ages froze
 * until the panel was reopened. This ticks on its own, and jumps ahead (and
 * refetches) the moment the surface is looked at again: window focus, the pad
 * tab coming back into view, the app returning to the foreground, or the
 * pointer entering it (`wake`, for `onPointerEnter`).
 */
export function usePadClock(target: RefObject<View | null>, refetch: () => unknown): { now: number; wake: () => void } {
  const [now, setNow] = useState(Date.now);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const lastRefetch = useRef(0);
  const wake = useCallback(() => {
    const at = Date.now();
    setNow(at);
    if (at - lastRefetch.current < REFETCH_MIN_MS) return;
    lastRefetch.current = at;
    void refetchRef.current();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    const state = AppState.addEventListener("change", (next) => {
      if (next === "active") wake();
    });
    const element = target.current;
    const stopWeb = element ? observeWebWake(element, wake) : () => {};
    return () => {
      clearInterval(timer);
      state.remove();
      stopWeb();
    };
  }, [target, wake]);

  return { now, wake };
}
