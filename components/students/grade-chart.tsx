"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatDateShort } from "@/lib/utils";
import type { StudentAnalysis } from "@/lib/analysis";

export function GradeChart({
  timeline,
}: {
  timeline: StudentAnalysis["timeline"];
}) {
  const data = timeline.map((t) => ({
    name: formatDateShort(t.evaluation.date),
    fullName: t.evaluation.name,
    score: t.absent ? null : t.score,
    absent: t.absent,
  }));

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 0, left: -18 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            vertical={false}
          />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12, fill: "var(--color-muted)" }}
            axisLine={{ stroke: "var(--color-border)" }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 20]}
            ticks={[0, 5, 10, 15, 20]}
            tick={{ fontSize: 12, fill: "var(--color-muted)" }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip
            cursor={{ stroke: "var(--color-border-strong)" }}
            contentStyle={{
              borderRadius: 10,
              borderColor: "var(--color-border)",
              fontSize: 13,
              boxShadow: "0 4px 16px rgba(20,22,27,0.08)",
            }}
            formatter={(value) => [`${value} / 20`, "Note"]}
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.fullName ?? ""
            }
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="var(--color-brand)"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "var(--color-brand)", strokeWidth: 0 }}
            activeDot={{ r: 6 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
