#!/usr/bin/env node
// Copies Generative UI's renderer into plugins/pad at one pinned commit.
//
// A Paseo plugin cannot import another plugin's code, so the pad carries
// genui's client/, server/, shared/ and fonts next to its own pad-* files.
// The copy is committed, so installing the pad needs no build step.
//
//   node scripts/vendor-genui.mjs            re-copy the commit in vendor.json
//   node scripts/vendor-genui.mjs <commit>   move to another commit
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pad = path.join(root, "plugins/pad");
const lockPath = path.join(pad, "vendor.json");
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const rev = process.argv[2] ?? lock.genui.rev;
// Of assets/, only the sketch font is read at runtime; the rest is genui's listing art.
const directories = ["client", "server", "shared", "assets/fonts"];
const isTest = (file) => /\.test\.tsx?$/.test(file);

const checkout = fs.mkdtempSync(path.join(os.tmpdir(), "vendor-genui-"));
try {
  const git = (...args) =>
    execFileSync("git", ["-C", checkout, ...args], { stdio: ["ignore", "pipe", "inherit"] })
      .toString()
      .trim();
  git("init", "--quiet");
  git("fetch", "--quiet", "--depth=1", lock.genui.repository, rev);
  git("checkout", "--quiet", "FETCH_HEAD");
  const commit = git("rev-parse", "HEAD");
  const version = JSON.parse(fs.readFileSync(path.join(checkout, "package.json"), "utf8")).version;

  // Remove the previous copy, keeping the pad's own files.
  for (const file of lock.genui.files) fs.rmSync(path.join(pad, file), { force: true });

  const files = [];
  for (const directory of directories) {
    for (const entry of fs.readdirSync(path.join(checkout, directory), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.relative(checkout, path.join(entry.parentPath, entry.name));
      if (isTest(file)) continue;
      if (fs.existsSync(path.join(pad, file))) throw new Error(`genui's ${file} would overwrite a pad file`);
      fs.mkdirSync(path.dirname(path.join(pad, file)), { recursive: true });
      fs.copyFileSync(path.join(checkout, file), path.join(pad, file));
      files.push(file);
    }
  }
  fs.copyFileSync(path.join(checkout, "LICENSE"), path.join(pad, "LICENSE.genui"));

  files.sort();
  lock.genui = { ...lock.genui, rev: commit, version, files };
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`Vendored genui ${version} (${commit}): ${files.length} files`);
} finally {
  fs.rmSync(checkout, { recursive: true, force: true });
}
