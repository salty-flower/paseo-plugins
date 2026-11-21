import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const jobSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  // The composer pill needs it; jobs scheduled before it was recorded lack it.
  workspaceId: z.string().nullish(),
  prompt: z.string(),
  at: z.number(),
  createdAt: z.number(),
});
export type Job = z.output<typeof jobSchema>;

const fileSchema = z.object({ version: z.literal(1), jobs: z.array(jobSchema) });

// One file for every pending prompt, so a daemon restart keeps them.
const root = path.join(process.env.PASEO_HOME || path.join(os.homedir(), ".paseo"), "plugin-data", "later");
const file = path.join(root, "jobs.json");

async function read(): Promise<Job[]> {
  try {
    return fileSchema.parse(JSON.parse(await readFile(file, "utf8"))).jobs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function write(jobs: Job[]): Promise<void> {
  await mkdir(root, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify({ version: 1, jobs }));
  await rename(temp, file);
}

// Scheduling, firing and cancelling overlap; serialize every read-modify-write.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

export function loadJobs(): Promise<Job[]> {
  return serialized(read);
}

export function addJob(job: Job): Promise<void> {
  return serialized(async () => write([...(await read()), job]));
}

/** Removes the jobs `pick` selects and returns them; a job is claimed by whoever removes it. */
export function takeJobs(pick: (job: Job) => boolean): Promise<Job[]> {
  return serialized(async () => {
    const jobs = await read();
    const taken = jobs.filter(pick);
    if (taken.length > 0) await write(jobs.filter((job) => !pick(job)));
    return taken;
  });
}
