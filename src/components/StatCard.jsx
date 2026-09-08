export default function StatCard({ title, value, hint }) {
  return (
    <div className="stat-card">
      <div className="stat-card-title">{title}</div>
      <div className="stat-card-value">{value}</div>
      {hint && <div className="stat-card-hint">{hint}</div>}
    </div>
  );
}
