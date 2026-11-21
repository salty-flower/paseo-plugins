import { type PluginButtonContentProps, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { cancelRpc, type PendingJob, pendingRpc } from "../shared/later";

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function countdown(ms: number): string {
  if (ms <= 0) return "due now";
  const seconds = Math.round(ms / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  if (minutes > 0) return `in ${minutes}m ${rest}s`;
  return `in ${rest}s`;
}

function when(at: number, now: number): string {
  const date = new Date(at);
  const today = new Date(now).toDateString() === date.toDateString();
  return today ? date.toLocaleTimeString() : date.toLocaleString();
}

/** One agent's pending /later prompts, each with Cancel. */
export function LaterPopover(props: PluginButtonContentProps & { onChanged: () => void }) {
  const { theme, onChanged } = props;
  const agentId = props.context === "agent" ? props.agentId : null;
  const pending = useRpc(pendingRpc);
  const cancel = useRpc(cancelRpc);
  const queryClient = useQueryClient();
  const now = useNow(1000);
  const queryKey = ["later-pending", agentId];
  const query = useQuery({
    queryKey,
    enabled: agentId !== null,
    queryFn: () => pending({ agentId: agentId ?? undefined }),
    refetchInterval: 3000,
  });
  const cancelling = useMutation({
    mutationFn: (target: string) => cancel({ agentId: agentId ?? "", target }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey });
      onChanged();
    },
  });

  const styles = useMemo(
    () => ({
      list: { gap: 10, alignSelf: "stretch" as const, minWidth: 260, maxWidth: 420 },
      row: { flexDirection: "row" as const, gap: 10, alignItems: "flex-start" as const },
      body: { flex: 1, minWidth: 0, gap: 2 },
      head: { color: theme.colors.foregroundMuted, fontSize: 12 },
      prompt: { color: theme.colors.foreground, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12.5 },
      error: { color: theme.colors.statusDanger, fontSize: 12.5 },
      button: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      buttonText: { color: theme.colors.statusDanger, fontSize: 12 },
    }),
    [theme],
  );

  const jobs: PendingJob[] = query.data?.jobs ?? [];
  const failure = query.error ?? cancelling.error;
  return (
    <View style={styles.list}>
      {failure ? <Text style={styles.error}>{failure instanceof Error ? failure.message : String(failure)}</Text> : null}
      {query.isSuccess && jobs.length === 0 ? <Text style={styles.muted}>No pending /later prompts.</Text> : null}
      {jobs.map((job) => (
        <View key={job.id} style={styles.row}>
          <View style={styles.body}>
            <Text style={styles.head}>
              {when(job.at, now)} · {countdown(job.at - now)} · {job.id}
            </Text>
            <Text style={styles.prompt} numberOfLines={4}>
              {job.prompt}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Cancel ${job.id}`} disabled={cancelling.isPending} onPress={() => cancelling.mutate(job.id)} style={styles.button}>
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
        </View>
      ))}
      {jobs.length > 1 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel every pending /later prompt of this agent"
          disabled={cancelling.isPending}
          onPress={() => cancelling.mutate("all")}
          style={[styles.button, { alignSelf: "flex-end" as const }]}
        >
          <Text style={styles.buttonText}>Cancel all</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
