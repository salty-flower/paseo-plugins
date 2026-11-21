import type { PluginButtonContentProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import { age, padListRpc } from "../shared/pad";

const POLL_MS = 5000;

/** A "Pad · 3m" pill in the composer of every agent that has a pad; it opens the pad as a popover. */
export function registerPadPills(client: PluginClientContext, Content: ComponentType<PluginButtonContentProps>): () => void {
  const pills = new Map<string, { registration: PluginButtonRegistration; label: string }>();
  let stopped = false;

  const sync = async () => {
    const { pads } = await client.rpc(padListRpc, {});
    if (stopped) return;
    const seen = new Set<string>();
    for (const pad of pads) {
      const workspaceId = pad.workspaceId;
      if (!workspaceId) continue;
      seen.add(pad.agentId);
      const label = `Pad · ${age(pad.updatedAt)}`;
      const existing = pills.get(pad.agentId);
      if (existing) {
        if (existing.label !== label) {
          existing.registration.update({ label });
          existing.label = label;
        }
        continue;
      }
      const agentId = pad.agentId;
      const registration = client.addComposerPill({
        id: "pad",
        workspaceId,
        agentId,
        button: {
          title: "Show this agent's pad",
          icon: "NotebookPen",
          label,
          behavior: { kind: "popover", Content },
        },
      });
      pills.set(agentId, { registration, label });
    }
    for (const [agentId, pill] of pills) {
      if (seen.has(agentId)) continue;
      pill.registration.remove();
      pills.delete(agentId);
    }
  };

  const tick = () => {
    sync().catch((error) => {
      if (!stopped) console.error("pad: pill sync failed", error);
    });
  };
  tick();
  const timer = setInterval(tick, POLL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
  };
}
