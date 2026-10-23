import type { ChartConfig } from '@/components/evilcharts/ui/chart';

export const CHART_TONES = {
  accent: { light: 'var(--chart-1)', dark: 'var(--chart-1)' },
  success: { light: 'var(--success)', dark: 'var(--success)' },
  danger: { light: 'var(--destructive)', dark: 'var(--destructive)' },
  warning: { light: 'var(--warning)', dark: 'var(--warning)' },
  primary: { light: 'var(--chart-1)', dark: 'var(--chart-1)' },
  neutral: { light: 'var(--muted-foreground)', dark: 'var(--muted-foreground)' },
} as const;

export const SEVERITY_SERIES = [
  { key: 'critical', label: 'Critical', color: CHART_TONES.danger.dark },
  { key: 'high', label: 'High', color: 'var(--color-orange-500)' },
  { key: 'medium', label: 'Medium', color: CHART_TONES.warning.dark },
  { key: 'low', label: 'Low', color: 'var(--color-blue-500)' },
  { key: 'unknown', label: 'Unknown', color: CHART_TONES.neutral.dark },
] as const;

type SeriesEntry<K extends string> = { key: K; label: string; color: string };

export function chartConfigFromSeries(
  series: ReadonlyArray<SeriesEntry<string>>
): Record<string, ChartConfig[string]> {
  return series.reduce<Record<string, ChartConfig[string]>>((acc, item) => {
    acc[item.key] = {
      label: item.label,
      colors: {
        light: [item.color],
        dark: [item.color],
      },
    };
    return acc;
  }, {});
}

export function typedChartConfigFromSeries<const T extends readonly SeriesEntry<string>[]>(
  series: T
): { [K in T[number]['key']]: ChartConfig[string] } {
  return chartConfigFromSeries(series) as { [K in T[number]['key']]: ChartConfig[string] };
}

export function singleSeriesConfig<K extends string>(
  key: K,
  label: string,
  color: string
): Record<K, ChartConfig[string]> {
  return {
    [key]: {
      label,
      colors: {
        light: [color],
        dark: [color],
      },
    },
  } as Record<K, ChartConfig[string]>;
}

export function formatChartDate(value: string, withYear = false): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(
    'en',
    withYear
      ? { month: 'short', day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric' }
  );
}
