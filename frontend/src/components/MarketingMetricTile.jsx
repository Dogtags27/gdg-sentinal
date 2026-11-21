import { TrendingDown, TrendingUp } from 'lucide-react';

/**
 * KPI tile styled like sentineldeskhq.com dashboard mock (−12% · 24 Open tickets).
 */
export default function MarketingMetricTile({ label, value, delta, deltaPositiveIsGood = true, suffix }) {
  const hasDelta = delta != null && delta !== '';
  const num = typeof delta === 'number' ? delta : parseFloat(String(delta).replace('%', ''));
  const up = !Number.isNaN(num) && num > 0;
  const good = deltaPositiveIsGood ? up : !up;
  const tone = !hasDelta ? 'text-ink-3' : good ? 'text-emerald-600' : 'text-amber-700';
  const Icon = up ? TrendingUp : TrendingDown;

  return (
    <div className="sentinel-metric-tile flex min-w-[140px] flex-1 flex-col rounded-lg border border-line bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <div className="mt-2 flex items-end gap-2">
        <span className="tabular text-[26px] font-semibold leading-none text-ink">{value}</span>
        {suffix && <span className="pb-0.5 text-[12px] text-ink-3">{suffix}</span>}
      </div>
      {hasDelta && (
        <p className={`mt-2 flex items-center gap-1 text-[11.5px] font-medium ${tone}`}>
          <Icon size={13} aria-hidden />
          {typeof delta === 'number' ? `${delta > 0 ? '+' : ''}${delta}%` : delta}
          <span className="font-normal text-ink-3">vs last hour</span>
        </p>
      )}
    </div>
  );
}