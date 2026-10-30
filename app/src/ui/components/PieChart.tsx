import React from 'react';
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useTheme } from '../theme';

interface DataItem {
  name: string;
  value: number;
}

interface PieChartProps {
  data: DataItem[];
  title?: string;
  height?: number;
  className?: string;
  /** Privacy mode: show shares only, never amounts. */
  hideValues?: boolean;
}

const COLORS = [
  '#3867D6',
  '#48BB78',
  '#F59E0B',
  '#E53E3E',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#0EA5E9',
  '#6366F1',
  '#EF4444',
];

export const PieChart: React.FC<PieChartProps> = ({
  data,
  title,
  height = 200,
  className,
  hideValues = false,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const tooltipBg     = isDark ? '#1f2937' : '#ffffff';
  const tooltipBorder = isDark ? '#374151' : '#e5e7eb';
  const tooltipText   = isDark ? '#f9fafb' : '#111827';
  const tooltipSub    = isDark ? '#d1d5db' : '#374151';
  const tooltipMuted  = isDark ? '#9ca3af' : '#6b7280';

  const filteredData = data.filter(item => item.value > 0);

  if (filteredData.length === 0) {
    return (
      <div className={`flex items-center justify-center py-10 ${className ?? ''}`}>
        <p className="text-neutral-500 dark:text-neutral-400">No data available</p>
      </div>
    );
  }

  const total = filteredData.reduce((sum, d) => sum + d.value, 0);

  interface PieTooltipEntry {
    payload: { name: string; value: number };
  }

  interface PieTooltipProps {
    active?: boolean;
    payload?: PieTooltipEntry[];
  }

  const CustomTooltip = ({ active, payload }: PieTooltipProps) => {
    if (!active || !payload?.length) return null;
    const item = payload[0].payload;
    return (
      <div style={{
        background: tooltipBg,
        border: `1px solid ${tooltipBorder}`,
        borderRadius: 6,
        padding: '10px 14px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        maxWidth: 220,
      }}>
        <p style={{ margin: 0, fontWeight: 600, color: tooltipText, fontSize: 14 }}>{item.name}</p>
        {!hideValues && (
          <p style={{ margin: '4px 0 0', color: tooltipSub, fontSize: 13 }}>
            ₹{item.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </p>
        )}
        <p style={{ margin: '2px 0 0', color: tooltipMuted, fontSize: 12 }}>
          {((item.value / total) * 100).toFixed(1)}%
        </p>
      </div>
    );
  };

  interface PieLabelProps {
    cx: number;
    cy: number;
    midAngle: number;
    innerRadius: number;
    outerRadius: number;
    percent: number;
  }

  const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: PieLabelProps) => {
    if (percent < 0.06) return null;
    const RADIAN = Math.PI / 180;
    const r = innerRadius + (outerRadius - innerRadius) * 0.55;
    const x = cx + r * Math.cos(-midAngle * RADIAN);
    const y = cy + r * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <div className={className ?? ''}>
      {title && (
        <h3 className="text-base font-medium text-neutral-900 dark:text-neutral-100 mb-4">{title}</h3>
      )}

      {/* Chart — no Legend inside so Recharts never reserves internal space for it */}
      <ResponsiveContainer width="100%" height={height}>
        <RechartsPieChart>
          <Pie
            data={filteredData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius="80%"
            labelLine={false}
            label={renderLabel}
          >
            {filteredData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} wrapperStyle={{ outline: 'none' }} />
        </RechartsPieChart>
      </ResponsiveContainer>

      {/* Legend rendered as plain HTML below the chart — never clipped or overlapping */}
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-3 px-2">
        {filteredData.map((entry, index) => (
          <li key={`legend-${index}`} className="flex items-center gap-1.5 min-w-0">
            <span
              className="shrink-0 w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            />
            <span
              className="text-xs text-neutral-700 dark:text-neutral-300 truncate max-w-[130px]"
              title={entry.name}
            >
              {entry.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};