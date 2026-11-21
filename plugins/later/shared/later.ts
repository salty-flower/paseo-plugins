import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const usage = "Usage: /later 10m <prompt> | /later [YYYY-MM-DD] HH:mm[:ss] <prompt> | /later list | /later cancel <id|all>";

export type LaterCommand = { kind: "list" } | { kind: "cancel"; target: string } | { kind: "schedule"; at: number; prompt: string } | { kind: "error"; message: string };

const units: Record<string, number> = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 };
// Date's own limit; a later time is not a time.
const maxTime = 8.64e15;

/**
 * Parses what follows `/later`, in the local time zone of the device it runs on,
 * so a wall-clock time means the clock the user is looking at.
 */
export function parseLater(args: string, now: number): LaterCommand {
  const text = args.trim();
  if (text === "list") return { kind: "list" };
  const cancel = /^cancel\s+(\S+)$/.exec(text);
  if (cancel) return { kind: "cancel", target: cancel[1] };

  const relative = /^(\d+)\s*([smhd])\s+([\s\S]+)$/i.exec(text);
  if (relative) {
    const at = now + Number(relative[1]) * units[relative[2].toLowerCase()];
    return schedule(at, relative[3], now);
  }

  const absolute = /^(?:(\d{4})-(\d{2})-(\d{2})\s+)?(\d{2}):(\d{2})(?::(\d{2}))?\s+([\s\S]+)$/.exec(text);
  if (absolute) {
    const [, year, month, day, hour, minute, second = "0", prompt] = absolute;
    const base = new Date(now);
    const wall = {
      year: year === undefined ? base.getFullYear() : Number(year),
      month: month === undefined ? base.getMonth() + 1 : Number(month),
      day: day === undefined ? base.getDate() : Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    };
    let at = wallClock(wall);
    // A bare time already past means tomorrow's.
    if (year === undefined && (at === null || at <= now)) {
      const tomorrow = new Date(wall.year, wall.month - 1, wall.day + 1);
      at = wallClock({
        ...wall,
        year: tomorrow.getFullYear(),
        month: tomorrow.getMonth() + 1,
        day: tomorrow.getDate(),
      });
    }
    if (at === null) return { kind: "error", message: `No such local time. ${usage}` };
    return schedule(at, prompt, now);
  }

  return { kind: "error", message: usage };
}

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** The instant of a local wall-clock time, or null for an impossible date or a time a DST jump skips. */
function wallClock(wall: Wall): number | null {
  const date = new Date(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, 0);
  const exact =
    date.getFullYear() === wall.year &&
    date.getMonth() === wall.month - 1 &&
    date.getDate() === wall.day &&
    date.getHours() === wall.hour &&
    date.getMinutes() === wall.minute &&
    date.getSeconds() === wall.second;
  return exact ? date.getTime() : null;
}

function schedule(at: number, prompt: string, now: number): LaterCommand {
  const text = prompt.trim();
  if (!text || !Number.isFinite(at) || at > maxTime) return { kind: "error", message: usage };
  if (at <= now) return { kind: "error", message: `That time has passed. ${usage}` };
  return { kind: "schedule", at, prompt: text };
}

export const scheduleRpc = defineRpc({
  name: "later.schedule",
  input: z.object({ agentId: z.string(), workspaceId: z.string().optional(), at: z.number(), prompt: z.string().min(1) }),
  output: z.object({ id: z.string() }),
});

export const pendingJobSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  workspaceId: z.string().nullable(),
  prompt: z.string(),
  at: z.number(),
});
export type PendingJob = z.output<typeof pendingJobSchema>;

/** Pending prompts, soonest first: every agent's, or one agent's. */
export const pendingRpc = defineRpc({
  name: "later.pending",
  input: z.object({ agentId: z.string().optional() }),
  output: z.object({ jobs: z.array(pendingJobSchema) }),
});

export const listRpc = defineRpc({
  name: "later.list",
  input: z.object({ agentId: z.string() }),
  output: z.object({ count: z.number() }),
});

export const cancelRpc = defineRpc({
  name: "later.cancel",
  input: z.object({ agentId: z.string(), target: z.string() }),
  output: z.object({ cancelled: z.number() }),
});

/** Hands the daemon side a Paseo API handle, which plugin code only gets inside a call. */
export const wakeRpc = defineRpc({
  name: "later.wake",
  input: z.object({}),
  output: z.object({ pending: z.number() }),
});

export const jobRowKind = "later-job";
export const jobRowSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  at: z.number(),
  status: z.enum(["pending", "sent", "cancelled", "failed"]),
  detail: z.string().optional(),
});
export type JobRow = z.output<typeof jobRowSchema>;

export const listRowKind = "later-list";
export const listRowSchema = z.object({
  jobs: z.array(z.object({ id: z.string(), prompt: z.string(), at: z.number() })),
});
