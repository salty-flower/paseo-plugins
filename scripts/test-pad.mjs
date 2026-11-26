import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { sharePadDwell, trackDwell } from "../plugins/pad/client/pad-dwell.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "paseo-pad-test-"));
process.env.PASEO_HOME = root;
after(() => rm(root, { recursive: true, force: true }));

// Paseo's bundler resolves the extensionless TypeScript imports in a plugin.
// Node's test runner needs the same resolution for these plain .ts modules.
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.includes("/plugins/pad/") && specifier.startsWith(".") && !path.extname(specifier)) {
      try {
        return next(`${specifier}.ts`, context);
      } catch (error) {
        if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
        return next(`${specifier}/index.ts`, context);
      }
    }
    return next(specifier, context);
  },
});
const { padEventSchema, padInteractionRpc, sectionId } = await import("../plugins/pad/shared/pad.ts");
const { clearPad, overrideBinding, putSection, readPad, readPadSnapshot, removeSection } = await import("../plugins/pad/server/pad-store.ts");
const { padRoot, publishPadEvent, startPadEventStream } = await import("../plugins/pad/server/pad-events.ts");
const { getsPadTool, padTool } = await import("../plugins/pad/server/pad-tool.ts");
const { padButtonLabels } = await import("../plugins/pad/client/pad-button-labels.ts");
const { decisionMessage, readDecision } = await import("../plugins/pad/shared/core/decisions.ts");
const { fixAllMessage, fixThisMessage, readFindings } = await import("../plugins/pad/shared/core/findings.ts");
const { parseListRows } = await import("../plugins/pad/shared/logic/explain-logic.ts");
hook.deregister();

const routerBinding = { workspaceId: "workspace-a", ref: " issues:OPS-42 ", label: "Original" };
const userBinding = { ...routerBinding, workspaceId: "workspace-b", label: "Corrected" };

test("built-in action IDs use the pressed button's label", () => {
  const send = (text) => [{ kind: "action", type: "send", text }];
  const prompts = padButtonLabels("FollowUps", { prompts: ["Review tests", "Review docs"] });
  assert.equal(prompts.buttonId(send("Review tests")), "Review tests");
  assert.equal(prompts.buttonId(send("Review docs")), "Review docs");
  assert.equal(padButtonLabels("Plan", { submit: "Start rollout" }).buttonId(send("Approve steps 1–3")), "Start rollout");
  assert.equal(padButtonLabels("Plan", {}).buttonId(send("Approve steps 1–3")), "Approve plan");
  assert.equal(padButtonLabels("Form", { submit: "Save answers" }).buttonId(send("Private answer")), "Save answers");
  assert.equal(padButtonLabels("Other", { label: "Something else" }).buttonId(send("Private reply")), "Send");
  assert.equal(padButtonLabels("Button", {}).buttonId(send("Unlabeled action")), "Button");
  assert.equal(padButtonLabels("Button", { label: "Retry" }).buttonId(send("Detailed instructions")), "Retry");

  const options = [
    { name: "Local", scores: [4] },
    { name: "Remote", scores: [3] },
  ];
  const criteria = ["Speed"];
  const { model } = readDecision(options, criteria);
  const decision = padButtonLabels("Decision", { options, criteria });
  assert.equal(decision.buttonId(send(decisionMessage(model, 0, [1]))), "Go with Local");
  assert.equal(decision.buttonId(send(decisionMessage(model, 1, [2]))), "Go with Remote");

  const items = [
    { severity: "high", title: "First issue" },
    { severity: "low", title: "Second issue" },
  ];
  const { report } = readFindings(items);
  const findings = padButtonLabels("Findings", { items });
  assert.equal(findings.buttonId(send(fixAllMessage(report.findings, report.scale))), "Fix all");
  assert.equal(findings.buttonId(send(fixThisMessage(report.findings[0]))), "Fix this");
});

test("List reports each row's label even when rows reuse the same action", () => {
  const action = { kind: "action", type: "send", text: "Continue" };
  const items = [
    { title: "First row", action },
    { label: "Second row", action: [action] },
  ];
  const list = padButtonLabels("List", { items });
  const rows = parseListRows(list.props.items);
  assert.deepEqual(list.props.items, items);
  assert.notEqual(rows[0].actions[0], rows[1].actions[0]);
  assert.deepEqual(
    rows.map((row) => list.buttonId(row.actions)),
    ["First row", "Second row"],
  );
});

