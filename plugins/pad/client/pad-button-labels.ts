import { decisionMessage, readDecision } from "../shared/core/decisions";
import { fixAllMessage, readFindings } from "../shared/core/findings";
import type { Action } from "../shared/core/types";
import { parseListRows } from "../shared/logic/explain-logic";
import { asRecord, isAction, list, optionalText, type Props } from "../shared/logic/values";

type ButtonComponent = "Button" | "Other" | "Form" | "FollowUps" | "Plan" | "Decision" | "Findings" | "List";

/** List rows may share one authored action. Give each row its own action objects. */
function labelListActions(props: Props) {
  const items = list(props.items).map((item) => {
    const row = asRecord(item);
    if (!row || !Object.hasOwn(row, "action")) return item;
    const action = row.action;
    return {
      ...row,
      action: Array.isArray(action) ? action.map((entry) => (isAction(entry) ? { ...entry } : entry)) : isAction(action) ? { ...action } : action,
    };
  });
  const labels = new Map<Action, string>();
  for (const row of parseListRows(items)) {
    const first = row.actions[0];
    if (first) labels.set(first, row.title);
  }
  return {
    props: { ...props, items },
    label: (actions: readonly Action[]) => labels.get(actions[0]),
  };
}

function actionLabel(component: Exclude<ButtonComponent, "List">, props: Props, action: Action | undefined) {
  switch (component) {
    case "Button":
      return optionalText(props.label);
    case "Other":
      return "Send";
    case "Form":
      return optionalText(props.submit) ?? "Submit";
    case "Plan":
      return optionalText(props.submit) ?? "Approve plan";
    case "FollowUps":
      return action?.type === "send" ? action.text : null;
    case "Decision": {
      if (action?.type !== "send") return null;
      const parsed = readDecision(props.options, props.criteria);
      if (!parsed.ok) return null;
      const { model } = parsed;
      const weights = model.criteria.map((criterion) => criterion.weight);
      for (const [index, option] of model.options.entries()) {
        const choice = decisionMessage(model, index, weights);
        if (action.text === choice || action.text.startsWith(`${choice} My weights: `)) return `Go with ${option.name}`;
      }
      return null;
    }
    case "Findings": {
      if (action?.type !== "send") return null;
      const parsed = readFindings(props.items);
      if (!parsed.ok) return null;
      const { findings, scale } = parsed.report;
      return findings.length > 1 && action.text === fixAllMessage(findings, scale) ? "Fix all" : "Fix this";
    }
  }
}

export function padButtonLabels(component: ButtonComponent, props: Props) {
  const resolved = component === "List" ? labelListActions(props) : { props, label: (actions: readonly Action[]) => actionLabel(component, props, actions[0]) };
  return {
    props: resolved.props,
    buttonId: (actions: readonly Action[]) => (resolved.label(actions)?.trim() || component).slice(0, 1024),
  };
}
