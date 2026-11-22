export const DWELL_THRESHOLD_MS = 500;

/** Match a start and end only after a continuously visible section qualifies. */
export function trackDwell(report: (viewing: boolean) => void, isStillVisible: () => boolean) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  let viewing = false;

  return (visible: boolean) => {
    if (visible) {
      if (pending !== undefined || viewing) return;
      pending = setTimeout(() => {
        pending = undefined;
        if (!isStillVisible()) return;
        viewing = true;
        report(true);
      }, DWELL_THRESHOLD_MS);
    } else {
      clearTimeout(pending);
      pending = undefined;
      if (!viewing) return;
      viewing = false;
      report(false);
    }
  };
}

const views = new Map<string, { surfaces: number; startedAt: number }>();

/** A split panel and a popover can both show the same section in one client. */
export function sharePadDwell(key: string, report: (viewing: boolean, dwellMs?: number) => void) {
  return (viewing: boolean) => {
    const current = views.get(key);
    if (viewing && current) {
      current.surfaces++;
    } else if (viewing) {
      views.set(key, { surfaces: 1, startedAt: performance.now() });
      report(true);
    } else if (current && --current.surfaces === 0) {
      views.delete(key);
      report(false, Math.max(0, Math.round(performance.now() - current.startedAt)));
    }
  };
}
