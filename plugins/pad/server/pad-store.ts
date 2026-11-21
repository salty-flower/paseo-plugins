import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Pad, padSchema } from "../shared/pad";

// One JSON file per owner agent, so a daemon restart keeps every pad; plugin
// timeline rows would not survive it.
const root = path.join(process.env.PASEO_HOME || path.join(os.homedir(), ".paseo"), "plugin-data", "pad");

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
  chains.set(
    agentId,
    next.catch(() => undefined),
  );
  return next;
}

/** Replaces one section, or deletes it when `ui` is null; new sections go last. */
export function putSection(agentId: string, workspaceId: string | null, name: string, ui: string | null): Promise<Pad | null> {
  return serialized(agentId, async () => {
    const now = new Date().toISOString();
    const pad = (await readPad(agentId)) ?? { agentId, workspaceId, sections: [], updatedAt: now };
    const index = pad.sections.findIndex((section) => section.name === name);
    if (ui === null) {
      if (index === -1) return pad.sections.length === 0 ? null : pad;
      pad.sections.splice(index, 1);
    } else if (index === -1) {
      pad.sections.push({ name, ui, updatedAt: now });
    } else {
      pad.sections[index] = { name, ui, updatedAt: now };
    }
    pad.workspaceId = workspaceId ?? pad.workspaceId;
    pad.updatedAt = now;
    if (pad.sections.length === 0) {
      await rm(fileOf(agentId), { force: true });
      return null;
    }
    await writePad(pad);
    return pad;
  });
}

export function clearPad(agentId: string): Promise<boolean> {
  return serialized(agentId, async () => {
    const existed = (await readPad(agentId)) !== null;
    await rm(fileOf(agentId), { force: true });
    return existed;
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
