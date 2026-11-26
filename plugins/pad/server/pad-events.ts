import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { type Pad, type PadEventDetails, type PadSection, sectionId } from "../shared/pad";
import type { PadSnapshotRead } from "./pad-store";

export const padRoot = path.join(process.env.PASEO_HOME || path.join(os.homedir(), ".paseo"), "plugin-data", "pad");
const subscribers = new Map<Socket, string[] | null>();
function encode(event: PadEventDetails): string {
  return `${JSON.stringify({ v: 1, id: randomUUID(), ...event })}\n`;
}

function write(socket: Socket, line: string): void {
  if (socket.writableLength > 64 * 1024) socket.destroy();
  else socket.write(line);
}

export function publishPadEvent(event: PadEventDetails): void {
  if (subscribers.size === 0) return;
  const line = encode(event);
  for (const [socket, pending] of subscribers) {
    // Reconnect a stalled reader instead of accumulating an unbounded queue.
    if (!pending) write(socket, line);
    else if (pending.length >= 128) socket.destroy();
    else pending.push(line);
  }
}

function sectionObservation(pad: Pad, section: PadSection, at: string) {
  return {
    at,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    agentId: pad.agentId,
    workspaceId: pad.workspaceId,
    sectionId: sectionId(section),
  };
}

function bindingEvent(pad: Pad, section: PadSection, at: string): Extract<PadEventDetails, { type: "section.bound" }> {
  return {
    ...sectionObservation(pad, section, at),
    type: "section.bound",
    binding: section.binding ?? {},
    userOverride: section.userOverride === true,
  };
}

export function recordBinding(pad: Pad, section: PadSection, at: string): void {
  publishPadEvent(bindingEvent(pad, section, at));
}

export function recordRemoval(pad: Pad, section: PadSection, at: string): void {
  publishPadEvent({ ...sectionObservation(pad, section, at), type: "section.removed" });
}

export function startPadEventStream(readSnapshot: () => Promise<PadSnapshotRead[]>, root = padRoot): () => Promise<void> {
  if (process.platform === "win32") return async () => {};
  const dir = path.join(root, "events");
  const endpoint = path.join(dir, "v1.sock");
  const connections = new Set<Socket>();
  const server = createServer((socket) => {
    const connectedAt = new Date().toISOString();
    const pending: string[] = [];
    connections.add(socket);
    subscribers.set(socket, pending);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      subscribers.delete(socket);
      connections.delete(socket);
    });
    void readSnapshot().then(
      (results) => {
        if (socket.destroyed) return;
        const pads: Extract<PadEventDetails, { type: "snapshot.complete" }>["pads"] = [];
        for (const result of results) {
          if (!("pad" in result)) {
            pads.push({ agentId: result.agentId, complete: false });
            continue;
          }
          const { pad } = result;
          for (const section of pad.sections) {
            if (section.binding || section.userOverride) {
              write(socket, encode({ ...bindingEvent(pad, section, connectedAt), snapshot: true }));
            }
          }
          pads.push({ agentId: pad.agentId, workspaceId: pad.workspaceId, complete: true, sectionIds: pad.sections.map(sectionId) });
        }
        write(socket, encode({ type: "snapshot.complete", at: connectedAt, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, pads }));
        if (socket.destroyed) return;
        subscribers.set(socket, null);
        for (const line of pending) write(socket, line);
      },
      () => socket.destroy(),
    );
  });
  const listen = () =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(endpoint, () => {
        server.off("error", reject);
        resolve();
      });
    });
  const ready = (async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      await listen();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      const refusal = await new Promise<string | undefined>((resolve) => {
        const probe = createConnection(endpoint);
        probe.once("connect", () => {
          probe.destroy();
          resolve(undefined);
        });
        probe.once("error", (failure: NodeJS.ErrnoException) => resolve(failure.code));
      });
      if (refusal !== "ECONNREFUSED") throw error;
      await rm(endpoint, { force: true });
      await listen();
    }
  })().catch((error: unknown) => console.error("Pad event stream could not start", error));
  return async () => {
    await ready;
    if (!server.listening) return;
    for (const socket of connections) {
      subscribers.delete(socket);
      socket.destroy();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}
