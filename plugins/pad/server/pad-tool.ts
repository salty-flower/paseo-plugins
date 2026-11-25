import { defineAgentTool } from "@getpaseo/plugin/server";
import { z } from "zod";
// genui's own modules, copied into this plugin at build time from the same pin.
import { specProblems } from "../shared/fallback";
import { padBindingSchema, SECTION_NAME_MAX, SECTION_SPEC_MAX } from "../shared/pad";
import { loadAgentFile } from "./data-source";
import { putSection, readPad } from "./pad-store";

// Agents paste the fence out of habit; accept it instead of failing the call.
function stripFence(ui: string): string {
  const match = /^\s*```ui[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(ui);
  return (match?.[1] ?? ui).trim();
}

function summary(names: readonly string[]): string {
  return names.length === 0 ? "The pad is empty." : `Pad sections, top to bottom: ${names.join(" · ")}.`;
}

/**
 * Top-level agents get the tool: the router keeps the pad, and the agents it
 * starts report to the router as before. Paseo records an agent's parent in
 * this label (PARENT_AGENT_ID_LABEL in @getpaseo/protocol).
 *
 * A handoff is the exception. Paseo's paseo-handoff skill creates the new
 * agent with `create_agent`, so it carries the parent label too, yet it takes
 * over the router's job. The skill titles it "[Handoff] <task>". Detaching it
 * later does not help: tools are fixed when the session opens, and Paseo has
 * no hook for a label change.
 */
export function getsPadTool(request: { labels: Readonly<Record<string, string>>; title: string | null }): boolean {
  if (!request.labels["paseo.parent-agent-id"]) return true;
  return request.title?.trimStart().startsWith("[Handoff]") ?? false;
}

export const padTool = defineAgentTool({
  name: "pad",
  title: "Update pad",
  description: [
    "Your pad: a board beside this chat that the user reads instead of scrolling your replies. It persists across turns and restarts.",
    "Each call replaces one named section with a genui ```ui spec (no fence; the `genui` skill has the components). Send only the section that changed; new sections go last.",
    '`ui: ""` deletes the section. Omit `ui` to read the section\'s current spec back.',
    "Optional binding: { workspaceId?, ref?, label? }. Use ref for an external reference. Omission keeps the binding. User overrides take precedence.",
    "Buttons in the pad send you their text prefixed `[pad: <section>]`.",
    "Use it while you coordinate other agents: one section per workstream, plus one for what waits on the user. Once a section says it, keep your chat reply to a line.",
  ].join(" "),
  input: z.object({
    section: z.string().trim().min(1).max(SECTION_NAME_MAX).describe('Section heading, e.g. a workspace name or "Waiting on you"'),
    ui: z.string().max(SECTION_SPEC_MAX).optional().describe("The ```ui spec for this section, without the fence"),
    binding: padBindingSchema.optional(),
  }),
  async execute({ section, ui, binding }, { agent, paseo }) {
    if (ui === undefined) {
      const pad = await readPad(agent.id);
      const found = pad?.sections.find((entry) => entry.name === section);
      const names = pad?.sections.map((entry) => entry.name) ?? [];
      if (!found) return { isError: true, text: `No section "${section}". ${summary(names)}` };
      const metadata = found.binding ? `\nBinding${found.userOverride ? " (user override)" : ""}: ${JSON.stringify(found.binding)}` : "";
      return { text: `${found.ui}\n\n${summary(names)}${metadata}` };
    }
    const spec = stripFence(ui);
    if (spec !== "") {
      const checked = await specProblems(spec, (request) => loadAgentFile(paseo, agent.id, request.path, request));
      if (checked.problems.length > 0) {
        return {
          isError: true,
          text: `Not saved; the pad keeps the previous version. Fix these and call again:\n${checked.problems.join("\n")}`,
        };
      }
    }
    const existed = spec !== "" || ((await readPad(agent.id))?.sections.some((entry) => entry.name === section) ?? false);
    const pad = await putSection(agent.id, agent.workspaceId, section, spec === "" ? null : spec, binding);
    const names = summary(pad?.sections.map((entry) => entry.name) ?? []);
    if (!existed) return { text: `No section "${section}" to delete. ${names}` };
    return { text: `${spec === "" ? "Deleted" : "Saved"} "${section}". ${names}` };
  },
});
