export default function MetricCard({ label, value, color }) {
  return (
    <div className="bg-surface-alt rounded-md p-3">
      <div className="text-xs text-ink-secondary">{label}</div>
      <div className={`text-xl font-semibold ${color || "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}
