#!/usr/bin/env node
// Applies the daemon patches in this directory to an installed Paseo.
//
//   node daemon-patches/apply.mjs <target> [patch ...]
//
// <target> is one of
//   - Paseo.app (macOS): patches Contents/Resources/app.asar and the ASAR
//     integrity hash in Info.plist; re-sign the app afterwards;
//   - an app.asar, such as resources/app.asar of an extracted Linux AppImage;
//   - a directory whose node_modules/@getpaseo/server holds plain files, such
//     as a global npm install of @getpaseo/cli; the files are patched in place.
// [patch ...] names subdirectories of daemon-patches/; all of them by default.
// Run `npm ci` in the repository first: ASAR targets need @electron/asar.
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { finished } from "node:stream/promises";

const require = createRequire(import.meta.url);
const here = import.meta.dirname;
// The modules each patch.cjs names live under this prefix in the app archive.
const serverDist = "node_modules/@getpaseo/server/dist/server";

const [target, ...names] = process.argv.slice(2);
if (!target) {
  console.error("usage: node daemon-patches/apply.mjs <Paseo.app | app.asar | directory> [patch ...]");
  process.exit(2);
}
const available = fs.readdirSync(here, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(here, entry.name, "patch.cjs")));
const selected = names.length ? names : available.map((entry) => entry.name);
const patches = selected.map((name) => require(path.join(here, name, "patch.cjs")));

// Module path (relative to the archive or directory root) → patched source,
// or null when the module already carries every patch.
function patchSources(read) {
  const out = new Map();
  for (const patch of patches) {
    const members = Object.entries(patch.files).map(([file, apply]) => [`${serverDist}/${file}`, apply]);
    const done = members.filter(([member]) => (out.get(member) ?? read(member)).includes(patch.marker));
    if (done.length === members.length) {
      console.log(`${patch.name}: already applied`);
      continue;
    }
    if (done.length > 0) throw new Error(`${patch.name}: only partly applied (${done.map(([m]) => m).join(", ")}); reinstall Paseo first`);
    for (const [member, apply] of members) out.set(member, apply(out.get(member) ?? read(member)));
    console.log(`${patch.name}: applied`);
  }
  return out;
}

function patchDirectory(root) {
  if (!fs.existsSync(path.join(root, serverDist))) throw new Error(`No ${serverDist} under ${root}`);
  for (const [member, source] of patchSources((member) => fs.readFileSync(path.join(root, member), "utf8"))) {
    fs.writeFileSync(path.join(root, member), source);
  }
}

// Appends the replacement members to the archive's payload and points the
// header at them, so unpacked files and every other member stay untouched.
async function patchArchive(archive, plistPath) {
  // The archive writer and integrity helper are internal modules, outside the
  // package's exports, so they are loaded by path next to its entry point.
  const entry = require.resolve("@electron/asar");
  const asar = require(entry);
  const disk = require(path.join(path.dirname(entry), "disk.js"));
  const integrity = require(path.join(path.dirname(entry), "integrity.js"));
  const { header, headerString, headerSize } = asar.getRawHeader(archive);
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const sources = patchSources((member) => asar.extractFile(archive, member).toString());
  if (sources.size === 0) return;

  const scratch = fs.mkdtempSync(path.join(path.dirname(archive), ".paseo-patch-"));
  try {
    let payload = fs.readFileSync(archive).subarray(8 + headerSize);
    for (const [member, source] of sources) {
      let entry = header;
      for (const component of member.split("/")) entry = entry.files[component];
      if (entry.unpacked || entry.link) throw new Error(`Expected a packed JavaScript member: ${member}`);
      const file = path.join(scratch, "member");
      fs.writeFileSync(file, source);
      entry.offset = String(payload.length);
      entry.size = Buffer.byteLength(source);
      entry.integrity = await integrity(file);
      payload = Buffer.concat([payload, Buffer.from(source)]);
    }
    const payloadPath = path.join(scratch, "payload");
    fs.writeFileSync(payloadPath, payload);
    const output = path.join(scratch, "app.asar");
    await finished(await disk.writeFilesystem(output, { header }, [{ filename: payloadPath, unpack: false }], { [payloadPath]: {} }));
    asar.uncacheAll();
    for (const [member, source] of sources) {
      if (asar.extractFile(output, member).toString() !== source) throw new Error(`Patched archive verification failed: ${member}`);
    }
    if (plistPath) {
      const plist = fs.readFileSync(plistPath, "utf8");
      const originalHash = hash(headerString);
      if (plist.split(originalHash).length !== 2) throw new Error(`No ASAR integrity hash for this archive in ${plistPath}`);
      fs.writeFileSync(plistPath, plist.replace(originalHash, hash(JSON.stringify(header))));
    }
    fs.renameSync(output, archive);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const resolved = path.resolve(target);
if (resolved.endsWith(".app")) {
  await patchArchive(path.join(resolved, "Contents/Resources/app.asar"), path.join(resolved, "Contents/Info.plist"));
  console.log(`Re-sign the app before starting it: codesign --force --deep --sign - ${JSON.stringify(resolved)}`);
} else if (resolved.endsWith(".asar")) {
  await patchArchive(resolved, null);
} else {
  patchDirectory(resolved);
}
console.log("Restart the Paseo daemon to load the patched code.");
