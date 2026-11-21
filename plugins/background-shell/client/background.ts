import type { PluginClientContext } from "@getpaseo/plugin/client";

type Paseo = PluginClientContext["paseo"];
type Item = Parameters<ReturnType<Paseo["agents"]["ref"]>["backgroundWork"]["stop"]>[0];

// The patched daemon reads a stop of this reserved item as "move the running
// foreground work to the background" (packages/paseo/patch-archive.cjs).
const foregroundItem: Item = {
  id: "paseo:foreground",
  kind: "foreground",
  description: null,
  startedAt: new Date(0).toISOString(),
  canStop: true,
  stopToken: "paseo:foreground",
};

/** Providers whose daemon session implements it: Claude Code and OpenCode v2, with their variants. */
export function supportsBackgrounding(provider: string): boolean {
  return /^(claude|opencode)(-|$)/.test(provider);
}

export async function moveToBackground(paseo: Paseo, agentId: string): Promise<void> {
  await paseo.agents.ref(agentId).backgroundWork.stop(foregroundItem);
}
