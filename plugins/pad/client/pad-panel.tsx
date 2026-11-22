import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginButtonContentProps, type PluginWorkspacePanelProps, useAgent, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useCallback, useMemo, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { age, type Pad, type PadSection, padClearRpc, padInteractionRpc, padReply, padsInWorkspaceRpc, sectionId } from "../shared/pad";
// genui's renderer, copied in at build time from the same pin.
import { SpecBlockView } from "./live-ui";
import { BindingChip } from "./pad-binding";
import { PadButtonContext } from "./pad-buttons";
import { sharePadDwell } from "./pad-dwell";
import { usePadVisibility } from "./pad-visibility";
import type { UiRuntime } from "./runtime";
import { openWorkspaceFile } from "./web";

const POLL_MS = 3000;

interface Shared {
  hostId: string;
  workspaceId: string;
  theme: PluginTheme;
  compact: boolean;
  platform: "ios" | "android" | "web";
  playAudio: UiRuntime["playAudio"];
  viewport?: RefObject<View | null>;
}

function Section({ agentId, section, theme, compact, platform, playAudio, hostId, workspaceId, viewport }: Shared & { agentId: string; section: PadSection }) {
  const paseo = usePaseo();
  const toast = useToast();
  const interaction = useRpc(padInteractionRpc);
  const id = sectionId(section);
  const sectionKey = useMemo(() => ({ agentId, workspaceId, sectionId: id }), [agentId, workspaceId, id]);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const reportView = useCallback(
    (viewing: boolean, dwellMs?: number) => {
      void interaction({
        ...sectionKey,
        type: "section.viewed",
        at: new Date().toISOString(),
        timeZone,
        dwellMs,
        viewing,
      }).catch(() => undefined);
    },
    [interaction, sectionKey, timeZone],
  );
  const reportButton = useCallback(
    (buttonLabel: string) => {
      void interaction({
        ...sectionKey,
        type: "button.pressed",
        at: new Date().toISOString(),
        timeZone,
        buttonLabel,
      }).catch(() => undefined);
    },
    [interaction, sectionKey, timeZone],
  );
  const reportSurface = useMemo(() => sharePadDwell(JSON.stringify([hostId, agentId, id]), reportView), [hostId, agentId, id, reportView]);
  const ref = usePadVisibility(viewport, reportSurface);
  // genui marks a card answered only after `send` resolves, and the daemon
  // round trip made a press feel unacknowledged. Resolve at once, so the card
  // shows the answer on press, and report delivery with a toast instead.
  // `steer` joins a running turn: the daemon's default interrupts it, which
  // would cut a router off mid-orchestration.
  const send = useCallback(
    async (text: string) => {
      paseo.agents
        .ref(agentId)
        .send(padReply(section.name, text), { activeTurnBehavior: "steer" })
        .then(
          () => toast.show("Sent to the agent", { variant: "success" }),
          (error: unknown) => toast.error(`Not sent: ${error instanceof Error ? error.message : String(error)}`),
        );
    },
    [paseo, toast, agentId, section.name],
  );
  // A rewrite starts fresh: old input state and a recorded answer belong to the
  // old card. LiveUi reads both in useState initializers, so the key remounts it.
  const stateKey = `paseo.pad:${agentId}:${section.name}:${section.updatedAt}`;
  return (
    <View ref={ref} collapsable={false} style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, flex: 1 }}>
          {section.name} · {age(section.updatedAt)}
        </Text>
        <BindingChip agentId={agentId} section={section} hostId={hostId} workspaceId={workspaceId} theme={theme} />
      </View>
      <PadButtonContext.Provider value={reportButton}>
        <SpecBlockView
          key={stateKey}
          code={section.ui}
          complete
          stateKey={stateKey}
          scope={{ agentId }}
          send={send}
          openFile={platform === "web" ? openWorkspaceFile : null}
          playAudio={playAudio}
          theme={theme}
          compact={compact}
          platform={platform}
        />
      </PadButtonContext.Provider>
    </View>
  );
}

