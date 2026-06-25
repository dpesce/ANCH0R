import { useMemo, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import { formatInteger, formatVelocity } from "../lib/format";
import { TELESCOPE_CODES, TELESCOPES } from "../lib/telescopes";
import type { CatalogData, Target, TargetStatus, TelescopeCode } from "../types";

interface MasterTableProps {
  catalog: CatalogData;
}

type TelescopeFilter = "all" | TelescopeCode;
type StatusFilter = "all" | TargetStatus;
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
    target.gbt_group,
    target.notes,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
}

export function MasterTable({ catalog }: MasterTableProps) {
  const [search, setSearch] = useState("");
  const [telescope, setTelescope] = useState<TelescopeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("catalog");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const filteredTargets = useMemo(() => {
    return catalog.targets.filter((target) => {
      const matchesTelescope =
        telescope === "all" || target.eligible_telescopes.includes(telescope);
      const matchesStatus = status === "all" || target.status === status;
      return matchesTelescope && matchesStatus && targetMatchesSearch(target, search);
    });
  }, [catalog.targets, search, status, telescope]);

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
            placeholder="Name, ID, group, velocity"
          />
        </label>

        <label>
          Telescope
          <select
            value={telescope}
            onChange={(event) => setTelescope(event.target.value as TelescopeFilter)}
          >
            <option value="all">All telescopes</option>
            {TELESCOPE_CODES.map((code) => (
              <option key={code} value={code}>
                {TELESCOPES[code].shortName}
              </option>
            ))}
          </select>
        </label>

        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="unobserved">Unobserved</option>
            <option value="observed">Observed</option>
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
              <th>Eligible</th>
              <th>Status</th>
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
                  <div className="badge-row">
                    {target.eligible_telescopes.map((code) => (
                      <span className="telescope-badge" key={code}>
                        {code}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <StatusBadge status={target.status} />
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
