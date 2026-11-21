import { randomBytes } from "node:crypto";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { addJob, type Job, loadJobs, takeJobs } from "./server/later-store";
import { cancelRpc, type JobRow, jobRowKind, listRowKind, listRpc, pendingRpc, scheduleRpc, wakeRpc } from "./shared/later";

type Paseo = PluginHandlerContext["paseo"];

// setTimeout fires at once past 2^31-1 ms (about 24.8 days); longer waits re-arm.
const maxDelay = 2 ** 31 - 1;

export default function contribute(server: PluginServerContext) {
  // Plugin code receives the Paseo API only inside a handler or hook call. A
  // prompt that falls due before the first call after a daemon restart waits
  // here, and the app's wake call on connect delivers it.
  let paseo: Paseo | null = null;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const due = new Set<string>();
  let stopped = false;

  const adopt = (api: Paseo) => {
    if (paseo) return;
    paseo = api;
    for (const id of [...due]) void fire(id);
  };

  const showRow = async (agentId: string, row: JobRow) => {
    try {
      await paseo?.agents.ref(agentId).timeline.append({ type: "plugin", id: row.id, kind: jobRowKind, version: 1, data: row });
    } catch (error) {
      console.error(`[later] timeline row for ${row.id} failed`, error);
    }
  };

  const arm = (job: Job) => {
    clearTimeout(timers.get(job.id));
    const delay = job.at - Date.now();
    if (delay <= 0) {
      timers.delete(job.id);
      void fire(job.id);
      return;
    }
    timers.set(
      job.id,
      setTimeout(() => arm(job), Math.min(delay, maxDelay)),
    );
  };

  async function fire(id: string) {
    if (stopped) return;
    if (!paseo) {
      due.add(id);
      return;
    }
    due.delete(id);
    // Claim before sending: a crash between the two drops the prompt rather
    // than steering the agent twice.
    const [job] = await takeJobs((candidate) => candidate.id === id);
    if (!job) return;
    const row: JobRow = { id: job.id, prompt: job.prompt, at: job.at, status: "sent" };
    try {
      // Steers a running turn; an idle agent starts a turn with it.
      await paseo.agents.ref(job.agentId).send(job.prompt, { activeTurnBehavior: "steer" });
      const late = Date.now() - job.at;
      if (late > 60_000) row.detail = `${Math.round(late / 60_000)} min late: no Paseo call reached the plugin earlier`;
    } catch (error) {
      console.error(`[later] sending ${job.id} to ${job.agentId} failed`, error);
      row.status = "failed";
      row.detail = error instanceof Error ? error.message : String(error);
    }
    await showRow(job.agentId, row);
  }

  server.handle(scheduleRpc, async ({ agentId, workspaceId, at, prompt }, { paseo: api }) => {
    adopt(api);
    const job: Job = { id: `later-${randomBytes(3).toString("hex")}`, agentId, workspaceId, prompt, at, createdAt: Date.now() };
    await addJob(job);
    arm(job);
    await showRow(agentId, { id: job.id, prompt, at, status: "pending" });
    return { id: job.id };
  });

  server.handle(listRpc, async ({ agentId }, { paseo: api }) => {
    adopt(api);
    const jobs = (await loadJobs()).filter((job) => job.agentId === agentId).sort((a, b) => a.at - b.at);
    await api.agents.ref(agentId).timeline.append({
      type: "plugin",
      // A fresh id per call: reusing one would update an older row up the timeline.
      id: `later-list-${Date.now()}`,
      kind: listRowKind,
      version: 1,
      data: { jobs: jobs.map(({ id, prompt, at }) => ({ id, prompt, at })) },
    });
    return { count: jobs.length };
  });

  server.handle(cancelRpc, async ({ agentId, target }, { paseo: api }) => {
    adopt(api);
    const taken = await takeJobs((job) => job.agentId === agentId && (target === "all" || job.id === target));
    for (const job of taken) {
      clearTimeout(timers.get(job.id));
      timers.delete(job.id);
      due.delete(job.id);
      await showRow(agentId, { id: job.id, prompt: job.prompt, at: job.at, status: "cancelled" });
    }
    if (taken.length === 0 && target !== "all") throw new Error(`No pending /later ${target} on this agent`);
    return { cancelled: taken.length };
  });

  server.handle(pendingRpc, async ({ agentId }, { paseo: api }) => {
    adopt(api);
    const jobs = (await loadJobs()).filter((job) => agentId === undefined || job.agentId === agentId).sort((a, b) => a.at - b.at);
    // Jobs from before workspaceId was recorded: ask the daemon once per agent.
    const workspaces = new Map<string, string | null>();
    for (const job of jobs) {
      if (job.workspaceId || workspaces.has(job.agentId)) continue;
      const agent = api.agents.ref(job.agentId);
      await agent.refresh().catch(() => undefined);
      workspaces.set(job.agentId, agent.workspaceId);
    }
    return {
      jobs: jobs.map(({ id, agentId: owner, workspaceId, prompt, at }) => ({
        id,
        agentId: owner,
        workspaceId: workspaceId ?? workspaces.get(owner) ?? null,
        prompt,
        at,
      })),
    };
  });

  server.handle(wakeRpc, async (_input, { paseo: api }) => {
    adopt(api);
    return { pending: timers.size + due.size };
  });

  // Any hook call also carries the API handle.
  server.addHook("agent.turn.before", async (_event, context) => adopt(context.paseo));
  server.addHook("agent.turn.after", async (_event, context) => adopt(context.paseo));
  server.addHook("agent.archive.after", async ({ agent }, context) => {
    adopt(context.paseo);
    for (const job of await takeJobs((candidate) => candidate.agentId === agent.id)) {
      clearTimeout(timers.get(job.id));
      timers.delete(job.id);
      due.delete(job.id);
    }
  });

  void loadJobs().then(
    (jobs) => {
      if (!stopped) for (const job of jobs) arm(job);
    },
    (error) => console.error("[later] reading pending prompts failed", error),
  );

  return () => {
    stopped = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
