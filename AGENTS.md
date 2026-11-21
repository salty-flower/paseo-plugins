# AI Agent Instructions

Paseo plugins, one per directory under `plugins/`, each installable on its own with
`paseo plugin add git:salty-flower/paseo-plugins:plugins/<name>`.
Read the [plugin reference](https://paseo.sh/docs/plugins/reference.md) before changing a plugin's contract.

## Layout

| Path | Contains |
| --- | --- |
| `plugins/<name>/` | `paseo-plugin.json`, `OVERVIEW.md`, `index.client.*` / `index.server.ts`, and `client/`, `server/`, `shared/`; nothing else that is code |
| `plugins/pad/` | the pad's own files are `index.*`, `*/pad-*` and `shared/pad.ts`; every other file under `client/`, `server/`, `shared/` and `assets/` is genui's, listed in `vendor.json` |
| `daemon-patches/<name>/` | `patch.cjs` and its regression `patch.test.mjs`; see [daemon-patches/README.md](daemon-patches/README.md) |
| `scripts/` | repository tooling: typecheck, genui vendoring, daemon patch test |

## Rules

- A plugin needs no build step: every file the daemon loads is committed.
  Paseo supplies the SDK, React, React Native, TanStack Query and Zod at runtime; anything else would need a lockfile and a manifest `build`.
- Never edit genui's files in `plugins/pad/`, because the next re-vendor would drop the edit and `nix flake check` compares them byte for byte with upstream.
  Change the pad in its own files; bump genui with `node scripts/vendor-genui.mjs <commit>`.
- Keep `requirements.paseo` in each manifest true: raise it when code adopts a newer API.
- `OVERVIEW.md` follows Paseo's [listing contract](https://paseo.sh/docs/plugins/publishing.md#your-listing-page):
  what the plugin does, setup, limits; no install commands, no badges.
  Install instructions live in `README.md`.
- Client code uses React Native primitives and `theme.colors` only, so it works on desktop, web and mobile.
- A daemon patch exists only because Paseo lacks the capability; each one names the plugin that needs it and goes once Paseo ships an equivalent.

## Bumping Paseo

`@getpaseo/plugin` in `package.json` and `paseo.version` in `flake.nix` move together; evaluation fails while they differ.

1. Set both, and the AppImage `url` and `hash` in `flake.nix`.
2. `npm install --package-lock-only --ignore-scripts`.
3. `nix flake check`; take the new `npmDepsHash` from the hash mismatch.
4. A daemon patch whose anchor moved fails here: read the new upstream code before changing the anchor.

## Verify

```sh
npm run typecheck
npm run check
nix flake check
```

`prek run --all-files` runs the same hooks as a commit.
Commit messages: `<plugin or area>: <what changed>`, for example `pad: show section age in the pill`.
