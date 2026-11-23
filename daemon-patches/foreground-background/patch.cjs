// Ctrl+B for Paseo: move a turn's running foreground work (Claude Bash and
// subagents, OpenCode blocking tools) to the background, where it keeps
// running and the turn goes on. Paseo has no request for this, so the
// background-shell plugin sends a background-work stop for the reserved item
// `paseo:foreground`, which the patched agent-manager hands to the provider.
//
// Each entry maps a module under @getpaseo/server/dist/server to a function
// from its source to the patched source. A function throws when its anchor no
// longer matches, so a Paseo release that moves the code fails loudly instead
// of shipping half a patch.
const foregroundItem = "paseo:foreground";

function replaceOnce(source, before, after, what) {
  if (source.split(before).length !== 2) {
    throw new Error(`Paseo ${what} patch no longer matches; review upstream before updating`);
  }
  return source.replace(before, after);
}

// The reserved item has no inventory entry or stop token, so it branches off
// before the token check.
function patchManager(original) {
  return replaceOnce(
    original,
    "        const { session } = this.requirePublicAgent(agentId);\n" +
      "        if (!session?.stopBackgroundWork)\n" +
      '            throw new Error("Background work cannot be stopped");\n',
    "        const { session } = this.requirePublicAgent(agentId);\n" +
      `        if (itemId === ${JSON.stringify(foregroundItem)}) {\n` +
      "            if (!session?.backgroundForegroundWork)\n" +
      '                throw new Error("This agent cannot move running work to the background");\n' +
      "            await session.backgroundForegroundWork();\n" +
      "            return;\n" +
      "        }\n" +
      "        if (!session?.stopBackgroundWork)\n" +
      '            throw new Error("Background work cannot be stopped");\n',
    "foreground work manager",
  );
}

// Claude Code's Ctrl+B: every foreground task of the running query.
function patchClaude(original) {
  return replaceOnce(
    original,
    "    async stopBackgroundWork(id) {\n        const query = this.query;\n",
    "    async backgroundForegroundWork() {\n" +
      "        const query = this.query;\n" +
      "        if (!query)\n" +
      '            throw new Error("Claude has no running query");\n' +
      "        await query.backgroundTasks();\n" +
      "    }\n" +
      "    async stopBackgroundWork(id) {\n        const query = this.query;\n",
    "Claude foreground work",
  );
}

// OpenCode v2 moves the session's blocking tools and tells the model itself.
function patchOpenCode(original) {
  return replaceOnce(
    original,
    "    stopBackgroundWork(id) {\n        return this.background.stopItem(id);\n    }\n",
    "    stopBackgroundWork(id) {\n        return this.background.stopItem(id);\n    }\n" +
      "    async backgroundForegroundWork() {\n" +
      "        await this.client.session.background({ sessionID: this.id });\n" +
      "    }\n",
    "OpenCode foreground work",
  );
}

// A provider defined in config gets a session wrapper that forwards a fixed
// list of methods, so the new one has to be on it too.
function patchRegistry(original) {
  return replaceOnce(
    original,
    "        stopBackgroundWork: inner.stopBackgroundWork?.bind(inner),\n",
    "        stopBackgroundWork: inner.stopBackgroundWork?.bind(inner),\n" + "        backgroundForegroundWork: inner.backgroundForegroundWork?.bind(inner),\n",
    "provider wrapper foreground work",
  );
}

module.exports = {
  name: "foreground-background",
  // Present in every patched module and in none upstream, so an applier can
  // tell a patched install from one whose code moved.
  marker: "backgroundForegroundWork",
  files: {
    "server/agent/agent-manager.js": patchManager,
    "server/agent/providers/claude/agent.js": patchClaude,
    "server/agent/providers/opencode/v2/session.js": patchOpenCode,
    "server/agent/provider-registry.js": patchRegistry,
  },
};