test("the router tool accepts both write forms and returns the effective binding on read", async () => {
  const context = { agent: { id: "tool", workspaceId: "router" } };
  const call = (input) => padTool.execute(padTool.input.parse({ section: "Workstream", ...input }), context);
  const section = 'root = Text("Working")';
  assert.match((await call({ ui: section })).text, /^Saved/);
  assert.match((await call({ ui: section, binding: routerBinding })).text, /^Saved/);
  const { sections } = await readPad("tool");
  await overrideBinding("tool", sectionId(sections[0]), userBinding);
  const read = await call({});
  assert.ok(read.text.startsWith(section));
  assert.ok(read.text.includes(`Binding (user override): ${JSON.stringify(userBinding)}`));
});

test("legacy pad sections survive binding-free writes and keep their identity", async () => {
  const section = { name: "Workstream", ui: 'root = Text("old")', updatedAt: "2026-11-01T00:00:00.000Z" };
  await mkdir(padRoot, { recursive: true });
  await writeFile(path.join(padRoot, "legacy.json"), JSON.stringify({ agentId: "legacy", workspaceId: "router", sections: [section], updatedAt: section.updatedAt }));
  const before = (await readPad("legacy")).sections[0];
  const { sections } = await putSection("legacy", "router", section.name, 'root = Text("new")');
  assert.equal(sectionId(sections[0]), sectionId(before));
  assert.equal(sections[0].ui, 'root = Text("new")');
  assert.equal(sections[0].binding, undefined);
});

test("corrections survive concurrent writes, matches, and reads from disk", async () => {
  const { sections } = await putSection("sticky", "router", "Workstream", "before", routerBinding);
  const originalId = sectionId(sections[0]);
  await putSection("sticky", "router", "Workstream", "two-argument write");
  assert.deepEqual((await readPad("sticky")).sections[0].binding, routerBinding);
  await Promise.all([overrideBinding("sticky", originalId, userBinding), putSection("sticky", "router", "Workstream", "concurrent", routerBinding)]);
  await putSection("sticky", "router", "Workstream", "acknowledged", userBinding);
  await putSection("sticky", "router", "Workstream", "conflict", routerBinding);
  const persisted = (await readPad("sticky")).sections[0];
  assert.deepEqual(persisted.binding, userBinding);
  assert.equal(persisted.userOverride, true);
  assert.equal(persisted.ui, "conflict");
  assert.equal(sectionId(persisted), originalId);

  const partial = await overrideBinding("sticky", originalId, { label: "Unassigned" });
  assert.equal(sectionId(partial), originalId);
  await putSection("sticky", "router", "Workstream", null);
  const recreated = (await putSection("sticky", "router", "Workstream", "recreated", routerBinding)).sections[0];
  assert.notEqual(sectionId(recreated), originalId);
  await assert.rejects(overrideBinding("sticky", originalId, userBinding), /no longer available/);
  assert.deepEqual(recreated.binding, routerBinding);
  assert.equal(recreated.userOverride, undefined);
});

