import type { PluginClientContext } from "@getpaseo/plugin/client";

type Paseo = PluginClientContext["paseo"];
type Timeline = ReturnType<Paseo["agents"]["ref"]>["timeline"];
type Page = Awaited<ReturnType<Timeline["refetch"]>>;
type Item = Page["entries"][number]["item"];

/** What Ctrl+B moves: a shell command or a subagent the turn is waiting on. */
function waitsInForeground(item: Item): boolean {
  return item.type === "tool_call" && item.status === "running" && (item.detail.type === "shell" || item.detail.type === "sub_agent");
}

/**
 * Follows one agent's timeline and reports whether its turn is waiting on
 * foreground work, calling `onChange` only when that answer flips.
 *
 * Live events keep the set of waiting tool calls current. A page of the
 * latest turn seeds it at the start and after a reconnect or a timeline
 * replacement, when live events may have been missed; a tool call that a live
 * event touched while that page was loading keeps its live state.
 */
export function watchForeground(paseo: Paseo, agentId: string, onChange: (waiting: boolean) => void): () => void {
  const timeline = paseo.agents.ref(agentId).timeline;
  const waiting = new Set<string>();
  let touchedSinceSync = new Set<string>();
  let reported = false;
  let disposed = false;
  let sync = 0;

  const report = () => {
    const now = waiting.size > 0;
    if (disposed || now === reported) return;
    reported = now;
    onChange(now);
  };
  const apply = (item: Item) => {
    if (item.type !== "tool_call") return;
    if (waitsInForeground(item)) waiting.add(item.callId);
    else waiting.delete(item.callId);
  };
  const resync = async () => {
    const mine = ++sync;
    touchedSinceSync = new Set();
    const page = await timeline.refetch({ direction: "tail", limit: 1, wholeTurns: true });
    if (disposed || mine !== sync) return;
    for (const id of [...waiting]) if (!touchedSinceSync.has(id)) waiting.delete(id);
    for (const { item } of page.entries) {
      if (item.type === "tool_call" && !touchedSinceSync.has(item.callId)) apply(item);
    }
    report();
  };
  const fail = (error: unknown) => {
    if (!disposed) console.error("[background-shell] timeline observation failed", error);
  };

  const unsubscribe = timeline.subscribe(({ event }) => {
    switch (event.type) {
      case "timeline":
        if (event.item.type !== "tool_call") return;
        touchedSinceSync.add(event.item.callId);
        apply(event.item);
        return report();
      case "turn_completed":
      case "turn_failed":
      case "turn_canceled":
        waiting.clear();
        return report();
      case "subscription_restored":
      case "replacement":
        return void resync().catch(fail);
      case "error":
        return fail(event.error);
    }
  });
  void unsubscribe.ready.then(resync).catch(fail);

  return () => {
    disposed = true;
    unsubscribe();
  };
}
