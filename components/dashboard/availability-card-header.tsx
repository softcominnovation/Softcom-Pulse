export function AvailabilityCardHeader({ name, label, tone }: { name: string; label: string; tone: string }) {
  return <span className="availability-card-heading"><strong className="availability-name" title={name}>{name}</strong><span className={`availability-state status-pill tone-${tone}`} title={label}><i className="status-dot" aria-hidden="true" /><span className="availability-state-label">{label}</span></span></span>;
}