test("a subscriber receives snapshot bindings, pad coverage, then live events", { skip: process.platform === "win32", timeout: 5000 }, async (t) => {
  const { sections } = await putSection("stream", "router", "Workstream", "content", routerBinding);
  const id = sectionId(sections[0]);
  const unbound = await putSection("stream", "router", "Unbound", "content");
  const unboundId = sectionId(unbound.sections[1]);
  const corrupt = path.join(padRoot, "unreadable.json");
  await writeFile(corrupt, "{broken JSON");
  t.after(() => rm(corrupt));
  const deleted = await putSection("deleted", "router", "Gone", "content", routerBinding);
  assert.equal(await removeSection("deleted", sectionId(deleted.sections[0])), true);

  const scanFinished = Promise.withResolvers();
  const sendSnapshot = Promise.withResolvers();
  const stop = startPadEventStream(async () => {
    const results = await readPadSnapshot();
    scanFinished.resolve();
    await sendSnapshot.promise;
    return results;
  });
  t.after(stop);
  const endpoint = path.join(padRoot, "events", "v1.sock");
  const socket = await connect(endpoint);
  t.after(() => socket.destroy());
  const lines = createInterface({ input: socket })[Symbol.asyncIterator]();
  const nextWireEvent = async () => JSON.parse((await lines.next()).value);
  const next = async () => padEventSchema.parse(await nextWireEvent());
  await scanFinished.promise;
  await overrideBinding("stream", id, userBinding);
  sendSnapshot.resolve();

  const bindings = [];
  let complete = await next();
  while (complete.type === "section.bound") {
    assert.equal(complete.snapshot, true);
    bindings.push(complete);
    complete = await next();
  }
  const streamBindings = bindings.filter((event) => event.agentId === "stream");
  assert.equal(streamBindings.length, 1);
  const [snapshot] = streamBindings;
  assert.equal(snapshot.snapshot, true);
  assert.equal(snapshot.v, 1);
  assert.equal(snapshot.type, "section.bound");
  assert.equal(snapshot.agentId, "stream");
  assert.equal(snapshot.sectionId, id);
  assert.equal(snapshot.workspaceId, "router");
  assert.deepEqual(snapshot.binding, routerBinding);
  assert.equal(snapshot.userOverride, false);
  assert.equal(complete.type, "snapshot.complete");
  assert.equal(complete.at, snapshot.at);
  const covered = new Map(complete.pads.map((pad) => [pad.agentId, pad]));
  assert.deepEqual(covered.get("stream"), { agentId: "stream", workspaceId: "router", complete: true, sectionIds: [id, unboundId] });
  assert.deepEqual(covered.get("unreadable"), { agentId: "unreadable", complete: false });
  assert.equal(covered.has("deleted"), false);
  assert.equal(
    bindings.some((event) => event.agentId === "unreadable" || event.agentId === "deleted"),
    false,
  );

  await putSection("stream", "router", "Workstream", "same binding", userBinding);
  await putSection("stream", "router", "Workstream", "conflict", routerBinding);
  const corrected = await next();
  assert.equal(corrected.type, "section.bound");
  assert.equal(corrected.snapshot, undefined);
  assert.deepEqual(corrected.binding, userBinding);
  assert.equal(corrected.userOverride, true);

  const second = await putSection("stream", "router", "Other workstream", "content", routerBinding);
  const otherId = sectionId(second.sections[2]);
  assert.equal((await next()).sectionId, otherId);
  await putSection("stream", "new-router", "Workstream", "content after move");
  const moved = [await next(), await next()];
  assert.deepEqual(
    moved.map((event) => [event.type, event.sectionId, event.workspaceId, event.binding, event.userOverride]),
    [
      ["section.bound", id, "new-router", userBinding, true],
      ["section.bound", otherId, "new-router", routerBinding, false],
    ],
  );
  await putSection("stream", "new-router", "Other workstream", "unchanged binding");

  const context = { agentId: "stream", workspaceId: "new-router", sectionId: id, at: "2026-11-01T12:00:00.000Z", timeZone: "UTC" };
  const activity = [
    { ...context, type: "section.viewed", viewing: true },
    { ...context, type: "button.pressed", buttonLabel: "Continue" },
    { ...context, type: "section.viewed", viewing: false, dwellMs: 1250 },
  ];
  for (const event of activity) publishPadEvent(padInteractionRpc.input.parse(event));
  for (const event of activity) {
    const { id: eventId, v, ...received } = await next();
    assert.equal(v, 1);
    assert.match(eventId, /^[0-9a-f-]+$/);
    assert.deepEqual(received, event);
  }
  await overrideBinding("stream", id, {});
  const clearedBinding = await next();
  assert.equal(clearedBinding.type, "section.bound");
  assert.equal(clearedBinding.sectionId, id);
  assert.deepEqual(clearedBinding.binding, {});
  assert.equal(clearedBinding.userOverride, true);

  const assertRemoval = async (sectionId) => {
    const raw = await nextWireEvent();
    assert.deepEqual(padEventSchema.parse(raw), raw);
    const { v, id: eventId, at, timeZone, ...removed } = raw;
    assert.equal(v, 1);
    assert.match(eventId, /^[0-9a-f-]+$/);
    assert.ok(at && timeZone);
    assert.deepEqual(removed, { type: "section.removed", agentId: "stream", workspaceId: "new-router", sectionId });
  };
  const toolInput = padTool.input.parse({ section: "Other workstream", ui: "" });
  const toolResult = await padTool.execute(toolInput, { agent: { id: "stream", workspaceId: "new-router" } });
  assert.match(toolResult.text, /^Deleted/);
  await assertRemoval(otherId);
  assert.equal(await removeSection("stream", id), true);
  await assertRemoval(id);
  assert.equal(await removeSection("stream", id), false);
  const extra = await putSection("stream", "new-router", "Another unbound section", "content");
  await clearPad("stream");
  await assertRemoval(unboundId);
  await assertRemoval(sectionId(extra.sections[1]));
});

