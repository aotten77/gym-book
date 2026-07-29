interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
}

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="rounded-panel border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-content-muted">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-content">{value}</p>
      {hint ? <p className="mt-2 text-sm text-content-muted">{hint}</p> : null}
    </div>
  );
}
