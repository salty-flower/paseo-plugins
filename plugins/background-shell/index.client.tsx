import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { moveToBackground, supportsBackgrounding } from "./client/background";
import { watchForeground } from "./client/foreground";

const title = "Move running shell commands to the background (Ctrl+B)";

export default function contribute(client: PluginClientContext) {
  const pills = new Map<string, PluginButtonRegistration>();
  // A running turn's timeline watcher, per agent.
  const watchers = new Map<string, () => void>();
  const lifetime = new AbortController();

  const hidePill = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };
  const showPill = (agentId: string, workspaceId: string) => {
    if (pills.has(agentId) || lifetime.signal.aborted) return;
    pills.set(
      agentId,
      client.addComposerPill({
        id: "background",
        workspaceId,
        agentId,
        button: {
          title,
          icon: "ArrowDownToLine",
          label: "Background",
          behavior: { kind: "action", onPress: () => moveToBackground(client.paseo, agentId) },
        },
      }),
    );
  };
  const drop = (agentId: string) => {
    watchers.get(agentId)?.();
    watchers.delete(agentId);
    hidePill(agentId);
  };
  // The pill shows only while the turn waits on a shell command or a subagent,
  // which is what there is to move; the timeline says when that starts and ends.
  const track = (agent: { id: string; workspaceId?: string | null; provider: string; status: string }) => {
    const { id: agentId, workspaceId } = agent;
    const wanted = agent.status === "running" && !!workspaceId && supportsBackgrounding(agent.provider);
    if (!wanted || !workspaceId) return drop(agentId);
    if (watchers.has(agentId) || lifetime.signal.aborted) return;
    watchers.set(
      agentId,
      watchForeground(client.paseo, agentId, (waiting) => (waiting ? showPill(agentId, workspaceId) : hidePill(agentId))),
    );
  };
  const dropAll = () => {
    for (const id of [...watchers.keys()]) drop(id);
  };

  // An owned list subscription delivers existing agents, then updates, and a fresh snapshot after a reconnect.
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          dropAll();
          for (const { agent } of entries) track(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") return track(update.agent);
          drop(update.agentId);
        },
      });
      return undefined;
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.error("[background-shell] agent observation failed", error);
    });

  const removers = [
    client.addCommandCenterItem({
      id: "move-to-background",
      title,
      icon: "ArrowDownToLine",
      keywords: ["background", "ctrl+b", "detach", "shell", "bash"],
      context: "agent",
      onSelect: ({ agent, paseo }) => moveToBackground(paseo, agent.id),
    }),
    client.addSlashCommand({
      name: "bg",
      description: title,
      argumentHint: "",
      context: "agent",
      onSubmit: ({ agent, paseo }) => moveToBackground(paseo, agent.id),
    }),
  ];

  return () => {
    lifetime.abort();
    dropAll();
    for (const remove of removers) remove();
  };
}
