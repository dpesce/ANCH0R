import { useEffect, useMemo, useState } from "react";
import {
  downloadCsv,
  formatDegrees,
  formatInteger,
  formatUtc,
  formatVelocity,
  parseUtcInput,
  toUtcInputValue,
} from "../lib/format";
import { TELESCOPES, TELESCOPE_CODES } from "../lib/telescopes";
import { evaluateVisibility, type VisibilityResult } from "../lib/visibility";
import type { CatalogData, Target, TelescopeCode } from "../types";

interface ObservationPageProps {
  catalog: CatalogData;
}

interface PlannedTarget {
  target: Target;
  visibility: VisibilityResult;
}

type ObservationMode = "plan" | "report";
type SortKey =
  | "recommended"
  | "name"
  | "ra"
  | "dec"
  | "velocity"
  | "observable"
  | "maxAltitude"
  | "bestUtc";
type SortDirection = "asc" | "desc";

const REPORT_EMAIL = "dpesce@cfa.harvard.edu";

function initialWindow() {
  const now = new Date();
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(start.getUTCHours() + 1);
  const end = new Date(start);
  end.setUTCHours(end.getUTCHours() + 8);
  return { start, end };
}

function compareRecommended(a: PlannedTarget, b: PlannedTarget): number {
  return (
    b.visibility.observableMinutes - a.visibility.observableMinutes ||
    b.visibility.maxAltitudeDeg - a.visibility.maxAltitudeDeg ||
    a.target.ra_hours - b.target.ra_hours
  );
}

function formatVelocityValue(value: number): number {
  return Math.round(value);
}

function selectedTargetRows(selectedResults: PlannedTarget[], telescope: TelescopeCode) {
  return selectedResults.map(({ target, visibility }) => ({
    target_id: target.target_id,
    source_name: target.source_name,
    ra_hms: target.ra_hms,
    dec_dms: target.dec_dms,
    velocity_km_s: formatVelocityValue(target.velocity_km_s),
    telescope,
    observable_minutes: visibility.observableMinutes,
    max_altitude_deg: visibility.maxAltitudeDeg.toFixed(1),
    max_altitude_utc: formatUtc(visibility.maxAltitudeUtc),
    first_observable_utc: formatUtc(visibility.firstObservableUtc),
    last_observable_utc: formatUtc(visibility.lastObservableUtc),
  }));
}

function buildReportBody(
  selectedResults: PlannedTarget[],
  telescope: TelescopeCode,
  startUtc: string,
  endUtc: string,
  notes: string,
) {
  const rows = selectedTargetRows(selectedResults, telescope)
    .map((row) => {
      return [
        row.source_name,
        `RA ${row.ra_hms}`,
        `Dec ${row.dec_dms}`,
        `${row.velocity_km_s} km/s`,
        `${row.observable_minutes} min observable`,
        `max alt ${row.max_altitude_deg} deg`,
      ].join(" | ");
    })
    .join("\n");

  return [
    "ANCH0R observing report",
    "",
    `Telescope: ${telescope}`,
    `UTC window: ${startUtc} to ${endUtc}`,
    "",
    "Selected targets:",
    rows || "No targets selected.",
    "",
    "Notes:",
    notes || "(none)",
  ].join("\n");
}

function projectMollweide(raDeg: number, decDeg: number, width: number, height: number) {
  const padding = 16;
  const lambda = ((((raDeg - 180 + 540) % 360) - 180) * Math.PI) / 180;
  const phi = (decDeg * Math.PI) / 180;
  let theta = phi;

  if (Math.abs(Math.abs(phi) - Math.PI / 2) > 1e-8) {
    for (let index = 0; index < 10; index += 1) {
      const numerator = 2 * theta + Math.sin(2 * theta) - Math.PI * Math.sin(phi);
      const denominator = 2 + 2 * Math.cos(2 * theta);
      theta -= numerator / denominator;
    }
  }

  const x = (2 * Math.SQRT2 * lambda * Math.cos(theta)) / Math.PI;
  const y = Math.SQRT2 * Math.sin(theta);
  const scaleX = (width - 2 * padding) / (4 * Math.SQRT2);
  const scaleY = (height - 2 * padding) / (2 * Math.SQRT2);

  return {
    x: width / 2 - x * scaleX,
    y: height / 2 - y * scaleY,
  };
}

