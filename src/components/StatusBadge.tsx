import type { TargetStatus } from "../types";

interface StatusBadgeProps {
  status: TargetStatus;
}

const LABELS: Record<TargetStatus, string> = {
  unobserved: "Unobserved",
  observed: "Observed",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${status}`}>{LABELS[status]}</span>;
}
