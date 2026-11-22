import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type PadBinding, type PadSection, padBindRpc, sectionId } from "../shared/pad";

interface BindingProps {
  agentId: string;
  section: PadSection;
  hostId: string;
  workspaceId: string;
  theme: PluginTheme;
}

export function BindingChip(props: BindingProps) {
  const { section, theme, workspaceId } = props;
  const [open, setOpen] = useState(false);
  const binding = section.binding;
  const workspace = useWorkspace(binding?.workspaceId ?? workspaceId, (item) => item.title ?? item.name);
  const label = binding?.label ?? (binding?.workspaceId ? workspace : null) ?? binding?.ref ?? binding?.workspaceId ?? "Bind section";
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit binding for ${section.name}. ${label}`}
        hitSlop={6}
        onPress={() => setOpen(true)}
        style={{ maxWidth: "55%", flexShrink: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderColor: theme.colors.border, borderWidth: StyleSheet.hairlineWidth }}
      >
        <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {label}
        </Text>
      </Pressable>
      {open ? <BindingPicker {...props} close={() => setOpen(false)} /> : null}
    </>
  );
}

function BindingPicker({ agentId, section, hostId, workspaceId, theme, close }: BindingProps & { close: () => void }) {
  const paseo = usePaseo();
  const bind = useRpc(padBindRpc);
  const cache = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<PadBinding>(section.binding ?? {});
  const [saving, setSaving] = useState(false);
  const search = draft.workspaceId?.trim();
  const workspaces = useQuery({
    queryKey: ["pad-binding-workspaces", hostId, search],
    queryFn: () => paseo.workspaces.list({ filter: { query: search, includeBackground: true }, page: { limit: 5 } }),
  });
  const inputStyle = { color: theme.colors.foreground, borderColor: theme.colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, padding: 8 };
  const fields = [
    ["workspaceId", "Find a workspace or enter its ID"],
    ["ref", "External reference"],
    ["label", "Label"],
  ] as const;
  const save = async () => {
    setSaving(true);
    try {
      await bind({
        agentId,
        sectionId: sectionId(section),
        binding: {
          workspaceId: draft.workspaceId?.trim() || undefined,
          ref: draft.ref || undefined,
          label: draft.label?.trim() || undefined,
        },
      });
      await cache.invalidateQueries({ queryKey: ["pad", workspaceId] });
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setSaving(false);
    }
  };

  return (
    <Modal title={`Binding for ${section.name}`} open onOpenChange={(open) => !open && close()}>
      <Modal.Content contentContainerStyle={{ gap: 8 }}>
        {fields.map(([field, label]) => (
          <View key={field} style={{ gap: 4 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{label}</Text>
            <TextInput
              accessibilityLabel={label}
              value={draft[field] ?? ""}
              onChangeText={(value) => setDraft({ ...draft, [field]: value })}
              maxLength={256}
              autoCapitalize="none"
              autoCorrect={false}
              style={inputStyle}
            />
            {field === "workspaceId" &&
              workspaces.data?.entries.slice(0, 5).map((workspace) => (
                <Pressable
                  key={workspace.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: draft.workspaceId === workspace.id }}
                  onPress={() => setDraft({ ...draft, workspaceId: workspace.id })}
                  style={{ paddingVertical: 4 }}
                >
                  <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted }}>
                    {workspace.title ?? workspace.name}
                  </Text>
                </Pressable>
              ))}
          </View>
        ))}
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => void save()} style={{ ...inputStyle, alignSelf: "flex-start" }}>
          <Text style={{ color: theme.colors.foreground }}>{saving ? "Saving…" : "Save binding"}</Text>
        </Pressable>
      </Modal.Content>
    </Modal>
  );
}