function polylineForGrid(
  points: Array<{ raDeg: number; decDeg: number }>,
  width: number,
  height: number,
) {
  return points
    .map((point) => {
      const projected = projectMollweide(point.raDeg, point.decDeg, width, height);
      return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
    })
    .join(" ");
}

function SkyMap({
  results,
  selectedIds,
}: {
  results: PlannedTarget[];
  selectedIds: Set<string>;
}) {
  const width = 760;
  const height = 320;
  const parallels = [-60, -30, 0, 30, 60];
  const meridians = [0, 60, 120, 180, 240, 300];

  function decLabel(decDeg: number) {
    return `${decDeg > 0 ? "+" : ""}${decDeg} deg`;
  }

  return (
    <section className="sky-map-panel" aria-label="Selected target sky map">
      <div className="section-heading-row">
        <div>
          <h2>Sky Map</h2>
          <p>Mollweide projection of the current target list. Selected targets are highlighted.</p>
        </div>
      </div>
      <svg className="sky-map" viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Sky map of current and selected targets</title>
        <ellipse
          className="sky-map-outline"
          cx={width / 2}
          cy={height / 2}
          rx={width / 2 - 16}
          ry={height / 2 - 16}
        />
        {parallels.map((decDeg) => (
          <polyline
            className="sky-map-grid"
            key={`parallel-${decDeg}`}
            points={polylineForGrid(
              Array.from({ length: 73 }, (_, index) => ({
                raDeg: index * 5,
                decDeg,
              })),
              width,
              height,
            )}
          />
        ))}
        {meridians.map((raDeg) => (
          <polyline
            className="sky-map-grid"
            key={`meridian-${raDeg}`}
            points={polylineForGrid(
              Array.from({ length: 37 }, (_, index) => ({
                raDeg,
                decDeg: -90 + index * 5,
              })),
              width,
              height,
            )}
          />
        ))}
        {meridians.map((raDeg) => {
          const point = projectMollweide(raDeg, -74, width, height);
          return (
            <text
              className="sky-map-label"
              key={`ra-label-${raDeg}`}
              textAnchor="middle"
              x={point.x}
              y={point.y + 12}
            >
              {raDeg / 15}h
            </text>
          );
        })}
        {parallels.map((decDeg) => {
          const point = projectMollweide(5, decDeg, width, height);
          return (
            <text
              className="sky-map-label"
              key={`dec-label-${decDeg}`}
              textAnchor="end"
              x={point.x - 8}
              y={point.y + 4}
            >
              {decLabel(decDeg)}
            </text>
          );
        })}
        {results.map(({ target }) => {
          const point = projectMollweide(target.ra_deg, target.dec_deg, width, height);
          const selected = selectedIds.has(target.target_id);
          return (
            <circle
              className={selected ? "sky-map-point sky-map-point--selected" : "sky-map-point"}
              cx={point.x}
              cy={point.y}
              key={target.target_id}
              r={selected ? 5.5 : 1.4}
            />
          );
        })}
      </svg>
    </section>
  );
}

