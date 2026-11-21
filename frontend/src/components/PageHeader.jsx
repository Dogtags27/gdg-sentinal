/**
 * Page hero — mirrors app.sentineldesk.io / marketing hierarchy (eyebrow → title → lede).
 * Reference: https://www.sentineldeskhq.com/
 */

export default function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="sentinel-page-header">
      {eyebrow && <p className="text-[11.5px] font-semibold uppercase tracking-wide text-brand-700">{eyebrow}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink md:text-[24px]">{title}</h1>
        {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
      </div>
      {description && <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink-2">{description}</p>}
    </header>
  );
}