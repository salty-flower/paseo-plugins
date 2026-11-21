# Paseo plugins

Four plugins for [Paseo](https://paseo.sh).

| Plugin | What it does | Needs |
| --- | --- | --- |
| [pad](plugins/pad/OVERVIEW.md) | A board each top-level agent keeps beside its chat, drawn with Generative UI, so you read one place instead of its replies | Paseo 0.15 |
| [background-shell](plugins/background-shell/OVERVIEW.md) | Ctrl+B for Paseo: the shell commands a Claude or OpenCode turn waits on move to the background and keep running | Paseo 0.16 and a [patched daemon](#background-shell-needs-a-patched-daemon) |
| [later](plugins/later/OVERVIEW.md) | `/later 10m <prompt>` or `/later 14:30 <prompt>` sends a prompt to the agent at a set time | Paseo 0.16 |
| [gruvbox](plugins/gruvbox/OVERVIEW.md) | Gruvbox Light, Gruvbox Dark, and Gruvbox System, which follows the device's appearance | Paseo 0.10 |

## Install

Plugins must be enabled on the daemon (Settings → Plugins).
Install each one from its directory in this repository:

```sh
paseo plugin add git:salty-flower/paseo-plugins:plugins/pad
paseo plugin add git:salty-flower/paseo-plugins:plugins/background-shell
paseo plugin add git:salty-flower/paseo-plugins:plugins/later
paseo plugin add git:salty-flower/paseo-plugins:plugins/gruvbox
```

None of them has a build step.
`paseo plugin update <id>` moves an installed plugin to the latest commit.

With Nix, the flake exposes each plugin directory as `packages.<system>.<plugin>`.

## Background shell needs a patched daemon

Paseo has no request that moves running work to the background,
so the plugin sends a stop for the reserved background-work item `paseo:foreground`,
and a patched daemon hands that to the provider instead.
An unpatched daemon answers "Background work is no longer available to stop".
[daemon-patches/](daemon-patches/README.md) holds the patch and a script that applies it to an installed Paseo.

## Development

```sh
nix develop          # node, pnpm, prek, nixfmt, markdownlint, gitleaks
pnpm install --frozen-lockfile --ignore-scripts
prek install         # biome, typecheck and lint on every commit
pnpm run typecheck
nix flake check      # typecheck, the pad's genui copy, the daemon patches
```

Conventions for contributors and coding agents are in [AGENTS.md](AGENTS.md).

## License

MIT; see [LICENSE](LICENSE).

The exception is the pad's copy of [Generative UI](https://github.com/anh-chu/paseo-plugin-genui):
the files [plugins/pad/vendor.json](plugins/pad/vendor.json) lists are copied from it unchanged
and stay under the Apache License 2.0, in [plugins/pad/LICENSE.genui](plugins/pad/LICENSE.genui).
