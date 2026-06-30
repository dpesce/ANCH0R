import type { DetectionStatus } from "../types";

interface DetectionBadgeProps {
  status: DetectionStatus | "";
}

const LABELS: Record<DetectionStatus, string> = {
  detected: "Detected",
  marginal: "Marginal",
  undetected: "Undetected",
};

export function DetectionBadge({ status }: DetectionBadgeProps) {
  if (!status) {
    return <span className="subtle">Not assessed</span>;
  }

  return (
    <span className={`detection-badge detection-badge--${status}`}>
      {LABELS[status]}
    </span>
  );
}
