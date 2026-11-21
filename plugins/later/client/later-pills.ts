import type { PluginButtonContentProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import { pendingRpc } from "../shared/later";

const POLL_MS = 5000;

/**
 * A "Later · 2" pill in the composer of every agent with pending prompts; it
 * opens them as a popover. `sync` refreshes at once, after a schedule or cancel.
 */
export function registerLaterPills(client: PluginClientContext, Content: ComponentType<PluginButtonContentProps>) {
  const pills = new Map<string, { registration: PluginButtonRegistration; label: string }>();
  let stopped = false;

  const refresh = async () => {
    const { jobs } = await client.rpc(pendingRpc, {});
    if (stopped) return;
    const counts = new Map<string, { workspaceId: string; count: number }>();
    for (const job of jobs) {
      if (!job.workspaceId) continue;
      const entry = counts.get(job.agentId) ?? { workspaceId: job.workspaceId, count: 0 };
      entry.count += 1;
      counts.set(job.agentId, entry);
    }
    for (const [agentId, { workspaceId, count }] of counts) {
      const label = `Later · ${count}`;
      const existing = pills.get(agentId);
      if (existing) {
        if (existing.label !== label) {
          existing.registration.update({ label });
          existing.label = label;
        }
        continue;
      }
      const registration = client.addComposerPill({
        id: "later",
        workspaceId,
        agentId,
        button: {
          title: "Pending /later prompts",
          icon: "AlarmClock",
          label,
          behavior: { kind: "popover", Content },
        },
      });
      pills.set(agentId, { registration, label });
    }
    for (const [agentId, pill] of pills) {
      if (counts.has(agentId)) continue;
      pill.registration.remove();
      pills.delete(agentId);
    }
  };

  const sync = () => {
    refresh().catch((error) => {
      if (!stopped) console.warn("[later] pill sync failed", error);
    });
  };
  // Deferred past setup, like the wake call: an RPC must not throw inside it.
  const first = setTimeout(sync, 0);
  const timer = setInterval(sync, POLL_MS);

  return {
    sync,
    dispose() {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      for (const pill of pills.values()) pill.registration.remove();
      pills.clear();
    },
  };
}
