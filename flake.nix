{
  description = "Paseo plugins: pad, background-shell, later and gruvbox";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      packageJson = lib.importJSON ./package.json;
      vendor = (lib.importJSON ./plugins/pad/vendor.json).genui;

      # The Paseo release the plugin SDK and the daemon patches are checked
      # against. Bump it together with @getpaseo/plugin in package.json.
      paseo = {
        version = "0.17.3";
        appImage = {
          url = "https://github.com/getpaseo/paseo/releases/download/v0.17.3/Paseo-x86_64.AppImage";
          hash = "sha256-/ExTnr2sVNwP3WMIG4R8hzdpXyyxRzqv7F9df2uEEnY=";
        };
      };
    in
    assert lib.assertMsg (packageJson.devDependencies."@getpaseo/plugin" == paseo.version) ''
      package.json pins @getpaseo/plugin ${
        packageJson.devDependencies."@getpaseo/plugin"
      }, but flake.nix checks against Paseo ${paseo.version}.
      Bump both together, then regenerate pnpm-lock.yaml and the pnpmDeps hash.
    '';
    {
      # Each plugin as the directory Paseo installs, for Nix-managed setups.
      packages = forAllSystems (
        pkgs:
        lib.genAttrs (builtins.attrNames (builtins.readDir ./plugins)) (
          name:
          pkgs.runCommand "paseo-plugin-${name}" { } ''
            cp -r ${./plugins + "/${name}"} $out
          ''
        )
      );

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShellNoCC {
          packages = [
            pkgs.nodejs
            pkgs.pnpm_12
            pkgs.prek
            pkgs.nixfmt
            pkgs.markdownlint-cli2
            pkgs.gitleaks
          ];
        };
      });

      checks = forAllSystems (
        pkgs:
        let
          # Bumped deliberately: a new pnpm major can change the store
          # layout, and with it the dependency hash below.
          pnpm = pkgs.pnpm_12;
          src = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              ./package.json
              ./pnpm-lock.yaml
              ./pnpm-workspace.yaml
              ./tsconfig.base.json
              ./plugins
              ./scripts
              ./daemon-patches
            ];
          };
          # The repository's dev dependencies, shared by every check that runs a
          # script. Only the manifest and lockfile, so editing a plugin does not refetch.
          pnpmDeps = pkgs.fetchPnpmDeps {
            pname = "paseo-plugins";
            inherit pnpm;
            src = lib.fileset.toSource {
              root = ./.;
              fileset = lib.fileset.unions [
                ./package.json
                ./pnpm-lock.yaml
                ./pnpm-workspace.yaml
              ];
            };
            fetcherVersion = 5;
            hash = "sha256-wah9I3mAcinDgV2QQWI7u400fmYN4iEZHF+wnYJikF8=";
          };
          nodeCheck =
            name: script:
            pkgs.stdenvNoCC.mkDerivation {
              pname = "paseo-plugins-${name}";
              version = paseo.version;
              inherit src pnpmDeps;
              nativeBuildInputs = [
                pkgs.nodejs
                pnpm
                pkgs.pnpmConfigHook
              ];
              buildPhase = ''
                runHook preBuild
                ${script}
                runHook postBuild
              '';
              installPhase = "touch $out";
            };
          paseoApp = pkgs.appimageTools.extract {
            pname = "paseo";
            inherit (paseo) version;
            src = pkgs.fetchurl paseo.appImage;
          };
          genui = builtins.fetchGit {
            url = vendor.repository;
            inherit (vendor) rev;
            shallow = true;
          };
        in
        {
          typecheck = nodeCheck "typecheck" "node scripts/typecheck.mjs";
          pad-tests = nodeCheck "pad-tests" "node --test scripts/test-pad.mjs";

          # The pad's copy of genui is genui's own files, unedited, at the
          # commit vendor.json names: pad code goes in pad-* files instead.
          genui-vendored = pkgs.runCommand "paseo-plugins-genui-vendored" { } ''
            ${lib.concatMapStrings (file: ''
              cmp ${genui}/${file} ${./plugins/pad + "/${file}"}
            '') vendor.files}
            cmp ${genui}/LICENSE ${./plugins/pad/LICENSE.genui}
            touch $out
          '';
        }
        # The release's daemon code comes from the Linux AppImage; the
        # JavaScript is the same in every platform's build.
        // lib.optionalAttrs (pkgs.stdenv.hostPlatform.system == "x86_64-linux") {
          daemon-patches = nodeCheck "daemon-patches" "node scripts/test-daemon-patches.mjs ${paseoApp}/resources/app.asar";
        }
      );

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
