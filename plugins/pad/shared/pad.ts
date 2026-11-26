import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Longest section name; a heading, not a sentence. */
export const SECTION_NAME_MAX = 60;
/** Longest spec per section; the daemon caps one RPC value far above this. */
export const SECTION_SPEC_MAX = 24_000;

export const padBindingSchema = z.object({
  workspaceId: z.string().trim().min(1).max(256).optional(),
  ref: z.string().min(1).max(256).optional(),
  label: z.string().trim().min(1).max(256).optional(),
});
export type PadBinding = z.infer<typeof padBindingSchema>;

export const padSectionSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  ui: z.string(),
  updatedAt: z.string(),
  binding: padBindingSchema.optional(),
  userOverride: z.boolean().optional(),
});
export type PadSection = z.infer<typeof padSectionSchema>;

export function sectionId(section: PadSection): string {
  return section.id ?? `name:${section.name}`;
}

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

export const padRemoveSectionRpc = defineRpc({
  name: "pad.remove_section",
  input: z.object({ agentId: z.string().min(1), sectionId: z.string().min(1) }),
  output: z.object({ removed: z.boolean() }),
});

export const padBindRpc = defineRpc({
  name: "pad.bind",
  input: z.object({ agentId: z.string().min(1), sectionId: z.string().min(1), binding: padBindingSchema }),
  output: z.object({ section: padSectionSchema }),
});

const eventTime = z.object({
  at: z.iso.datetime(),
  timeZone: z.string().min(1).max(128),
});
const observation = eventTime.extend({
  agentId: z.string().min(1),
  workspaceId: z.string().nullable(),
  sectionId: z.string().min(1),
});
const viewed = observation.extend({
  type: z.literal("section.viewed"),
  viewing: z.boolean(),
  dwellMs: z.number().int().nonnegative().optional(),
});
const pressed = observation.extend({
  type: z.literal("button.pressed"),
  buttonLabel: z.string().min(1).max(1024),
});
const bound = observation.extend({
  type: z.literal("section.bound"),
  binding: padBindingSchema,
  userOverride: z.boolean(),
  snapshot: z.literal(true).optional(),
});
const removed = observation.extend({ type: z.literal("section.removed") });
const snapshotComplete = eventTime.extend({
  type: z.literal("snapshot.complete"),
  pads: z.array(
    z.discriminatedUnion("complete", [
      z.object({ agentId: z.string().min(1), complete: z.literal(true), workspaceId: z.string().nullable(), sectionIds: z.array(z.string().min(1)) }),
      z.object({ agentId: z.string().min(1), complete: z.literal(false) }),
    ]),
  ),
});

export const padInteractionRpc = defineRpc({
  name: "pad.interaction",
  input: z.discriminatedUnion("type", [viewed, pressed]),
  output: z.object({}),
});
const eventDetails = z.discriminatedUnion("type", [bound, removed, viewed, pressed, snapshotComplete]);
export type PadEventDetails = z.infer<typeof eventDetails>;
export const padEventSchema = eventDetails.and(z.object({ v: z.literal(1), id: z.uuid() }));

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
