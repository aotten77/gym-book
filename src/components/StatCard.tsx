interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
}

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="rounded-3xl border border-white/10 bg-zinc-950/50 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">{value}</p>
      {hint ? <p className="mt-2 text-sm text-zinc-400">{hint}</p> : null}
    </div>
  );
}
