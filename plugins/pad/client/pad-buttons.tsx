import { createContext, useContext, useMemo } from "react";
import type { Props } from "../shared/logic/values";
import { ButtonGroup } from "./components/inputs";
import { registerRenderers } from "./node-renderer";
import { padButtonLabels } from "./pad-button-labels";
import { RENDERERS } from "./render";
import { type UiRuntime, UiRuntimeContext, useUiRuntime } from "./runtime";

export const PadButtonContext = createContext<(buttonId: string) => void>(() => {});
const OriginalRun = createContext<UiRuntime["run"] | null>(null);

function observeButton(component: Parameters<typeof padButtonLabels>[0]) {
  const Component = RENDERERS[component];
  return function PadButton({ props }: { props: Props }) {
    const runtime = useUiRuntime();
    const report = useContext(PadButtonContext);
    const run = useContext(OriginalRun) ?? runtime.run;
    const labels = useMemo(() => padButtonLabels(component, props), [props]);
    return (
      <OriginalRun.Provider value={run}>
        <UiRuntimeContext.Provider
          value={{
            ...runtime,
            run(actions) {
              report(labels.buttonId(actions));
              return run(actions);
            },
          }}
        >
          <Component props={labels.props} />
        </UiRuntimeContext.Provider>
      </OriginalRun.Provider>
    );
  };
}

export function registerPadButtons() {
  registerRenderers(
    {
      ...RENDERERS,
      Button: observeButton("Button"),
      Other: observeButton("Other"),
      Form: observeButton("Form"),
      FollowUps: observeButton("FollowUps"),
      Plan: observeButton("Plan"),
      Decision: observeButton("Decision"),
      Findings: observeButton("Findings"),
      List: observeButton("List"),
    },
    ButtonGroup,
  );
  return () => registerRenderers(RENDERERS, ButtonGroup);
}
