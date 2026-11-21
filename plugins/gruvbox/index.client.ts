// Gruvbox app themes: Light, Dark, and System, which follows the device's
// light or dark appearance the way Paseo's built-in System theme does.
// Paseo expands each seed palette into its full token set.
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Appearance, type ColorSchemeName } from "react-native";
import { palettes } from "./client/palettes";

type Scheme = keyof typeof palettes;

const schemeOf = (name: ColorSchemeName): Scheme => (name === "dark" ? "dark" : "light");

export default function contribute(client: PluginClientContext) {
  // A contributed theme has one fixed appearance, so System is re-registered
  // under the same id whenever the device flips. Paseo stores the chosen theme
  // by id, so the choice survives the swap and the app repaints in place.
  const addSystem = (scheme: Scheme) => client.addTheme({ id: "system", name: "Gruvbox System", appearance: scheme, colors: palettes[scheme] });
  let current = schemeOf(Appearance.getColorScheme());
  let removeSystem = addSystem(current);
  const subscription = Appearance.addChangeListener(({ colorScheme }) => {
    const next = schemeOf(colorScheme);
    if (next === current) return;
    current = next;
    removeSystem();
    removeSystem = addSystem(next);
  });

  const removers = [
    client.addTheme({ id: "light", name: "Gruvbox Light", appearance: "light", colors: palettes.light }),
    client.addTheme({ id: "dark", name: "Gruvbox Dark", appearance: "dark", colors: palettes.dark }),
  ];
  return () => {
    subscription.remove();
    removeSystem();
    for (const remove of removers) remove();
  };
}
