// A background-work stop for `paseo:foreground` moves a turn's running
// foreground work to the background instead of stopping anything.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Takes the patched @getpaseo/server/dist/server directory, as plain files.
const [serverDist] = process.argv.slice(2);
const agentDir = path.join(serverDist, "server/agent");
const claudeAgent = path.join(agentDir, "providers/claude/agent.js");
const openCodeSession = path.join(agentDir, "providers/opencode/v2/session.js");
const agentManager = path.join(agentDir, "agent-manager.js");
const providerRegistry = path.join(agentDir, "provider-registry.js");
const { ClaudeAgentClient } = await import(pathToFileURL(claudeAgent).href);
const { OpenCodeV2Session } = await import(pathToFileURL(openCodeSession).href);
const { AgentManager } = await import(pathToFileURL(agentManager).href);
const { wrapSessionProvider } = await import(pathToFileURL(providerRegistry).href);
const logger = new Proxy({}, { get: (_, key) => (key === "child" ? () => logger : () => {}) });

// A provider defined in config wraps its sessions; the wrapper must forward the method.
const inner = {
  backgroundForegroundWork() {
    return this;
  },
};
const wrapped = wrapSessionProvider("claude-custom", inner);
assert.equal(typeof wrapped.backgroundForegroundWork, "function", "config-defined providers must keep backgroundForegroundWork");
assert.equal(wrapped.backgroundForegroundWork(), inner, "the wrapper must call the inner session");

// agent-manager routes the reserved item to the provider, before the inventory check.
const calls = [];
const managerThis = (session) => ({
  requirePublicAgent: () => ({ session }),
  sessionEventTails: new Map(),
  backgroundWork: { list: () => [] },
});
const stop = (session, itemId) => AgentManager.prototype.stopAgentBackgroundWork.call(managerThis(session), { agentId: "a", itemId, stopToken: "x" });
await stop({ stopBackgroundWork: () => calls.push("stop"), backgroundForegroundWork: async () => calls.push("foreground") }, "paseo:foreground");
assert.deepEqual(calls, ["foreground"], "the reserved item must reach backgroundForegroundWork, not stopBackgroundWork");
await assert.rejects(stop({ stopBackgroundWork: () => calls.push("stop") }, "paseo:foreground"), /cannot move running work/);
await assert.rejects(stop({ stopBackgroundWork: () => calls.push("stop") }, "shell-1"), /no longer available/, "other items keep the inventory check");
assert.deepEqual(calls, ["foreground"]);

// Claude: Ctrl+B semantics, every foreground task of the running query.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-foreground-"));
const oldConfig = process.env.CLAUDE_CONFIG_DIR;
let claude;
try {
  process.env.CLAUDE_CONFIG_DIR = root;
  const client = new ClaudeAgentClient({ logger, resolveBinary: async () => "/unused/claude" });
  claude = await client.resumeSession({
    provider: "claude",
    sessionId: "9b2f3a3e-1c55-4a8e-9d0e-2f1f5d6c7a10",
    metadata: { cwd: fs.realpathSync(root) },
  });
  const backgrounded = [];
  const realQuery = claude.query;
  claude.query = { backgroundTasks: async (...args) => backgrounded.push(args) };
  await claude.backgroundForegroundWork();
  assert.deepEqual(backgrounded, [[]], "Claude must background every foreground task, like Ctrl+B");
  claude.query = null;
  await assert.rejects(claude.backgroundForegroundWork(), /no running query/);
  claude.query = realQuery;
} finally {
  if (oldConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = oldConfig;
  await claude?.close();
  fs.rmSync(root, { recursive: true, force: true });
}

// OpenCode v2: the session's background endpoint.
const requests = [];
const openCode = Object.create(OpenCodeV2Session.prototype, {
  connection: { value: { client: { session: { background: async (input) => requests.push(input) } } } },
  info: { value: { id: "ses_1" } },
});
await openCode.backgroundForegroundWork();
assert.deepEqual(requests, [{ sessionID: "ses_1" }]);

console.log("Paseo foreground-to-background regression passed");
