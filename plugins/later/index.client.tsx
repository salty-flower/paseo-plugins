import type { PluginClientContext } from "@getpaseo/plugin/client";
import { registerLaterPills } from "./client/later-pills";
import { LaterPopover } from "./client/later-popover";
import { JobRowView, ListRowView } from "./client/later-rows";
import { cancelRpc, jobRowKind, jobRowSchema, listRowKind, listRowSchema, listRpc, parseLater, scheduleRpc, wakeRpc } from "./shared/later";

export default function contribute(client: PluginClientContext) {
  const pills = registerLaterPills(client, (props) => <LaterPopover {...props} onChanged={() => pills.sync()} />);
  const removers = [
    client.addSlashCommand({
      name: "later",
      description: "Send a prompt to this agent later, steering it if busy",
      argumentHint: "10m | [YYYY-MM-DD] HH:mm[:ss] <prompt> | list | cancel <id|all>",
      context: "agent",
      async onSubmit({ args, agent, rpc }) {
        try {
          await run(args, agent, rpc);
        } finally {
          pills.sync();
        }
      },
    }),
    client.addTimelineRenderer({ kind: jobRowKind, version: 1, schema: jobRowSchema, Component: JobRowView }),
    client.addTimelineRenderer({ kind: listRowKind, version: 1, schema: listRowSchema, Component: ListRowView }),
  ];

  // Prompts that fell due while the daemon side had no API handle go out now.
  // Deferred past setup: a throw inside setup would discard every registration above.
  const wake = setTimeout(() => {
    try {
      void client.rpc(wakeRpc, {}).catch((error: unknown) => console.warn("[later] wake failed", error));
    } catch (error) {
      console.warn("[later] wake failed", error);
    }
  }, 0);

  return () => {
    clearTimeout(wake);
    pills.dispose();
    for (const remove of removers) remove();
  };
}

async function run(args: string, agent: { id: string; workspaceId: string }, rpc: PluginClientContext["rpc"]) {
  // Parsed here, so a wall-clock time is this device's local time.
  const command = parseLater(args, Date.now());
  switch (command.kind) {
    case "error":
      throw new Error(command.message);
    case "list":
      await rpc(listRpc, { agentId: agent.id });
      return;
    case "cancel":
      await rpc(cancelRpc, { agentId: agent.id, target: command.target });
      return;
    case "schedule":
      await rpc(scheduleRpc, { agentId: agent.id, workspaceId: agent.workspaceId, at: command.at, prompt: command.prompt });
      return;
  }
}
