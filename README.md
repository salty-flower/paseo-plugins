# Paseo plugins

Four plugins for [Paseo](https://paseo.sh).

| Plugin | What it does | Needs |
| --- | --- | --- |
| [pad](plugins/pad/OVERVIEW.md) | A board each top-level agent keeps beside its chat, drawn with Generative UI, so you read one place instead of its replies | Paseo 0.15 |
| [background-shell](plugins/background-shell/OVERVIEW.md) | Ctrl+B for Paseo: the shell commands a Claude or OpenCode turn waits on move to the background and keep running | Paseo 0.17 and a [patched daemon](#background-shell-needs-a-patched-daemon) |
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

## Pad bindings and events

The agent can call `pad(section, ui, binding)` with any of `workspaceId`, `ref`, and `label` in the binding.
`workspaceId` identifies a Paseo workspace, `ref` is an opaque string chosen by the caller, and `label` is the title shown in the binding chip.
Each field accepts up to 256 characters, and Pad preserves the reference verbatim.
Each supplied binding replaces the agent's previous declaration. An empty object clears its fields.
Existing `pad(section, ui)` calls preserve the stored binding, and a read returns the active binding alongside the spec.
Tap the section's binding chip to choose a Paseo workspace and edit the external reference and label.
Blank fields clear those values.
A saved correction stays in effect on later agent writes.
Binding edits preserve the section ID. Deleting and recreating a section gives it a new ID.

### Subscribe from another plugin

Time trackers, analytics, and automation can subscribe to Pad's local event stream.
On Unix, a process running as the daemon user can use Node's `net.createConnection(path)` and `readline.createInterface({ input: socket })`
to read one JSON event per line from `$PASEO_HOME/plugin-data/pad/events/v1.sock`.
The Paseo home defaults to `~/.paseo` and the socket directory is private to the daemon user.
On connect, the stream sends current bindings with `snapshot: true`, then live events.
Reconnect on EOF or connection failure. Changes and interactions that occur while disconnected have no replay.

Each line has `v: 1`, `id` (event UUID), `at` (UTC RFC 3339), `timeZone` (observer's IANA time zone), and `type`.
`agentId` and `workspaceId` identify the pad's owner and its workspace. `workspaceId` can be null when unknown.
`sectionId` identifies the section within that agent's pad.

- `section.bound` carries the current `binding` and a `userOverride` boolean.
  The binding can be partial or empty. A live event is also sent when the pad's owner workspace changes.
- `section.removed` marks a section deleted individually or by clearing its pad.
- `section.viewed` carries a `viewing` boolean.
  A section in the panel or popover qualifies after 500 ms on screen in the foreground.
  Scrolling it away, closing the surface, or losing app or window focus ends the view.
  End events carry `dwellMs`, measured from qualification.
- `button.pressed` carries `buttonLabel`, the Generative UI button label or the authored title of an actionable list row.
  The component name is used when an action has no label.
  A press is observed when the button runs its action. With **Other…**, this happens when the user sends their reply.

```json
{"v":1,"id":"a01ab8a3-29d2-4be7-b735-e05f8487fb0d","at":"2026-11-23T12:00:00.000Z","timeZone":"UTC","type":"section.bound","agentId":"agent-1","workspaceId":"workspace-1","sectionId":"d9c65288-caad-45c2-9cfb-b7d9ca3b07e5","binding":{"workspaceId":"workspace-2","ref":"issues:OPS-42","label":"Release checklist"},"userOverride":false}
```

The event schema is in [shared/pad.ts](plugins/pad/shared/pad.ts).

## Development

```sh
nix develop          # node, pnpm, prek, nixfmt, markdownlint, gitleaks
pnpm install --frozen-lockfile --ignore-scripts
prek install         # biome, typecheck and lint on every commit
pnpm run typecheck
pnpm run test:pad
nix flake check      # typecheck, the pad's genui copy, the daemon patches
```

Conventions for contributors and coding agents are in [AGENTS.md](AGENTS.md).

## License

MIT; see [LICENSE](LICENSE).

The exception is the pad's copy of [Generative UI](https://github.com/anh-chu/paseo-plugin-genui):
the files [plugins/pad/vendor.json](plugins/pad/vendor.json) lists are copied from it unchanged
and stay under the Apache License 2.0, in [plugins/pad/LICENSE.genui](plugins/pad/LICENSE.genui).
