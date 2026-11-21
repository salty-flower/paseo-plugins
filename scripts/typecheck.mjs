#!/usr/bin/env node
// Typechecks every plugin under plugins/, one pass per runtime, the way the
// daemon splits them: the server pass sees index.server.ts, server/ and
// shared/ with Node's types; the client pass sees index.client.*, client/ and
// shared/ with React Native's and Node's.
//
// The server pass leaves React Native out: its globals declare an AbortSignal
// without `timeout`, which @types/node then defers to. The client pass adds
// Node's types because genui's shared code relies on Node's URL; the daemon's
// compiler still rejects a `node:` import reachable from client code.
//
//   node scripts/typecheck.mjs [plugin ...]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const tsc = path.join(root, "node_modules/typescript/bin/tsc");
const plugins = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(root, "plugins")).sort();
const passes = [
  { name: "server", entries: ["index.server.ts"], dirs: ["server", "shared"], types: ["node"] },
  { name: "client", entries: ["index.client.ts", "index.client.tsx"], dirs: ["client", "shared"], types: ["react", "node"] },
];

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-typecheck-"));
let failed = false;
try {
  for (const plugin of plugins) {
    const dir = path.join(root, "plugins", plugin);
    for (const pass of passes) {
      if (!pass.entries.some((entry) => fs.existsSync(path.join(dir, entry)))) continue;
      const config = path.join(scratch, `${plugin}.${pass.name}.json`);
      fs.writeFileSync(
        config,
        JSON.stringify({
          extends: path.join(root, "tsconfig.base.json"),
          compilerOptions: { types: pass.types, typeRoots: [path.join(root, "node_modules/@types")] },
          include: [...pass.entries, ...pass.dirs.map((d) => `${d}/**/*`)].map((p) => path.join(dir, p)),
          exclude: ["**/*.test.ts", "**/*.test.tsx"].map((p) => path.join(dir, p)),
        }),
      );
      console.log(`typecheck: ${plugin} (${pass.name})`);
      const result = spawnSync(process.execPath, [tsc, "-p", config], { stdio: "inherit", cwd: root });
      if (result.status !== 0) failed = true;
    }
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
