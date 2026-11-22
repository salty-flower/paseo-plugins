import { Platform } from "react-native";
import { trackDwell } from "./pad-dwell";

// The project's client types are React Native. These are the browser APIs used
// by the web adapter, and the target is React Native Web's View host element.
declare const document: {
  hasFocus(): boolean;
  visibilityState: string;
  addEventListener(event: "visibilitychange", listener: () => void): void;
  removeEventListener(event: "visibilitychange", listener: () => void): void;
};
declare const window: {
  addEventListener(event: "focus" | "blur" | "pagehide" | "pageshow", listener: () => void): void;
  removeEventListener(event: "focus" | "blur" | "pagehide" | "pageshow", listener: () => void): void;
};
declare const IntersectionObserver: {
  new (
    callback: (entries: Array<{ intersectionRatio: number }>) => void,
    options: { threshold: number[] },
  ): {
    observe(target: object): void;
    disconnect(): void;
  };
};

export function observeWebDwell(target: object, report: Parameters<typeof trackDwell>[0]): () => void {
  if (Platform.OS !== "web" || typeof IntersectionObserver === "undefined") return () => {};
  let inViewport = false;
  const isVisible = () => inViewport && document.visibilityState === "visible" && document.hasFocus();
  const dwell = trackDwell(report, isVisible);
  const refresh = () => dwell(isVisible());
  const hide = () => dwell(false);
  const observer = new IntersectionObserver(
    (entries) => {
      inViewport = (entries.at(-1)?.intersectionRatio ?? 0) >= 0.001;
      refresh();
    },
    { threshold: [0.001] },
  );
  observer.observe(target);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("focus", refresh);
  window.addEventListener("blur", hide);
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", refresh);
  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", refresh);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("blur", hide);
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", refresh);
    hide();
  };
}
