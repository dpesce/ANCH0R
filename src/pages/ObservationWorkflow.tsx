import { useEffect, useMemo, useState } from "react";
import {
  downloadCsv,
  formatDegrees,
  formatInteger,
  formatUtc,
  formatVelocity,
  parseUtcInput,
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

type TimeScale = "utc" | "local";
type SortKey =
  | "recommended"
  | "name"
  | "ra"
  | "dec"
  | "velocity"
  | "maxAltitude"
  | "riseUtc"
  | "setUtc";
type SortDirection = "asc" | "desc";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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

function targetMatchesNameSearch(target: Target, search: string): boolean {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }
  return (
    target.source_name.toLowerCase().includes(normalizedSearch) ||
    target.target_id.toLowerCase().includes(normalizedSearch)
  );
}

function formatDisplayUtc(date: Date | null): string {
  if (!date) {
    return "";
  }
  const year = date.getUTCFullYear();
  const month = MONTH_LABELS[date.getUTCMonth()];
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year} ${month} ${day} ${hours}:${minutes} UTC`;
}

function parseDateTimeInput(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day, hours, minutes] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hours: Number(hours),
    minutes: Number(minutes),
  };
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hours: Number(values.hour),
    minutes: Number(values.minute),
    seconds: Number(values.second),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getTimeZoneParts(date, timeZone);
  const equivalentUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hours,
    parts.minutes,
    parts.seconds,
  );
  return equivalentUtcMs - date.getTime();
}

function parseTelescopeLocalInput(value: string, timeZone: string): Date | null {
  const parts = parseDateTimeInput(value);
  if (!parts) {
    return null;
  }
  const wallTimeAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hours,
    parts.minutes,
    0,
  );
  let utcMs = wallTimeAsUtcMs - getTimeZoneOffsetMs(new Date(wallTimeAsUtcMs), timeZone);
  utcMs = wallTimeAsUtcMs - getTimeZoneOffsetMs(new Date(utcMs), timeZone);
  return new Date(utcMs);
}

function parseObservationTime(
  value: string,
  timeScale: TimeScale,
  timeZone: string,
): Date | null {
  if (!value) {
    return null;
  }
  if (timeScale === "utc") {
    const parsed = parseUtcInput(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return parseTelescopeLocalInput(value, timeZone);
}

function formatDateTimeInput(date: Date, timeScale: TimeScale, timeZone: string): string {
  if (timeScale === "utc") {
    return date.toISOString().slice(0, 16);
  }
  const parts = getTimeZoneParts(date, timeZone);
  const datePart = [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
  const timePart = `${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(
    2,
    "0",
  )}`;
  return `${datePart}T${timePart}`;
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
  const mapWidth = 760;
  const width = 806;
  const height = 320;
  const parallels = [-60, -30, 0, 30, 60];
  const meridians = [0, 60, 120, 180, 240, 300];

  function decLabel(decDeg: number) {
    return `${decDeg > 0 ? "+" : ""}${decDeg} deg`;
  }

  function raLabel(raDeg: number) {
    return `${raDeg / 15}h`;
  }

  return (
    <section className="sky-map-panel" aria-label="Selected target sky map">
      <div className="section-heading-row">
        <div>
          <h2>Sky Map</h2>
          <p>Selected targets are highlighted.</p>
        </div>
      </div>
      <svg className="sky-map" viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Sky map of current and selected targets</title>
        <ellipse
          className="sky-map-outline"
          cx={mapWidth / 2}
          cy={height / 2}
          rx={mapWidth / 2 - 16}
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
              mapWidth,
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
              mapWidth,
              height,
            )}
          />
        ))}
        {meridians.map((raDeg) => {
          const point = projectMollweide(raDeg, -66, mapWidth, height);
          return (
            <text
              className="sky-map-label sky-map-label--ra"
              key={`ra-label-${raDeg}`}
              textAnchor="middle"
              x={point.x}
              y={point.y}
            >
              {raLabel(raDeg)}
            </text>
          );
        })}
        {parallels.map((decDeg) => {
          const point = projectMollweide(0, decDeg, mapWidth, height);
          return (
            <text
              className="sky-map-label sky-map-label--dec"
              key={`dec-label-${decDeg}`}
              textAnchor="start"
              x={point.x + 8}
              y={point.y}
            >
              {decLabel(decDeg)}
            </text>
          );
        })}
        {results.map(({ target }) => {
          const point = projectMollweide(target.ra_deg, target.dec_deg, mapWidth, height);
          const selected = selectedIds.has(target.target_id);
          return (
            <circle
              className={selected ? "sky-map-point sky-map-point--selected" : "sky-map-point"}
              cx={point.x}
              cy={point.y}
              key={target.target_id}
              r={selected ? 3.6 : 1.4}
            />
          );
        })}
      </svg>
    </section>
  );
}

function TimeScaleToggle({
  timeScale,
  siteLabel,
  onChange,
}: {
  timeScale: TimeScale;
  siteLabel: string;
  onChange: (nextTimeScale: TimeScale) => void;
}) {
  return (
    <span className="time-scale-toggle" role="group" aria-label="Time scale">
      <button
        aria-pressed={timeScale === "utc"}
        className={timeScale === "utc" ? "time-scale-option active" : "time-scale-option"}
        onClick={() => onChange("utc")}
        title="Use UTC times"
        type="button"
      >
        UTC
      </button>
      <button
        aria-pressed={timeScale === "local"}
        className={timeScale === "local" ? "time-scale-option active" : "time-scale-option"}
        onClick={() => onChange("local")}
        title={`Use ${siteLabel} local times`}
        type="button"
      >
        Local
      </button>
    </span>
  );
}

export function PlanObservation({ catalog }: ObservationPageProps) {
  const [telescope, setTelescope] = useState<TelescopeCode>("GBT");
  const [timeScale, setTimeScale] = useState<TimeScale>("utc");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [minElevationDeg, setMinElevationDeg] = useState(25);
  const [minObservableMinutes, setMinObservableMinutes] = useState(30);
  const [maxResults, setMaxResults] = useState(50);
  const [targetSearch, setTargetSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("recommended");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const site = TELESCOPES[telescope];
  const windowStart = parseObservationTime(startTime, timeScale, site.timeZone);
  const windowEnd = parseObservationTime(endTime, timeScale, site.timeZone);
  const missingWindow = !windowStart || !windowEnd;
  const invalidWindow = Boolean(
    windowStart && windowEnd && windowEnd.getTime() <= windowStart.getTime(),
  );

  useEffect(() => {
    setSelectedIds(new Set());
  }, [
    endTime,
    maxResults,
    minElevationDeg,
    minObservableMinutes,
    startTime,
    targetSearch,
    telescope,
    timeScale,
  ]);

  const candidates = useMemo(() => {
    return catalog.targets.filter((target) => {
      return (
        target.eligible_telescopes.includes(telescope) &&
        target.status !== "observed" &&
        targetMatchesNameSearch(target, targetSearch)
      );
    });
  }, [catalog.targets, targetSearch, telescope]);

  const results = useMemo<PlannedTarget[]>(() => {
    if (!windowStart || !windowEnd || invalidWindow) {
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
      } else if (sortKey === "maxAltitude") {
        comparison = a.visibility.maxAltitudeDeg - b.visibility.maxAltitudeDeg;
      } else if (sortKey === "riseUtc") {
        comparison =
          (a.visibility.firstObservableUtc?.getTime() ?? Number.POSITIVE_INFINITY) -
          (b.visibility.firstObservableUtc?.getTime() ?? Number.POSITIVE_INFINITY);
      } else if (sortKey === "setUtc") {
        comparison =
          (a.visibility.lastObservableUtc?.getTime() ?? Number.POSITIVE_INFINITY) -
          (b.visibility.lastObservableUtc?.getTime() ?? Number.POSITIVE_INFINITY);
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
    missingWindow,
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
    const windowLabel = startTime ? startTime.replaceAll(":", "") : "selected-targets";
    const filename = `anch0r-${telescope.toLowerCase()}-${windowLabel}.csv`;
    downloadCsv(filename, selectedTargetRows(selectedResults, telescope));
  }

  function updateTimeScale(nextTimeScale: TimeScale) {
    if (nextTimeScale === timeScale) {
      return;
    }

    setStartTime(
      windowStart ? formatDateTimeInput(windowStart, nextTimeScale, site.timeZone) : startTime,
    );
    setEndTime(windowEnd ? formatDateTimeInput(windowEnd, nextTimeScale, site.timeZone) : endTime);
    setTimeScale(nextTimeScale);
  }

  return (
    <main className="page-shell page-block">
      <div className="page-heading">
        <p className="section-label">Observations</p>
        <h1>Plan an observation</h1>
        <p>
          Specify the filters relevant for your observation and then select objects from the table
          below. All objects that have not yet been observed and which satisfy the selection
          criteria will be shown. Once you have selected all the objects you wish to observe, you
          can export the list as a CSV file.
        </p>
      </div>

      <section className="selection-panel">
        <div className="section-heading-row">
          <div>
            <h2>Selected Targets</h2>
            <p>{formatInteger(selectedResults.length)} targets selected.</p>
          </div>
          <button
            className="button button-secondary"
            disabled={selectedResults.length === 0}
            onClick={exportSelectedTargets}
            type="button"
          >
            Download selected CSV
          </button>
        </div>

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
          <p className="subtle">Select targets from the table below.</p>
        )}
      </section>

      <SkyMap results={results} selectedIds={selectedIds} />

      <section className="target-filter-panel">
        <form className="planner-form target-filter-form">
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
            <span className="time-field-heading">
              Start time
              <TimeScaleToggle
                onChange={updateTimeScale}
                siteLabel={site.shortName}
                timeScale={timeScale}
              />
            </span>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </label>

          <label>
            End time
            <input
              type="datetime-local"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </label>

          <label>
            Search targets
            <input
              type="search"
              value={targetSearch}
              onChange={(event) => setTargetSearch(event.target.value)}
              placeholder="Target name"
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

      {missingWindow ? (
        <div className="empty-state">Enter a start time and end time to show matching targets.</div>
      ) : null}

      {invalidWindow ? (
        <div className="message-error">End time must be later than start time.</div>
      ) : null}

      <section className="results-heading">
        <div>
          <h2>Candidate Targets</h2>
          <p>
            Showing {formatInteger(results.length)} candidate targets above {minElevationDeg} deg
            for at least {formatInteger(minObservableMinutes)} minutes.
          </p>
        </div>
      </section>

      <div className="table-wrap">
        <table className="observation-table">
          <thead>
            <tr>
              <th>Select</th>
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
                  onClick={() => updateSort("maxAltitude")}
                >
                  {sortLabel("Max alt", "maxAltitude")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => updateSort("riseUtc")}
                >
                  {sortLabel("Rise time (UTC)", "riseUtc")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => updateSort("setUtc")}
                >
                  {sortLabel("Set time (UTC)", "setUtc")}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map(({ target, visibility }) => {
              const selected = selectedIds.has(target.target_id);
              return (
                <tr className={selected ? "selected-row" : ""} key={target.target_id}>
                  <td className="checkbox-cell">
                    <input
                      aria-label={`Select ${target.source_name}`}
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
                  <td>{formatDegrees(visibility.maxAltitudeDeg, 1)}</td>
                  <td>{formatDisplayUtc(visibility.firstObservableUtc) || "None"}</td>
                  <td>{formatDisplayUtc(visibility.lastObservableUtc) || "None"}</td>
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
