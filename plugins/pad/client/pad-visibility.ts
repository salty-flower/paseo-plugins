import { type RefObject, useEffect, useRef } from "react";
import { AppState, Dimensions, Platform, type View } from "react-native";
import { trackDwell } from "./pad-dwell";
import { observeWebDwell } from "./pad-web";

type Measure = (x: number, y: number, width: number, height: number) => void;

export function usePadVisibility(viewport: RefObject<View | null> | undefined, report: Parameters<typeof trackDwell>[0]) {
  const ref = useRef<View>(null);
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    if (Platform.OS === "web") return observeWebDwell(target, report);

    let active = AppState.currentState === "active";
    let focused = true;
    let visible = false;
    let revision = 0;
    const isVisible = () => active && focused && visible;
    const dwell = trackDwell(report, isVisible);
    const measure = () => {
      if (!active || !focused) return;
      const current = ++revision;
      const { width: windowWidth, height: windowHeight } = Dimensions.get("window");
      const measureTarget: Measure = (x, y, width, height) => {
        const left = Math.max(0, x);
        const top = Math.max(0, y);
        const right = Math.min(windowWidth, x + width);
        const bottom = Math.min(windowHeight, y + height);
        target.measureInWindow((x, y, w, h) => {
          if (current !== revision) return;
          visible = right > left && bottom > top && w > 0 && h > 0 && x < right && x + w > left && y < bottom && y + h > top;
          dwell(isVisible());
        });
      };
      const clip = viewport?.current;
      if (clip) clip.measureInWindow(measureTarget);
      else measureTarget(0, 0, windowWidth, windowHeight);
    };
    const refresh = () => {
      ++revision;
      visible = false;
      dwell(false);
      measure();
    };
    const state = AppState.addEventListener("change", (next) => {
      active = next === "active";
      refresh();
    });
    const blur = AppState.addEventListener("blur", () => {
      focused = false;
      refresh();
    });
    const focus = AppState.addEventListener("focus", () => {
      focused = true;
      refresh();
    });
    const timer = setInterval(measure, 200);
    measure();
    return () => {
      ++revision;
      clearInterval(timer);
      state.remove();
      blur.remove();
      focus.remove();
      dwell(false);
    };
  }, [viewport, report]);
  return ref;
}
