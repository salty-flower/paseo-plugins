import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PadPanel, PadPopover } from "./client/pad-panel";
import { registerPadPills } from "./client/pad-pills";

export default function contribute(client: PluginClientContext) {
  const playAudio = async (dataUrl: string) => {
    const comma = dataUrl.indexOf(",");
    if (comma === -1) return;
    const mimeType = /^data:([^;]+);base64$/i.exec(dataUrl.slice(0, comma))?.[1] ?? "audio/wav";
    await client.playAudio({ base64: dataUrl.slice(comma + 1), mimeType });
  };

  client.addWorkspacePanel({
    id: "pad",
    title: "Pad",
    icon: "NotebookPen",
    locations: ["workspace", "explorer"],
    Component: (props) => <PadPanel {...props} playAudio={playAudio} />,
  });

  client.addCommandCenterItem({
    id: "open-pad",
    title: "Open the workspace pad",
    icon: "NotebookPen",
    keywords: ["pad", "scratchpad", "board", "status"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("pad");
    },
  });

  client.addSlashCommand({
    name: "pad",
    description: "Open the workspace pad",
    argumentHint: "",
    context: "workspace",
    onSubmit({ openPanel }) {
      openPanel("pad");
    },
  });

  const removePills = registerPadPills(client, (props) => (
    <PadPopover
      {...props}
      playAudio={playAudio}
      onExpand={() => {
        props.close();
        client.openPanel("pad", { workspaceId: props.workspaceId });
      }}
    />
  ));
  return () => {
    removePills();
  };
}
