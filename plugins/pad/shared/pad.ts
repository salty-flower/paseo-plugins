import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Longest section name; a heading, not a sentence. */
export const SECTION_NAME_MAX = 60;
/** Longest spec per section; the daemon caps one RPC value far above this. */
export const SECTION_SPEC_MAX = 24_000;

export const padSectionSchema = z.object({
  name: z.string(),
  ui: z.string(),
  updatedAt: z.string(),
});
export type PadSection = z.infer<typeof padSectionSchema>;

export const padSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string().nullable(),
  sections: z.array(padSectionSchema),
  updatedAt: z.string(),
});
export type Pad = z.infer<typeof padSchema>;

/** Every pad whose owner runs in this workspace, oldest owner first. */
export const padsInWorkspaceRpc = defineRpc({
  name: "pad.in_workspace",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.object({ pads: z.array(padSchema) }),
});

/** Agents with a pad, for the composer pills. */
export const padListRpc = defineRpc({
  name: "pad.list",
  input: z.object({}),
  output: z.object({
    pads: z.array(
      z.object({
        agentId: z.string(),
        workspaceId: z.string().nullable(),
        sections: z.number(),
        updatedAt: z.string(),
      }),
    ),
  }),
});

export const padClearRpc = defineRpc({
  name: "pad.clear",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ cleared: z.boolean() }),
});

/** What a pad button sends, so the agent knows the click came from its pad. */
export function padReply(section: string, text: string): string {
  return `[pad: ${section}] ${text}`;
}

/** "3m ago" style age; the pill and the panel header share it. */
export function age(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