test("empty and failed pad scans produce different socket results", { skip: process.platform === "win32", timeout: 5000 }, async (t) => {
  const emptyRoot = path.join(root, "empty-scan");
  const failedRoot = path.join(root, "failed-scan");
  const stopEmpty = startPadEventStream(async () => [], emptyRoot);
  const stopFailed = startPadEventStream(async () => {
    throw new Error("Cannot enumerate pads");
  }, failedRoot);
  t.after(stopEmpty);
  t.after(stopFailed);

  const emptySocket = await connect(path.join(emptyRoot, "events", "v1.sock"));
  t.after(() => emptySocket.destroy());
  const emptyLines = createInterface({ input: emptySocket })[Symbol.asyncIterator]();
  const complete = padEventSchema.parse(JSON.parse((await emptyLines.next()).value));
  assert.equal(complete.type, "snapshot.complete");
  assert.deepEqual(complete.pads, []);

  const failedSocket = await connect(path.join(failedRoot, "events", "v1.sock"));
  t.after(() => failedSocket.destroy());
  const failedLines = createInterface({ input: failedSocket })[Symbol.asyncIterator]();
  assert.equal((await failedLines.next()).done, true);
});

async function connect(endpoint) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = createConnection(endpoint, () => {
          socket.off("error", reject);
          resolve(socket);
        });
        socket.once("error", reject);
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await sleep(10);
    }
  }
  throw new Error("Pad event socket did not start");
}

test("dwell requires continuous visible time and emits a single matched end", async () => {
  let visible = true;
  const edges = [];
  const dwell = trackDwell(
    (viewing) => edges.push(viewing),
    () => visible,
  );
  dwell(true);
  dwell(false);
  dwell(true);
  visible = false;
  await sleep(550);
  assert.deepEqual(edges, []);

  visible = true;
  dwell(true);
  dwell(true);
  await sleep(550);
  assert.deepEqual(edges, [true]);
  visible = false;
  dwell(false);
  dwell(false);
  assert.deepEqual(edges, [true, false]);
});

test("overlapping surfaces emit one dwell for the same section", async () => {
  const edges = [];
  const report = (viewing, dwellMs) => edges.push({ viewing, dwellMs });
  const panel = sharePadDwell("workstream", report);
  const popover = sharePadDwell("workstream", report);
  panel(true);
  popover(true);
  panel(false);
  assert.deepEqual(edges, [{ viewing: true, dwellMs: undefined }]);
  await sleep(10);
  popover(false);
  assert.equal(edges[1].viewing, false);
  assert.ok(edges[1].dwellMs > 0);
});

test("top-level agents and handoffs get the pad tool, other delegated agents do not", () => {
  const child = { "paseo.parent-agent-id": "router" };
  assert.equal(getsPadTool({ labels: {}, title: null }), true);
  assert.equal(getsPadTool({ labels: child, title: "Fix the flaky test" }), false);
  assert.equal(getsPadTool({ labels: child, title: null }), false);
  assert.equal(getsPadTool({ labels: child, title: "[Handoff] Ship the release" }), true);
});

test("a section is removed by id and never takes a recreated namesake with it", async () => {
  await putSection("remove", "router", "Keep", 'root = Text("keep")');
  const { sections } = await putSection("remove", "router", "Done", 'root = Text("done")');
  const doneId = sectionId(sections[1]);
  assert.equal(await removeSection("remove", doneId), true);
  assert.deepEqual(
    (await readPad("remove")).sections.map((section) => section.name),
    ["Keep"],
  );
  assert.equal(await removeSection("remove", doneId), false);

  await putSection("remove", "router", "Done", 'root = Text("again")');
  assert.equal(await removeSection("remove", doneId), false);
  assert.equal((await readPad("remove")).sections.length, 2);

  for (const section of (await readPad("remove")).sections) await removeSection("remove", sectionId(section));
  assert.equal(await readPad("remove"), null);
});