function ObservationWorkflow({ catalog, mode }: ObservationPageProps & { mode: ObservationMode }) {
  const defaults = useMemo(() => initialWindow(), []);
  const [telescope, setTelescope] = useState<TelescopeCode>("GBT");
  const [startUtc, setStartUtc] = useState(toUtcInputValue(defaults.start));
  const [endUtc, setEndUtc] = useState(toUtcInputValue(defaults.end));
  const [minElevationDeg, setMinElevationDeg] = useState(25);
  const [minObservableMinutes, setMinObservableMinutes] = useState(30);
  const [maxResults, setMaxResults] = useState(50);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("recommended");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [notes, setNotes] = useState("");

  const site = TELESCOPES[telescope];
  const windowStart = parseUtcInput(startUtc);
  const windowEnd = parseUtcInput(endUtc);
  const invalidWindow = windowEnd.getTime() <= windowStart.getTime();

  useEffect(() => {
    setSelectedIds(new Set());
  }, [endUtc, maxResults, minElevationDeg, minObservableMinutes, startUtc, telescope]);

  const candidates = useMemo(() => {
    return catalog.targets.filter((target) => {
      return target.eligible_telescopes.includes(telescope) && target.status !== "observed";
    });
  }, [catalog.targets, telescope]);

  const results = useMemo<PlannedTarget[]>(() => {
    if (invalidWindow) {
      return [];
    }

    const visibleResults = candidates
      .map((target) => {
        const visibility = evaluateVisibility(
          target,
          site,
          { startUtc: windowStart, endUtc: windowEnd },
          minElevationDeg,
          10,
        );
        return visibility ? { target, visibility } : null;
      })
      .filter((result): result is PlannedTarget => {
        return Boolean(result && result.visibility.observableMinutes >= minObservableMinutes);
      });

    const direction = sortDirection === "asc" ? 1 : -1;
    const sorted = [...visibleResults].sort((a, b) => {
      if (sortKey === "recommended") {
        return compareRecommended(a, b);
      }

      let comparison = 0;
      if (sortKey === "name") {
        comparison = a.target.source_name.localeCompare(b.target.source_name);
      } else if (sortKey === "ra") {
        comparison = a.target.ra_hours - b.target.ra_hours;
      } else if (sortKey === "dec") {
        comparison = a.target.dec_deg - b.target.dec_deg;
      } else if (sortKey === "velocity") {
        comparison = a.target.velocity_km_s - b.target.velocity_km_s;
      } else if (sortKey === "observable") {
        comparison = a.visibility.observableMinutes - b.visibility.observableMinutes;
      } else if (sortKey === "maxAltitude") {
        comparison = a.visibility.maxAltitudeDeg - b.visibility.maxAltitudeDeg;
      } else if (sortKey === "bestUtc") {
        comparison =
          a.visibility.maxAltitudeUtc.getTime() - b.visibility.maxAltitudeUtc.getTime();
      }

      return comparison * direction || a.target.source_name.localeCompare(b.target.source_name);
    });

    return sorted.slice(0, maxResults);
  }, [
    candidates,
    invalidWindow,
    maxResults,
    minElevationDeg,
    minObservableMinutes,
    site,
    sortDirection,
    sortKey,
    windowEnd,
    windowStart,
  ]);

  const selectedResults = useMemo(() => {
    return results.filter(({ target }) => selectedIds.has(target.target_id));
  }, [results, selectedIds]);

  function updateSort(nextSortKey: SortKey) {
    if (sortKey === nextSortKey && nextSortKey !== "recommended") {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection("asc");
  }

  function sortLabel(label: string, key: SortKey) {
    if (sortKey !== key) {
      return label;
    }
    if (key === "recommended") {
      return `${label} (ranked)`;
    }
    return `${label} (${sortDirection === "asc" ? "asc" : "desc"})`;
  }

  function toggleSelection(targetId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(targetId)) {
        next.delete(targetId);
      } else {
        next.add(targetId);
      }
      return next;
    });
  }

  function exportSelectedTargets() {
    const filename = `anch0r-${telescope.toLowerCase()}-${startUtc.replaceAll(":", "")}.csv`;
    downloadCsv(filename, selectedTargetRows(selectedResults, telescope));
  }

  function submitReport() {
    const subject = `ANCH0R observing report: ${telescope} ${startUtc}`;
    const body = buildReportBody(selectedResults, telescope, startUtc, endUtc, notes);
    window.location.href = `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
  }

  const title = mode === "plan" ? "Plan an observation" : "Submit an observing report";
  const description =
    mode === "plan"
      ? "Find unobserved targets visible during a UTC observing window. The telescope filter uses the internal eligibility list from the master catalog."
      : "Select the targets actually observed during a run, add any notes, and generate an observing report email.";
  const actionLabel = mode === "plan" ? "Download selected CSV" : "Submit report";
  const action = mode === "plan" ? exportSelectedTargets : submitReport;
  const selectedTitle = mode === "plan" ? "Selected Targets" : "Observed Targets";
  const emptySelectionText =
    mode === "plan" ? "Select targets from the table below." : "Check the targets observed during this run.";
  const tableTitle = mode === "plan" ? "Candidate Targets" : "Observed Targets";
  const tableSummary =
    mode === "plan"
      ? `Showing ${formatInteger(results.length)} candidate targets above ${minElevationDeg} deg for at least ${formatInteger(minObservableMinutes)} minutes.`
      : `Showing ${formatInteger(results.length)} targets matching this observing setup; check the sources that were actually observed.`;
  const selectionColumnLabel = mode === "plan" ? "Select" : "Observed";

  return (
    <main className="page-shell page-block">
      <div className="page-heading">
        <p className="section-label">Observations</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>

      <section className="planner-layout">
        <form className="planner-form">
          <label>
            Telescope
            <select
              value={telescope}
              onChange={(event) => setTelescope(event.target.value as TelescopeCode)}
            >
              {TELESCOPE_CODES.map((code) => (
                <option key={code} value={code}>
                  {TELESCOPES[code].label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Start UTC
            <input
              type="datetime-local"
              value={startUtc}
              onChange={(event) => setStartUtc(event.target.value)}
            />
          </label>

          <label>
            End UTC
            <input
              type="datetime-local"
              value={endUtc}
              onChange={(event) => setEndUtc(event.target.value)}
            />
          </label>

          <label>
            Minimum elevation
            <input
              type="number"
              min={0}
              max={80}
              value={minElevationDeg}
              onChange={(event) => setMinElevationDeg(Number(event.target.value))}
            />
          </label>

          <label>
            Minimum observable minutes
            <input
              type="number"
              min={0}
              step={10}
              value={minObservableMinutes}
              onChange={(event) => setMinObservableMinutes(Number(event.target.value))}
            />
          </label>

          <label>
            Maximum results
            <input
              type="number"
              min={10}
              step={10}
              value={maxResults}
              onChange={(event) => setMaxResults(Number(event.target.value))}
            />
          </label>
        </form>
      </section>

      {invalidWindow ? (
        <div className="message-error">End UTC must be later than Start UTC.</div>
      ) : null}

      <section className="selection-panel">
        <div className="section-heading-row">
          <div>
            <h2>{selectedTitle}</h2>
            <p>{formatInteger(selectedResults.length)} targets selected.</p>
          </div>
          <button
            className="button button-secondary"
            disabled={selectedResults.length === 0}
            onClick={action}
            type="button"
          >
            {actionLabel}
          </button>
        </div>

        {mode === "report" ? (
          <label className="notes-field">
            Notes
            <textarea
              rows={5}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Add observing notes to include in the email report."
            />
          </label>
        ) : null}

        {selectedResults.length > 0 ? (
          <div className="selected-list">
            {selectedResults.map(({ target }) => (
              <button
                className="selected-chip"
                key={target.target_id}
                onClick={() => toggleSelection(target.target_id)}
                type="button"
              >
                {target.source_name} x
              </button>
            ))}
          </div>
        ) : (
          <p className="subtle">{emptySelectionText}</p>
        )}
      </section>

      {mode === "plan" ? <SkyMap results={results} selectedIds={selectedIds} /> : null}

      <section className="results-heading">
        <div>
          <h2>{tableTitle}</h2>
          <p>{tableSummary}</p>
        </div>
      </section>

      <div className="table-wrap">
        <table className="observation-table">
          <thead>
            <tr>
              <th>{selectionColumnLabel}</th>
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
              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => updateSort("observable")}
                >
                  {sortLabel("Observable", "observable")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => updateSort("maxAltitude")}
                >
                  {sortLabel("Max Alt", "maxAltitude")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => updateSort("bestUtc")}
                >
                  {sortLabel("Best UTC", "bestUtc")}
                </button>
              </th>
              <th>Window UTC</th>
            </tr>
          </thead>
          <tbody>
            {results.map(({ target, visibility }) => {
              const selected = selectedIds.has(target.target_id);
              return (
                <tr className={selected ? "selected-row" : ""} key={target.target_id}>
                  <td className="checkbox-cell">
                    <input
                      aria-label={`${selectionColumnLabel} ${target.source_name}`}
                      checked={selected}
                      className="target-checkbox"
                      onChange={() => toggleSelection(target.target_id)}
                      type="checkbox"
                    />
                  </td>
                  <td>
                    <strong>{target.source_name}</strong>
                  </td>
                  <td>{target.ra_hms}</td>
                  <td>{target.dec_dms}</td>
                  <td>{formatVelocity(target.velocity_km_s)}</td>
                  <td>{formatInteger(visibility.observableMinutes)} min</td>
                  <td>{formatDegrees(visibility.maxAltitudeDeg, 1)}</td>
                  <td>{formatUtc(visibility.maxAltitudeUtc)}</td>
                  <td>
                    {formatUtc(visibility.firstObservableUtc)} to{" "}
                    {formatUtc(visibility.lastObservableUtc)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {results.length === 0 ? (
          <div className="empty-state">No targets match this observing setup.</div>
        ) : null}
      </div>
    </main>
  );
}

export function PlanObservation({ catalog }: ObservationPageProps) {
  return <ObservationWorkflow catalog={catalog} mode="plan" />;
}

export function SubmitObservingReport({ catalog }: ObservationPageProps) {
  return <ObservationWorkflow catalog={catalog} mode="report" />;
}
