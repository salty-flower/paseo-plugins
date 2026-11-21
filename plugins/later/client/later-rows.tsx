import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { z } from "zod";
import type { JobRow, listRowSchema } from "../shared/later";

type Theme = PluginTimelineItemProps["theme"];

function useStyles(theme: Theme) {
  return useMemo(
    () => ({
      row: { paddingVertical: 4, gap: 2 },
      head: { color: theme.colors.foregroundMuted, fontSize: 12 },
      prompt: { color: theme.colors.foreground, fontSize: 13 },
    }),
    [theme],
  );
}

function when(at: number): string {
  return new Date(at).toLocaleString();
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ");
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

const statusText: Record<JobRow["status"], string> = {
  pending: "scheduled for",
  sent: "sent at",
  cancelled: "cancelled, was due",
  failed: "failed, was due",
};

export function JobRowView({ item, theme }: PluginTimelineItemProps<JobRow>) {
  const styles = useStyles(theme);
  const job = item.data;
  return (
    <View style={styles.row}>
      <Text style={styles.head}>
        /later {job.id} {statusText[job.status]} {when(job.at)}
        {job.detail ? ` — ${job.detail}` : ""}
      </Text>
      <Text style={styles.prompt}>{clip(job.prompt)}</Text>
    </View>
  );
}

export function ListRowView({ item, theme }: PluginTimelineItemProps<z.output<typeof listRowSchema>>) {
  const styles = useStyles(theme);
  const { jobs } = item.data;
  return (
    <View style={styles.row}>
      <Text style={styles.head}>{jobs.length === 0 ? "No pending /later prompts" : `Pending /later prompts (${jobs.length})`}</Text>
      {jobs.map((job) => (
        <Text key={job.id} style={styles.prompt}>
          {job.id} @ {when(job.at)}: {clip(job.prompt)}
        </Text>
      ))}
    </View>
  );
}
