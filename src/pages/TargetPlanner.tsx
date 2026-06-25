import { useMemo, useState } from "react";
import {
  downloadCsv,
  formatDegrees,
  formatInteger,
  formatUtc,
  parseUtcInput,
  toUtcInputValue,
} from "../lib/format";
import { TELESCOPES, TELESCOPE_CODES } from "../lib/telescopes";
import { evaluateVisibility, type VisibilityResult } from "../lib/visibility";
import type { CatalogData, Target, TelescopeCode } from "../types";

interface TargetPlannerProps {
  catalog: CatalogData;
}

interface PlannedTarget {
  target: Target;
  visibility: VisibilityResult;
}

function initialWindow() {
  const now = new Date();
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(start.getUTCHours() + 1);
  const end = new Date(start);
  end.setUTCHours(end.getUTCHours() + 8);
  return { start, end };
}

export function TargetPlanner({ catalog }: TargetPlannerProps) {
  const defaults = useMemo(() => initialWindow(), []);
  const [telescope, setTelescope] = useState<TelescopeCode>("GBT");
  const [startUtc, setStartUtc] = useState(toUtcInputValue(defaults.start));
  const [endUtc, setEndUtc] = useState(toUtcInputValue(defaults.end));
  const [minElevationDeg, setMinElevationDeg] = useState(25);
  const [minObservableMinutes, setMinObservableMinutes] = useState(30);
  const [maxResults, setMaxResults] = useState(50);
  const [includeReserved, setIncludeReserved] = useState(false);

  const site = TELESCOPES[telescope];
  const windowStart = parseUtcInput(startUtc);
  const windowEnd = parseUtcInput(endUtc);
  const invalidWindow = windowEnd.getTime() <= windowStart.getTime();

  const candidates = useMemo(() => {
    return catalog.targets.filter((target) => {
      const eligible = target.eligible_telescopes.includes(telescope);
      const usableStatus = includeReserved
        ? target.status !== "observed"
        : target.status === "available";
      return eligible && usableStatus;
    });
  }, [catalog.targets, includeReserved, telescope]);

  const results = useMemo<PlannedTarget[]>(() => {
    if (invalidWindow) {
      return [];
    }

    return candidates
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
      })
      .sort((a, b) => {
        return (
          b.visibility.observableMinutes - a.visibility.observableMinutes ||
          b.visibility.maxAltitudeDeg - a.visibility.maxAltitudeDeg ||
          a.target.ra_hours - b.target.ra_hours
        );
      })
      .slice(0, maxResults);
  }, [
    candidates,
    invalidWindow,
    maxResults,
    minElevationDeg,
    minObservableMinutes,
    site,
    windowEnd,
    windowStart,
  ]);

  function exportResults() {
    const filename = `anch0r-${telescope.toLowerCase()}-${startUtc.replaceAll(":", "")}.csv`;
    downloadCsv(
      filename,
      results.map(({ target, visibility }) => ({
        target_id: target.target_id,
        source_name: target.source_name,
        ra_hms: target.ra_hms,
        dec_dms: target.dec_dms,
        velocity_km_s: target.velocity_km_s,
        telescope,
        status: target.status,
        observable_minutes: visibility.observableMinutes,
        max_altitude_deg: visibility.maxAltitudeDeg.toFixed(1),
        max_altitude_utc: formatUtc(visibility.maxAltitudeUtc),
        first_observable_utc: formatUtc(visibility.firstObservableUtc),
        last_observable_utc: formatUtc(visibility.lastObservableUtc),
      })),
    );
  }

  return (
    <main className="page-shell page-block">
      <div className="page-heading">
        <p className="eyebrow">Observation planning</p>
        <h1>Target Planner</h1>
        <p>
          Generate a ranked list of unobserved targets that are eligible for a
          telescope and visible during a UTC observing window.
        </p>
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

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={includeReserved}
              onChange={(event) => setIncludeReserved(event.target.checked)}
            />
            Include reserved targets
          </label>
        </form>

        <aside className="planner-summary">
          <span>{site.shortName}</span>
          <strong>{formatInteger(candidates.length)}</strong>
          <p>candidate targets before visibility filtering</p>
          <dl>
            <div>
              <dt>Latitude</dt>
              <dd>{formatDegrees(site.latitudeDeg, 3)}</dd>
            </div>
            <div>
              <dt>Longitude</dt>
              <dd>{formatDegrees(site.longitudeDeg, 3)}</dd>
            </div>
            <div>
              <dt>Elevation</dt>
              <dd>{formatInteger(site.elevationM)} m</dd>
            </div>
          </dl>
        </aside>
      </section>

      {invalidWindow ? (
        <div className="message-error">End UTC must be later than Start UTC.</div>
      ) : null}

      <section className="results-heading">
        <div>
          <h2>Recommended targets</h2>
          <p>
            Showing {formatInteger(results.length)} targets above {minElevationDeg} deg
            for at least {formatInteger(minObservableMinutes)} minutes.
          </p>
        </div>
        <button type="button" className="button button-secondary" onClick={exportResults}>
          Download CSV
        </button>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>RA</th>
              <th>Dec</th>
              <th>Velocity</th>
              <th>Observable</th>
              <th>Max Alt</th>
              <th>Best UTC</th>
              <th>Window UTC</th>
            </tr>
          </thead>
          <tbody>
            {results.map(({ target, visibility }) => (
              <tr key={target.target_id}>
                <td>
                  <strong>{target.source_name}</strong>
                  <span className="subtle">{target.target_id}</span>
                </td>
                <td>{target.ra_hms}</td>
                <td>{target.dec_dms}</td>
                <td>{target.velocity_km_s.toFixed(1)}</td>
                <td>{formatInteger(visibility.observableMinutes)} min</td>
                <td>{formatDegrees(visibility.maxAltitudeDeg, 1)}</td>
                <td>{formatUtc(visibility.maxAltitudeUtc)}</td>
                <td>
                  <span className="subtle">
                    {formatUtc(visibility.firstObservableUtc)} to{" "}
                    {formatUtc(visibility.lastObservableUtc)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {results.length === 0 ? (
          <div className="empty-state">No targets match this observing setup.</div>
        ) : null}
      </div>
    </main>
  );
}
