import { useMemo, useState } from "react";
import {
  downloadCsv,
  downloadText,
  formatDegrees,
  formatInteger,
  formatUtc,
  formatVelocity,
  parseUtcInput,
} from "../lib/format";
import { buildGbtCatalog } from "../lib/gbtCatalog";
import { TELESCOPES, TELESCOPE_CODES } from "../lib/telescopes";
import {
  evaluateVisibility,
  localSiderealTimeHours,
  type VisibilityResult,
} from "../lib/visibility";
import type { CatalogData, Target, TelescopeCode } from "../types";

interface ObservationPageProps {
  catalog: CatalogData;
}

interface PlannedTarget {
  target: Target;
  visibility: VisibilityResult;
}

type TimeScale = "utc" | "local";
type CatalogDownloadScope = TelescopeCode | "all" | "selected";
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

function formatSiderealTime(hours: number): string {
  const totalMinutes = Math.round(hours * 60) % (24 * 60);
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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

function plannedTargetRows(results: PlannedTarget[], telescope: TelescopeCode) {
  return results.map(({ target, visibility }) => ({
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

function availableTargetRows(targets: Target[]) {
  return targets.map((target) => ({
    target_id: target.target_id,
    source_name: target.source_name,
    ra_hms: target.ra_hms,
    dec_dms: target.dec_dms,
    velocity_km_s: formatVelocityValue(target.velocity_km_s),
    eligible_telescopes: target.eligible_telescopes.join("|"),
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
  targets,
  lstRange,
}: {
  targets: Target[];
  lstRange: string;
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
    <section className="sky-map-panel" aria-label="Displayed target sky map">
      <div className="section-heading-row">
        <div>
          <h2>Sky Map</h2>
          <p>{lstRange}</p>
        </div>
      </div>
      <svg className="sky-map" viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Sky map of targets in the displayed table</title>
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
        {targets.map((target) => {
          const point = projectMollweide(target.ra_deg, target.dec_deg, mapWidth, height);
          return (
            <circle
              className="sky-map-point"
              cx={point.x}
              cy={point.y}
              key={target.target_id}
              r={1.4}
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
  const [targetSearch, setTargetSearch] = useState("");
  const [catalogDownloadScope, setCatalogDownloadScope] =
    useState<CatalogDownloadScope>("selected");
  const [sortKey, setSortKey] = useState<SortKey>("recommended");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const site = TELESCOPES[telescope];
  const windowStart = parseObservationTime(startTime, timeScale, site.timeZone);
  const windowEnd = parseObservationTime(endTime, timeScale, site.timeZone);
  const missingWindow = !windowStart || !windowEnd;
  const invalidWindow = Boolean(
    windowStart && windowEnd && windowEnd.getTime() <= windowStart.getTime(),
  );

  const candidates = useMemo(() => {
    return catalog.targets.filter((target) => {
      return (
        target.eligible_telescopes.includes(telescope) &&
        target.status !== "observed"
      );
    });
  }, [catalog.targets, telescope]);

  const visibleResults = useMemo<PlannedTarget[]>(() => {
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

    return sorted;
  }, [
    candidates,
    invalidWindow,
    minElevationDeg,
    minObservableMinutes,
    missingWindow,
    site,
    sortDirection,
    sortKey,
    windowEnd,
    windowStart,
  ]);

  const results = useMemo(() => {
    return visibleResults.filter(({ target }) =>
      targetMatchesNameSearch(target, targetSearch),
    );
  }, [targetSearch, visibleResults]);

  const availableTargets = useMemo(
    () => catalog.targets.filter((target) => target.status !== "observed"),
    [catalog.targets],
  );

  const downloadTargets = useMemo(() => {
    if (catalogDownloadScope === "selected") {
      return results.map(({ target }) => target);
    }
    if (catalogDownloadScope === "all") {
      return availableTargets;
    }
    return availableTargets.filter((target) =>
      target.eligible_telescopes.includes(catalogDownloadScope),
    );
  }, [availableTargets, catalogDownloadScope, results]);

  const displayedTargets = useMemo(() => {
    if (catalogDownloadScope === "selected") {
      return results.map(({ target }) => target);
    }

    if (
      sortKey === "recommended" ||
      sortKey === "maxAltitude" ||
      sortKey === "riseUtc" ||
      sortKey === "setUtc"
    ) {
      return downloadTargets;
    }

    const direction = sortDirection === "asc" ? 1 : -1;
    return [...downloadTargets].sort((a, b) => {
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
  }, [catalogDownloadScope, downloadTargets, results, sortDirection, sortKey]);

  const showingFilteredTargets = catalogDownloadScope === "selected";

  const downloadUsesGbtFormat =
    catalogDownloadScope === "GBT" ||
    (catalogDownloadScope === "selected" && telescope === "GBT");

  const catalogDownloadError = useMemo(() => {
    if (!downloadUsesGbtFormat) {
      return null;
    }
    try {
      buildGbtCatalog(downloadTargets);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Unable to format GBT catalog";
    }
  }, [downloadTargets, downloadUsesGbtFormat]);

  const lstRange =
    windowStart && windowEnd && !invalidWindow
      ? `LST range at ${site.shortName}: ${formatSiderealTime(
          localSiderealTimeHours(windowStart, site),
        )} to ${formatSiderealTime(
          localSiderealTimeHours(windowEnd, site),
        )} (start to end).`
      : "Enter a valid observing window to calculate the LST range.";

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

  function exportCatalog() {
    if (catalogDownloadScope === "selected") {
      const windowLabel = startTime
        ? startTime.replaceAll(":", "")
        : "filtered-targets";
      if (telescope === "GBT") {
        downloadText(
          `anch0r-gbt-filtered-${windowLabel}.cat`,
          buildGbtCatalog(downloadTargets),
        );
        return;
      }

      downloadCsv(
        `anch0r-${telescope.toLowerCase()}-filtered-${windowLabel}.csv`,
        plannedTargetRows(results, telescope),
      );
      return;
    }

    if (catalogDownloadScope === "GBT") {
      downloadText(
        "anch0r-gbt-available.cat",
        buildGbtCatalog(downloadTargets),
      );
      return;
    }

    const scopeLabel =
      catalogDownloadScope === "all"
        ? "all"
        : catalogDownloadScope.toLowerCase();
    downloadCsv(
      `anch0r-${scopeLabel}-available.csv`,
      availableTargetRows(downloadTargets),
    );
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
          Specify the filters relevant for your observation. All objects that
          have not yet been observed and which satisfy the selection criteria
          will be shown in the table below. Download the filtered table or the
          latest complete catalog for any telescope.
        </p>
      </div>

      <SkyMap lstRange={lstRange} targets={displayedTargets} />

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
        </form>
      </section>

      {showingFilteredTargets && missingWindow ? (
        <div className="empty-state">Enter a start time and end time to show matching targets.</div>
      ) : null}

      {showingFilteredTargets && invalidWindow ? (
        <div className="message-error">End time must be later than start time.</div>
      ) : null}

      <section className="results-heading">
        <div>
          <h2>
            {showingFilteredTargets ? "Candidate Targets" : "Available Targets"}
          </h2>
          {showingFilteredTargets ? (
            <p>
              Showing {formatInteger(displayedTargets.length)} candidate{" "}
              {displayedTargets.length === 1 ? "target" : "targets"} above{" "}
              {minElevationDeg} deg for at least{" "}
              {formatInteger(minObservableMinutes)} minutes.
            </p>
          ) : (
            <p>
              Showing {formatInteger(displayedTargets.length)} unobserved{" "}
              {displayedTargets.length === 1 ? "target" : "targets"} from the
              selected complete catalog.
            </p>
          )}
        </div>
        <div className="catalog-download-controls">
          <label>
            Catalog download
            <select
              value={catalogDownloadScope}
              onChange={(event) =>
                setCatalogDownloadScope(
                  event.target.value as CatalogDownloadScope,
                )
              }
            >
              <option value="selected">Selected (filtered table)</option>
              <option value="GBT">GBT (all available)</option>
              <option value="EFF">Effelsberg (all available)</option>
              <option value="SRT">SRT (all available)</option>
              <option value="all">Everything (all available)</option>
            </select>
          </label>
          <button
            className="button button-secondary"
            disabled={
              downloadTargets.length === 0 || Boolean(catalogDownloadError)
            }
            onClick={exportCatalog}
            type="button"
          >
            Download catalog
          </button>
          <span className="catalog-download-meta">
            {formatInteger(downloadTargets.length)}{" "}
            {downloadTargets.length === 1 ? "target" : "targets"},{" "}
            {downloadUsesGbtFormat ? ".cat" : ".csv"} format
          </span>
        </div>
      </section>

      {catalogDownloadError ? (
        <div className="message-error">{catalogDownloadError}</div>
      ) : null}

      <div className="table-wrap">
        <table className="observation-table">
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
              {showingFilteredTargets ? (
                <>
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
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {showingFilteredTargets
              ? results.map(({ target, visibility }) => (
                  <tr key={target.target_id}>
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
                ))
              : displayedTargets.map((target) => (
                  <tr key={target.target_id}>
                    <td>
                      <strong>{target.source_name}</strong>
                    </td>
                    <td>{target.ra_hms}</td>
                    <td>{target.dec_dms}</td>
                    <td>{formatVelocity(target.velocity_km_s)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
        {displayedTargets.length === 0 ? (
          <div className="empty-state">No targets match this observing setup.</div>
        ) : null}
      </div>
    </main>
  );
}
