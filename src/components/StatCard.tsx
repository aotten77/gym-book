interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
}

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="rounded-panel border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-content-muted">{label}</p>
      {/* Zahlen in der Display-Schrift: sie sind hier der Inhalt, nicht die Beschriftung. */}
      <p className="mt-3 font-display text-2xl font-bold tabular-nums tracking-tight text-content">
        {value}
      </p>
      {hint ? <p className="mt-2 text-sm text-content-muted">{hint}</p> : null}
    </div>
  );
}
