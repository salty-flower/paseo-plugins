import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { moveToBackground, supportsBackgrounding } from "./client/background";

const title = "Move running shell commands to the background (Ctrl+B)";

export default function contribute(client: PluginClientContext) {
  const pills = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();

  const drop = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };
  // A pill only while a turn runs: that is when a tool call can be waiting.
  const track = (agent: { id: string; workspaceId?: string | null; provider: string; status: string }) => {
    const wanted = agent.status === "running" && !!agent.workspaceId && supportsBackgrounding(agent.provider);
    if (!wanted) return drop(agent.id);
    if (pills.has(agent.id) || lifetime.signal.aborted || !agent.workspaceId) return;
    const agentId = agent.id;
    pills.set(
      agentId,
      client.addComposerPill({
        id: "background",
        workspaceId: agent.workspaceId,
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
  const dropAll = () => {
    for (const id of [...pills.keys()]) drop(id);
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
