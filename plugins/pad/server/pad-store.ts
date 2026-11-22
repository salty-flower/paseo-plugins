import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Pad, type PadBinding, type PadSection, padSchema, sectionId } from "../shared/pad";
import { recordBinding, recordRemoval, padRoot as root } from "./pad-events";

// One JSON file per owner agent, so a daemon restart keeps every pad; plugin
// timeline rows would not survive it.
function fileOf(agentId: string): string {
  // Agent ids are UUIDs; refuse anything that could leave the directory.
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error(`invalid agent id: ${agentId}`);
  return path.join(root, `${agentId}.json`);
}

export async function readPad(agentId: string): Promise<Pad | null> {
  try {
    return padSchema.parse(JSON.parse(await readFile(fileOf(agentId), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writePad(pad: Pad): Promise<void> {
  await mkdir(root, { recursive: true });
  const file = fileOf(pad.agentId);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(pad));
  await rename(temp, file);
}

// Tool calls from one agent can overlap; serialize read-modify-write per agent.
const chains = new Map<string, Promise<unknown>>();
function serialized<T>(agentId: string, work: () => Promise<T>): Promise<T> {
  const next = (chains.get(agentId) ?? Promise.resolve()).then(work, work);
  const settled = next
    .catch(() => undefined)
    .then(() => {
      if (chains.get(agentId) === settled) chains.delete(agentId);
    });
  chains.set(agentId, settled);
  return next;
}

function sameBinding(a: PadBinding | undefined, b: PadBinding | undefined): boolean {
  return (a === undefined) === (b === undefined) && a?.workspaceId === b?.workspaceId && a?.ref === b?.ref && a?.label === b?.label;
}

function bindingChanges(pad: Pad, previous: PadSection | undefined, next: PadSection, now: string, workspaceChanged = false): void {
  if (previous?.userOverride !== next.userOverride || !sameBinding(previous?.binding, next.binding) || (workspaceChanged && (next.binding || next.userOverride))) {
    recordBinding(pad, next, now);
  }
}

/** Replaces one section, or deletes it when `ui` is null; new sections go last. */
export function putSection(agentId: string, workspaceId: string | null, name: string, ui: string | null, binding?: PadBinding): Promise<Pad | null> {
  return serialized(agentId, async () => {
    const now = new Date().toISOString();
    const pad = (await readPad(agentId)) ?? { agentId, workspaceId, sections: [], updatedAt: now };
    const index = pad.sections.findIndex((section) => section.name === name);
    const previous = pad.sections[index];
    const workspaceChanged = workspaceId !== null && workspaceId !== pad.workspaceId;
    let next: PadSection | undefined;
    if (ui === null) {
      if (index === -1) return pad.sections.length === 0 ? null : pad;
      pad.sections.splice(index, 1);
    } else {
      // User overrides stay in effect across agent writes.
      const effective = previous?.userOverride || binding === undefined ? previous?.binding : binding;
      const id = previous ? previous.id : randomUUID();
      next = { id, name, ui, updatedAt: now, binding: effective, userOverride: previous?.userOverride };
      if (index === -1) pad.sections.push(next);
      else pad.sections[index] = next;
    }
    pad.workspaceId = workspaceId ?? pad.workspaceId;
    pad.updatedAt = now;
    if (pad.sections.length === 0) {
      await rm(fileOf(agentId), { force: true });
    } else {
      await writePad(pad);
    }
    if (next) bindingChanges(pad, previous, next, now, workspaceChanged);
    else if (previous) recordRemoval(pad, previous, now);
    if (workspaceChanged) {
      for (const section of pad.sections) {
        if (section !== next && (section.binding || section.userOverride)) recordBinding(pad, section, now);
      }
    }
    return pad.sections.length > 0 ? pad : null;
  });
}

export function overrideBinding(agentId: string, id: string, binding: PadBinding): Promise<PadSection> {
  return serialized(agentId, async () => {
    const pad = await readPad(agentId);
    const index = pad?.sections.findIndex((section) => sectionId(section) === id) ?? -1;
    const previous = pad?.sections[index];
    if (!pad || !previous) throw new Error("This pad section is no longer available.");
    if (previous.userOverride && sameBinding(previous.binding, binding)) return previous;
    const next = { ...previous, binding, userOverride: true };
    const now = new Date().toISOString();
    pad.sections[index] = next;
    await writePad(pad);
    bindingChanges(pad, previous, next, now);
    return next;
  });
}

export function clearPad(agentId: string): Promise<boolean> {
  return serialized(agentId, async () => {
    const pad = await readPad(agentId);
    if (!pad) return false;
    await rm(fileOf(agentId), { force: true });
    const now = new Date().toISOString();
    for (const section of pad.sections) recordRemoval(pad, section, now);
    return true;
  });
}

export async function listPads(): Promise<Pad[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const pads = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readPad(name.slice(0, -".json".length)).catch(() => null)));
  return pads.filter((pad): pad is Pad => pad !== null);
}
