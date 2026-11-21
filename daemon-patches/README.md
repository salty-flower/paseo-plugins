# Daemon patches

Changes to the Paseo daemon that a plugin here needs and Paseo does not offer yet.
Each one is meant to go once Paseo ships the same capability.

| Patch | Needed by | What it changes |
| --- | --- | --- |
| `foreground-background` | background-shell | A background-work stop for the reserved item `paseo:foreground` calls the session's new `backgroundForegroundWork()`: Claude's `query.backgroundTasks()`, OpenCode v2's `POST /api/session/:id/background` |

Each patch is a `patch.cjs` that maps modules under `@getpaseo/server/dist/server` to a function rewriting their source.
A function throws when its anchor no longer matches, so a Paseo release that moved the code fails the patch instead of loading half of it.
`patch.test.mjs` is its regression, run against the patched modules.

## Apply to an installed Paseo

From a checkout of this repository, with the daemon stopped:

```sh
pnpm install --frozen-lockfile --ignore-scripts
node daemon-patches/apply.mjs <target>
```

| Install | `<target>` | Afterwards |
| --- | --- | --- |
| macOS app | `/Applications/Paseo.app` | `codesign --force --deep --sign - /Applications/Paseo.app`; macOS may ask again for the app's privacy permissions |
| Linux AppImage | `squashfs-root/resources/app.asar` after `./Paseo.AppImage --appimage-extract` | start `squashfs-root/AppRun` instead of the AppImage |
| npm `@getpaseo/cli` | the package directory that contains `node_modules/@getpaseo/server` | nothing |

Run it again after every Paseo update; a second run on a patched install reports `already applied`.
The macOS path rewrites the ASAR integrity hash in `Info.plist` and breaks the notarized signature, hence the ad-hoc re-sign.

## Packagers

`nix flake check` applies every patch to the release the flake pins and runs its regression.
A packager can apply `patch.cjs` directly: require it, and for each entry of `files` pass the module's source through the function.
