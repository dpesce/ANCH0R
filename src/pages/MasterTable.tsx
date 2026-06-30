import { useMemo, useState } from "react";
import { DetectionBadge } from "../components/DetectionBadge";
import { StatusBadge } from "../components/StatusBadge";
import { formatInteger, formatVelocity } from "../lib/format";
import { TELESCOPE_CODES } from "../lib/telescopes";
import type {
  CatalogData,
  DetectionStatus,
  Target,
  TelescopeCode,
} from "../types";

interface MasterTableProps {
  catalog: CatalogData;
}

type ObservationStatusFilter =
  | "all"
  | "unobserved"
  | "observed"
  | `observed:${TelescopeCode}`;
type DetectionStatusFilter =
  | "all"
  | "detected-or-marginal"
  | DetectionStatus;
type SortKey = "catalog" | "name" | "ra" | "dec" | "velocity";
type SortDirection = "asc" | "desc";

function targetMatchesSearch(target: Target, search: string): boolean {
  if (!search) {
    return true;
  }

  const haystack = [
    target.target_id,
    target.source_name,
    target.ra_hms,
    target.dec_dms,
    target.velocity_km_s.toString(),
    target.detection_status,
    target.notes,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
}

function observedTelescopesForTarget(
  target: Target,
  observedTelescopesByTarget: Map<string, TelescopeCode[]>,
): TelescopeCode[] {
  return (
    observedTelescopesByTarget.get(target.target_id) ??
    (target.assigned_telescope ? [target.assigned_telescope] : [])
  );
}

function observedStatusLabel(
  target: Target,
  observedTelescopesByTarget: Map<string, TelescopeCode[]>,
): string {
  const telescopes = observedTelescopesForTarget(target, observedTelescopesByTarget);
  return telescopes.length > 0 ? `Observed with: ${telescopes.join(", ")}` : "Observed";
}

function targetMatchesStatus(
  target: Target,
  status: ObservationStatusFilter,
  observedTelescopesByTarget: Map<string, TelescopeCode[]>,
): boolean {
  if (status === "all") {
    return true;
  }

  if (status === "unobserved" || status === "observed") {
    return target.status === status;
  }

  const telescope = status.replace("observed:", "") as TelescopeCode;
  return (
    target.status === "observed" &&
    observedTelescopesForTarget(target, observedTelescopesByTarget).includes(telescope)
  );
}

function targetMatchesDetectionStatus(
  target: Target,
  status: DetectionStatusFilter,
): boolean {
  if (status === "all") {
    return true;
  }
  if (status === "detected-or-marginal") {
    return (
      target.detection_status === "detected" ||
      target.detection_status === "marginal"
    );
  }
  return target.detection_status === status;
}

export function MasterTable({ catalog }: MasterTableProps) {
  const [search, setSearch] = useState("");
  const [observationStatus, setObservationStatus] =
    useState<ObservationStatusFilter>("all");
  const [detectionStatus, setDetectionStatus] =
    useState<DetectionStatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("catalog");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const observedTelescopesByTarget = useMemo(() => {
    const observed = new Map<string, TelescopeCode[]>();
    for (const observation of catalog.observations) {
      if (observation.status !== "observed") {
        continue;
      }
      const telescopes = observed.get(observation.target_id) ?? [];
      if (!telescopes.includes(observation.telescope)) {
        telescopes.push(observation.telescope);
      }
      observed.set(observation.target_id, telescopes);
    }
    return observed;
  }, [catalog.observations]);

  const filteredTargets = useMemo(() => {
    return catalog.targets.filter((target) => {
      return (
        targetMatchesStatus(target, observationStatus, observedTelescopesByTarget) &&
        targetMatchesDetectionStatus(target, detectionStatus) &&
        targetMatchesSearch(target, search)
      );
    });
  }, [
    catalog.targets,
    detectionStatus,
    observationStatus,
    observedTelescopesByTarget,
    search,
  ]);

  const sortedTargets = useMemo(() => {
    if (sortKey === "catalog") {
      return filteredTargets;
    }

    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filteredTargets].sort((a, b) => {
      let comparison = 0;
      if (sortKey === "name") {
        comparison = a.source_name.localeCompare(b.source_name);
      } else if (sortKey === "ra") {
        comparison = a.ra_hours - b.ra_hours;
      } else if (sortKey === "dec") {
        comparison = a.dec_deg - b.dec_deg;
      } else if (sortKey === "velocity") {
        comparison = a.velocity_km_s - b.velocity_km_s;
      }

      return comparison * direction || a.source_name.localeCompare(b.source_name);
    });
  }, [filteredTargets, sortDirection, sortKey]);

  function updateSort(nextSortKey: SortKey) {
    if (sortKey === nextSortKey) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection("asc");
  }

  function sortLabel(label: string, key: SortKey) {
    const directionLabel = sortDirection === "asc" ? "asc" : "desc";
    return sortKey === key ? `${label} (${directionLabel})` : label;
  }

  return (
    <main className="page-shell page-block">
      <div className="page-heading">
        <h1>Targets</h1>
        <p>Search the master galaxy catalog and observation status.</p>
      </div>

      <section className="toolbar" aria-label="Master table filters">
        <label>
          Search
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or velocity"
          />
        </label>

        <label>
          Observation status
          <select
            value={observationStatus}
            onChange={(event) =>
              setObservationStatus(event.target.value as ObservationStatusFilter)
            }
          >
            <option value="all">All statuses</option>
            <option value="unobserved">Unobserved</option>
            <option value="observed">All observed</option>
            {TELESCOPE_CODES.map((code) => (
              <option key={code} value={`observed:${code}`}>
                Observed with: {code}
              </option>
            ))}
          </select>
        </label>

        <label>
          Detection status
          <select
            value={detectionStatus}
            onChange={(event) =>
              setDetectionStatus(event.target.value as DetectionStatusFilter)
            }
          >
            <option value="all">All detection statuses</option>
            <option value="detected-or-marginal">Detected + marginal</option>
            <option value="detected">Detected</option>
            <option value="marginal">Marginal</option>
            <option value="undetected">Undetected</option>
          </select>
        </label>

        <div className="toolbar-count">
          <strong>{formatInteger(sortedTargets.length)}</strong>
          <span>matching targets</span>
        </div>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <button type="button" className="sort-button" onClick={() => updateSort("name")}>
                  {sortLabel("Target", "name")}
                </button>
              </th>
              <th>
                <button type="button" className="sort-button" onClick={() => updateSort("ra")}>
                  {sortLabel("RA", "ra")}
                </button>
              </th>
              <th>
                <button type="button" className="sort-button" onClick={() => updateSort("dec")}>
                  {sortLabel("Dec", "dec")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => updateSort("velocity")}
                >
                  {sortLabel("Velocity", "velocity")}
                </button>
              </th>
              <th>Observation status</th>
              <th>Detection status</th>
              <th>Spectrum</th>
            </tr>
          </thead>
          <tbody>
            {sortedTargets.map((target) => (
              <tr key={target.target_id}>
                <td>
                  <strong>{target.source_name}</strong>
                </td>
                <td>{target.ra_hms}</td>
                <td>{target.dec_dms}</td>
                <td>{formatVelocity(target.velocity_km_s)}</td>
                <td>
                  {target.status === "observed" ? (
                    <span className="status-badge status-badge--observed">
                      {observedStatusLabel(target, observedTelescopesByTarget)}
                    </span>
                  ) : (
                    <StatusBadge status={target.status} />
                  )}
                </td>
                <td>
                  <DetectionBadge status={target.detection_status} />
                </td>
                <td>
                  {target.spectrum_url ? (
                    <a href={target.spectrum_url} target="_blank" rel="noreferrer">
                      View
                    </a>
                  ) : (
                    <span className="subtle">None</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sortedTargets.length === 0 ? (
          <div className="empty-state">No targets match the selected filters.</div>
        ) : null}
      </div>
    </main>
  );
}
