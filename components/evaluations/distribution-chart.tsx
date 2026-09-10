"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export function DistributionChart({ distribution }: { distribution: { label: string; count: number }[] }) {
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={distribution} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--color-muted)" }}
            axisLine={{ stroke: "var(--color-border)" }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: "var(--color-muted)" }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip
            cursor={{ fill: "var(--color-paper)" }}
            contentStyle={{
              borderRadius: 10,
              borderColor: "var(--color-border)",
              fontSize: 13,
              boxShadow: "0 4px 16px rgba(20,22,27,0.08)",
            }}
            formatter={(value) => [`${value} élève${Number(value) > 1 ? "s" : ""}`, ""]}
          />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} fill="var(--color-brand)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
