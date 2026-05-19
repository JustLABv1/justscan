"use client";

import { type ChartConfig, ChartContainer } from "@/components/evilcharts/ui/chart";
import {
  ChartTooltip,
  ChartTooltipContent,
  type TooltipRoundness,
  type TooltipVariant,
} from "@/components/evilcharts/ui/tooltip";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart as RechartsRadarChart,
} from "recharts";

type RadarChartPoint = {
  subject: string;
  value: number;
};

type EvilRadarChartProps = {
  data: RadarChartPoint[];
  className?: string;
  tooltipVariant?: TooltipVariant;
  tooltipRoundness?: TooltipRoundness;
};

const chartConfig: ChartConfig = {
  value: {
    label: "Vulnerabilities",
    colors: {
      light: ["#2563eb", "#60a5fa"],
      dark: ["#60a5fa", "#93c5fd"],
    },
  },
};

export function EvilRadarChart({
  data,
  className,
  tooltipVariant = "default",
  tooltipRoundness = "lg",
}: EvilRadarChartProps) {
  return (
    <ChartContainer config={chartConfig} className={className}>
      <RechartsRadarChart data={data} outerRadius="66%">
        <PolarGrid />
        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12 }} />
        <PolarRadiusAxis
          allowDecimals={false}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel
              indicator="line"
              nameKey="subject"
              labelKey="subject"
              formatter={(value, _name, _item, _index, payload) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    {String((payload as { subject?: string } | undefined)?.subject ?? "Value")}
                  </span>
                  <span className="text-foreground font-mono font-medium tabular-nums">
                    {typeof value === "number" ? value.toLocaleString() : String(value)}
                  </span>
                </div>
              )}
              variant={tooltipVariant}
              roundness={tooltipRoundness}
            />
          }
        />
        <Radar
          dataKey="value"
          stroke="var(--color-value-0)"
          fill="var(--color-value-0)"
          fillOpacity={0.22}
          strokeWidth={2}
        />
      </RechartsRadarChart>
    </ChartContainer>
  );
}
