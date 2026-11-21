#!/usr/bin/env node
// Applies every daemon patch to a copy of a Paseo app.asar, checks that a
// second run finds them applied, and runs each patch's regression against the
// patched modules under plain Node.
//
//   node scripts/test-daemon-patches.mjs <app.asar>
//
// The archive's app.asar.unpacked sibling, if any, is copied along with it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const root = path.resolve(import.meta.dirname, "..");
const patchesDir = path.join(root, "daemon-patches");
const [source] = process.argv.slice(2);
if (!source) {
  console.error("usage: node scripts/test-daemon-patches.mjs <app.asar>");
  process.exit(2);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-daemon-patches-"));
try {
  const archive = path.join(scratch, "app.asar");
  fs.copyFileSync(source, archive);
  fs.chmodSync(archive, 0o644);
  if (fs.existsSync(`${source}.unpacked`)) fs.cpSync(`${source}.unpacked`, `${archive}.unpacked`, { recursive: true });
  const apply = () => execFileSync(process.execPath, [path.join(patchesDir, "apply.mjs"), archive], { encoding: "utf8" });
  process.stdout.write(apply());
  const again = apply();
  process.stdout.write(again);
  if (again.includes(": applied")) throw new Error("A second run applied a patch again");

  // Copy node_modules out so plain Node can import it. Unpacked members are
  // copied, not linked, because Node resolves a linked module's imports from
  // its real path. Upstream lists unpacked assets it never ships, which
  // extractAll aborts on; nothing a test imports can be one, so they are skipped.
  const tree = path.join(scratch, "tree");
  for (const member of asar.listPackage(archive)) {
    if (!member.startsWith("/node_modules/")) continue;
    const stat = asar.statFile(archive, member.slice(1));
    if (stat.files) continue;
    const target = path.join(tree, member);
    const unpacked = path.join(`${archive}.unpacked`, member);
    if (stat.unpacked && !fs.existsSync(unpacked)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (stat.unpacked) fs.copyFileSync(unpacked, target);
    else fs.writeFileSync(target, asar.extractFile(archive, member.slice(1)));
  }
  const serverDist = path.join(tree, "node_modules/@getpaseo/server/dist/server");
  for (const entry of fs.readdirSync(patchesDir, { withFileTypes: true })) {
    const test = path.join(patchesDir, entry.name, "patch.test.mjs");
    if (!entry.isDirectory() || !fs.existsSync(test)) continue;
    execFileSync(process.execPath, [test, serverDist], { stdio: "inherit" });
  }
} finally {
  // Files copied from a read-only source, such as the Nix store, keep its modes.
  execFileSync("chmod", ["-R", "u+w", scratch]);
  fs.rmSync(scratch, { recursive: true, force: true });
}
