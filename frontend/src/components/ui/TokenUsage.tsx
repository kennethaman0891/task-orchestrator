'use client';

import { useTheme } from '@/contexts/ThemeContext';
import type { TokenUsage } from '@/types';
import { formatTokens, formatCost, cleanModel } from '@/lib/format';

interface Props {
  usage: TokenUsage | null;
}

/** Token usage summary — per-model totals with cost. */
export function TokenUsageView({ usage }: Props) {
  const { theme: t } = useTheme();

  if (!usage) {
    return (
      <div style={{ fontSize: t.fontSize.xs, color: t.colors.text.muted }}>
        No token usage data yet
      </div>
    );
  }

  const models = Object.entries(usage.by_model || {});
  const inputTotal = usage.totals?.tokens_input ?? 0;
  const outputTotal = usage.totals?.tokens_output ?? 0;
  const totalCost = usage.total_cost ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: t.spacing.sm }}>
      {/* Totals row */}
      <div style={{ display: 'flex', gap: t.spacing.md, fontSize: t.fontSize.xs }}>
        <div>
          <span style={{ color: t.colors.text.muted }}>In </span>
          <span style={{ color: t.colors.text.primary, fontFamily: t.fontFamily.mono }}>{formatTokens(inputTotal)}</span>
        </div>
        <div>
          <span style={{ color: t.colors.text.muted }}>Out </span>
          <span style={{ color: t.colors.text.primary, fontFamily: t.fontFamily.mono }}>{formatTokens(outputTotal)}</span>
        </div>
        <div>
          <span style={{ color: t.colors.text.muted }}>Cost </span>
          <span style={{ color: t.colors.success.primary, fontFamily: t.fontFamily.mono }}>
            {totalCost === 0 ? '$0.00' : formatCost(totalCost)}
          </span>
        </div>
      </div>

      {/* Per-model list */}
      {models.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.spacing.xs }}>
          {models.slice(0, 6).map(([model, m]) => (
            <div key={model} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: t.fontSize.xxs }}>
                <span style={{ color: t.colors.accent.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cleanModel(model) || model}
                </span>
                <span style={{ color: t.colors.text.secondary, fontFamily: t.fontFamily.mono, flexShrink: 0 }}>
                  {formatTokens((m.tokens_input || 0) + (m.tokens_output || 0))}
                  {m.cost ? ` · $${m.cost.toFixed(3)}` : ''}
                </span>
              </div>
              {/* Usage bar */}
              <div style={{ height: 3, background: t.colors.bg.tertiary, borderRadius: 1, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, ((m.tokens_input || 0) + (m.tokens_output || 0)) / 200000 * 100)}%`,
                    background: t.colors.accent.primary,
                    opacity: 0.6,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}