function AgentPad({ pad, onExpand, ...shared }: Shared & { pad: Pad; onExpand?: () => void }) {
  const { theme } = shared;
  const title = useAgent(pad.agentId, (agent) => agent.title);
  const clearPad = useRpc(padClearRpc);
  const queryClient = useQueryClient();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        header: { flexDirection: "row", alignItems: "center", gap: 8 },
        title: { flex: 1, minWidth: 0, color: theme.colors.foreground, fontSize: 15, fontWeight: "600" },
        muted: { color: theme.colors.foregroundMuted, fontSize: 12.5 },
        action: {
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 6,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
      }),
    [theme],
  );
  return (
    <View style={{ gap: shared.compact ? 16 : 20 }}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {title ?? pad.agentId}
        </Text>
        <Text style={styles.muted}>updated {age(pad.updatedAt)} ago</Text>
        {onExpand ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Open the pad as a full panel" style={styles.action} onPress={onExpand}>
            <Text style={styles.muted}>Expand</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Clear the pad of ${title ?? pad.agentId}`}
          style={styles.action}
          onPress={async () => {
            await clearPad({ agentId: pad.agentId });
            await queryClient.invalidateQueries({ queryKey: ["pad", shared.workspaceId] });
          }}
        >
          <Text style={styles.muted}>Clear</Text>
        </Pressable>
      </View>
      {pad.sections.map((section) => (
        <Section key={sectionId(section)} agentId={pad.agentId} section={section} {...shared} />
      ))}
    </View>
  );
}

function usePadsInWorkspace(workspaceId: string) {
  const padsInWorkspace = useRpc(padsInWorkspaceRpc);
  return useQuery({
    queryKey: ["pad", workspaceId],
    queryFn: () => padsInWorkspace({ workspaceId }),
    refetchInterval: POLL_MS,
  });
}

// The composer pill opens this popover instead of the panel, so the pad shows
// in place; Paseo hands the popover the pill's own workspace and agent. On
// desktop the popover has a fixed width, so the content takes that width
// instead of setting its own, and Expand opens the full panel.
export function PadPopover(props: PluginButtonContentProps & { playAudio: UiRuntime["playAudio"]; onExpand: () => void }) {
  const { theme, layout, host, workspaceId, playAudio, onExpand } = props;
  const agentId = props.context === "agent" ? props.agentId : null;
  const query = usePadsInWorkspace(workspaceId);
  const pad = query.data?.pads.find((entry) => entry.agentId === agentId) ?? null;
  return (
    <View style={{ gap: 16, alignSelf: "stretch", minWidth: 0 }}>
      {query.isError ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12.5 }}>{query.error instanceof Error ? query.error.message : String(query.error)}</Text> : null}
      {query.isSuccess && !pad ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12.5 }}>This agent has no pad.</Text> : null}
      {pad ? <AgentPad pad={pad} hostId={host.id} workspaceId={workspaceId} onExpand={onExpand} theme={theme} compact={layout.compact} platform={layout.platform} playAudio={playAudio} /> : null}
    </View>
  );
}

// A workspace panel, not an agent panel: Paseo opens a panel from the tab menu
// and the Explorer only when its context is "workspace", and a router's pad
// belongs to the workspace it runs in anyway.
export function PadPanel({ theme, layout, host, workspaceId, playAudio }: PluginWorkspacePanelProps & { playAudio: UiRuntime["playAudio"] }) {
  const query = usePadsInWorkspace(workspaceId);
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12.5 };
  const pads = query.data?.pads ?? [];
  const viewport = useRef<View>(null);
  return (
    <View ref={viewport} collapsable={false} style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 12 : 20, gap: layout.compact ? 24 : 32 }}>
        {query.isError ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12.5 }}>{query.error instanceof Error ? query.error.message : String(query.error)}</Text> : null}
        {query.isSuccess && pads.length === 0 ? <Text style={muted}>No pad in this workspace yet. Ask its router agent to keep its status on the pad with the `pad` tool.</Text> : null}
        {pads.map((pad) => (
          <AgentPad
            key={pad.agentId}
            pad={pad}
            hostId={host.id}
            workspaceId={workspaceId}
            theme={theme}
            compact={layout.compact}
            platform={layout.platform}
            playAudio={playAudio}
            viewport={viewport}
          />
        ))}
      </ScrollView>
    </View>
  );
}
