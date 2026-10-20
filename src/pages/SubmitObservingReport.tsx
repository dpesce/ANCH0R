import { useMemo, useState } from "react";
import { DetectionBadge } from "../components/DetectionBadge";
import { StatusBadge } from "../components/StatusBadge";
import {
  downloadText,
  formatInteger,
  formatUtc,
  formatVelocity,
} from "../lib/format";
import {
  buildReportSubmissions,
  DATA_QUALITY_LABELS,
  DATA_QUALITY_OPTIONS,
  type PreparedReportTarget,
  type ReportSubmission,
} from "../lib/observingReport";
import { TELESCOPES, TELESCOPE_CODES } from "../lib/telescopes";
import type {
  CatalogData,
  DataQuality,
  DetectionStatus,
  Target,
  TelescopeCode,
} from "../types";

interface SubmitObservingReportProps {
  catalog: CatalogData;
}

interface TargetAssessment {
  rmsMjyPer1KmS: string;
  dataQuality: DataQuality | "";
  detectionStatus: DetectionStatus | "";
}

interface PreparedReport {
  submissions: ReportSubmission[];
  telescope: TelescopeCode;
  targets: PreparedReportTarget[];
  notes: string;
}

type ReportSortKey =
  | "catalog"
  | "name"
  | "ra"
  | "dec"
  | "velocity"
  | "observationStatus"
  | "detectionStatus";
type SortDirection = "asc" | "desc";

const DETECTION_STATUS_OPTIONS: DetectionStatus[] = [
  "detected",
  "marginal",
  "undetected",
];

function githubCreateShortcut(): string {
  return navigator.userAgent.includes("Mac") ? "⌘↵" : "Ctrl↵";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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

function assessmentIsComplete(assessment: TargetAssessment): boolean {
  const rms = Number(assessment.rmsMjyPer1KmS);
  return (
    assessment.rmsMjyPer1KmS.trim() !== "" &&
    Number.isFinite(rms) &&
    rms >= 0 &&
    Boolean(assessment.dataQuality) &&
    Boolean(assessment.detectionStatus)
  );
}

async function prepareReport(
  telescope: TelescopeCode,
  selectedTargets: Target[],
  assessments: Record<string, TargetAssessment>,
  notes: string,
): Promise<PreparedReport> {
  const targets = selectedTargets.map((target) => {
    const assessment = assessments[target.target_id];
    if (
      !assessmentIsComplete(assessment) ||
      !assessment.dataQuality ||
      !assessment.detectionStatus
    ) {
      throw new Error(`Incomplete observing report entry for ${target.source_name}`);
    }

    return {
      targetId: target.target_id,
      sourceName: target.source_name,
      raHms: target.ra_hms,
      decDms: target.dec_dms,
      velocityKmS: Math.round(target.velocity_km_s),
      rmsMjyPer1KmS: Number(assessment.rmsMjyPer1KmS),
      dataQuality: assessment.dataQuality,
      detectionStatus: assessment.detectionStatus,
    };
  });

  const submittedAtUtc = formatUtc(new Date());
  return {
    submissions: await buildReportSubmissions(telescope, targets, notes, submittedAtUtc),
    telescope,
    targets,
    notes,
  };
}

function ReportConfirmation({
  report,
  onBack,
}: {
  report: PreparedReport;
  onBack: () => void;
}) {
  const [partIndex, setPartIndex] = useState(0);
  const submission = report.submissions[partIndex];

  return (
    <main className="page-shell page-block">
      <div className="page-heading">
        <p className="section-label">Observations</p>
        <h1>Confirm observing report</h1>
        <p>
          Review the complete report below. Nothing has been submitted yet.
        </p>
      </div>

      <section className="selection-panel report-confirmation-summary">
        <div className="section-heading-row">
          <div>
            <h2>Report Summary</h2>
            <p>
              {TELESCOPES[report.telescope].label} |{" "}
              {formatInteger(report.targets.length)}{" "}
              {report.targets.length === 1 ? "target" : "targets"}
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="observation-table report-confirmation-table">
            <colgroup>
              <col className="report-confirmation-target-column" />
              <col className="report-confirmation-ra-column" />
              <col className="report-confirmation-dec-column" />
              <col className="report-confirmation-velocity-column" />
              <col className="report-confirmation-rms-column" />
              <col className="report-confirmation-quality-column" />
              <col className="report-confirmation-detection-column" />
            </colgroup>
            <thead>
              <tr>
                <th>Target</th>
                <th>RA</th>
                <th>Dec</th>
                <th>Velocity</th>
                <th>
                  RMS noise
                  <span className="table-heading-unit">
                    mJy per 1 km/s channel
                  </span>
                </th>
                <th>Data quality</th>
                <th>Detection status</th>
              </tr>
            </thead>
            <tbody>
              {report.targets.map((target) => (
                <tr key={target.targetId}>
                  <td>
                    <strong>{target.sourceName}</strong>
                  </td>
                  <td>{target.raHms}</td>
                  <td>{target.decDms}</td>
                  <td>{formatVelocity(target.velocityKmS)}</td>
                  <td>{target.rmsMjyPer1KmS}</td>
                  <td>{DATA_QUALITY_LABELS[target.dataQuality]}</td>
                  <td>{capitalize(target.detectionStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="report-confirmation-notes">
          <h3>Notes</h3>
          <p>{report.notes || "No notes provided."}</p>
        </div>
      </section>

      <section className="github-confirmation-panel">
        <p className="section-label">Final Step</p>
        <h2>Submit on GitHub</h2>
        <p>
          Open GitHub to submit your report. The title and report data will be
          filled in automatically; no copying or editing is needed.
        </p>
        <p>
          <code>github.com/dpesce/ANCH0R/issues/new</code>
        </p>
        {report.submissions.length > 1 ? (
          <label className="report-part-selector">
            Report part
            <select
              value={partIndex}
              onChange={(event) => {
                setPartIndex(Number(event.target.value));
              }}
            >
              {report.submissions.map((part, index) => (
                <option key={index} value={index}>
                  Part {index + 1} of {report.submissions.length} ({part.targetCount}{" "}
                  targets)
                </option>
              ))}
            </select>
            <span className="subtle">
              This large report is split into {report.submissions.length} issues.
              Submit each part using the steps below; every part includes your
              notes.
            </span>
          </label>
        ) : null}
        <div className="github-instruction">
          <a
            className="button button-primary"
            href={submission.issueUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open GitHub report
          </a>
          <strong>
            On the bottom of that page, click the green button labeled:
          </strong>
          <span className="github-submit-button-example">
            <span>Create</span>
            <kbd>{githubCreateShortcut()}</kbd>
          </span>
          <span>Your report is submitted only after you click Create on GitHub.</span>
          <span>
            The GitHub description initially contains compressed report data.
            A readable target table and your notes will appear automatically
            after submission.
          </span>
        </div>
        <div className="report-confirmation-actions">
          <button
            className="button button-secondary"
            onClick={() => downloadText(submission.filename, submission.body)}
            type="button"
          >
            Download report text
          </button>
          <button className="button button-secondary" onClick={onBack} type="button">
            Back to edit report
          </button>
        </div>
      </section>
    </main>
  );
}

export function SubmitObservingReport({ catalog }: SubmitObservingReportProps) {
  const [telescope, setTelescope] = useState<TelescopeCode | "">("");
  const [targetSearch, setTargetSearch] = useState("");
  const [assessments, setAssessments] = useState<
    Record<string, TargetAssessment>
  >({});
  const [notes, setNotes] = useState("");
  const [sortKey, setSortKey] = useState<ReportSortKey>("catalog");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [pendingReport, setPendingReport] = useState<PreparedReport | null>(null);
  const [reportError, setReportError] = useState("");
  const [preparingReport, setPreparingReport] = useState(false);

  const selectedTargets = useMemo(
    () =>
      catalog.targets.filter((target) =>
        Object.hasOwn(assessments, target.target_id),
      ),
    [assessments, catalog.targets],
  );

  const filteredTargets = useMemo(
    () =>
      catalog.targets.filter((target) =>
        targetMatchesNameSearch(target, targetSearch),
      ),
    [catalog.targets, targetSearch],
  );

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
      } else if (sortKey === "observationStatus") {
        comparison = a.status.localeCompare(b.status);
      } else if (sortKey === "detectionStatus") {
        comparison = a.detection_status.localeCompare(b.detection_status);
      }

      return comparison * direction || a.source_name.localeCompare(b.source_name);
    });
  }, [filteredTargets, sortDirection, sortKey]);

  const reportIsComplete =
    telescope !== "" &&
    selectedTargets.length > 0 &&
    selectedTargets.every((target) =>
      target.eligible_telescopes.includes(telescope),
    ) &&
    selectedTargets.every((target) =>
      assessmentIsComplete(assessments[target.target_id]),
    );

  const ineligibleTargetCount =
    telescope === ""
      ? 0
      : selectedTargets.filter(
          (target) => !target.eligible_telescopes.includes(telescope),
        ).length;

  function updateSort(nextSortKey: ReportSortKey) {
    if (sortKey === nextSortKey) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection("asc");
  }

  function sortLabel(label: string, key: ReportSortKey) {
    if (sortKey !== key) {
      return label;
    }
    return `${label} (${sortDirection === "asc" ? "asc" : "desc"})`;
  }

  function toggleSelection(target: Target) {
    setAssessments((current) => {
      const next = { ...current };
      if (Object.hasOwn(next, target.target_id)) {
        delete next[target.target_id];
      } else {
        next[target.target_id] = {
          rmsMjyPer1KmS: "",
          dataQuality: "",
          detectionStatus: "",
        };
      }
      return next;
    });
  }

  function updateAssessment(
    targetId: string,
    updates: Partial<TargetAssessment>,
  ) {
    setAssessments((current) => ({
      ...current,
      [targetId]: {
        ...current[targetId],
        ...updates,
      },
    }));
  }

  async function reviewReport() {
    if (!reportIsComplete || !telescope || preparingReport) {
      return;
    }

    try {
      setPreparingReport(true);
      setPendingReport(
        await prepareReport(telescope, selectedTargets, assessments, notes),
      );
      setReportError("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setReportError(
        error instanceof Error ? error.message : "Unable to prepare report.",
      );
    } finally {
      setPreparingReport(false);
    }
  }

  if (pendingReport) {
    return (
      <ReportConfirmation
        report={pendingReport}
        onBack={() => {
          setPendingReport(null);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    );
  }

  return (
    <main className="page-shell page-block">
      <div className="page-heading">
        <p className="section-label">Observations</p>
        <h1>Submit an observing report</h1>
        <p>
          Select the telescope and each target observed during the run, then
          record the data assessment for every target. Submitting first opens a
          confirmation page where the complete report can be reviewed.
        </p>
      </div>

      <section className="selection-panel report-selection-panel">
        <div className="section-heading-row">
          <div>
            <h2>Selected Targets</h2>
            <p>
              {formatInteger(selectedTargets.length)}{" "}
              {selectedTargets.length === 1 ? "target" : "targets"} selected.
              Complete every row before submitting.
            </p>
          </div>
          <button
            className="button button-secondary"
            disabled={!reportIsComplete || preparingReport}
            onClick={reviewReport}
            type="button"
          >
            {preparingReport ? "Preparing report..." : "Submit report"}
          </button>
        </div>

        <div className="report-global-fields">
          <label>
            Telescope
            <select
              value={telescope}
              onChange={(event) =>
                setTelescope(event.target.value as TelescopeCode | "")
              }
            >
              <option value="">Select telescope...</option>
              {TELESCOPE_CODES.map((code) => (
                <option key={code} value={code}>
                  {TELESCOPES[code].label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {ineligibleTargetCount > 0 ? (
          <div className="message-error report-validation-message">
            {formatInteger(ineligibleTargetCount)} selected{" "}
            {ineligibleTargetCount === 1 ? "target is" : "targets are"} not
            eligible for {telescope}.
          </div>
        ) : null}

        {reportError ? (
          <p className="message-error" role="alert">{reportError}</p>
        ) : null}

        {selectedTargets.length > 0 ? (
          <div className="table-wrap">
            <table className="observation-table report-entry-table">
              <colgroup>
                <col className="report-entry-remove-column" />
                <col className="report-entry-target-column" />
                <col className="report-entry-rms-column" />
                <col className="report-entry-quality-column" />
                <col className="report-entry-detection-column" />
              </colgroup>
              <thead>
                <tr>
                  <th>Remove</th>
                  <th>Target</th>
                  <th>
                    RMS noise
                    <span className="table-heading-unit">
                      mJy per 1 km/s channel
                    </span>
                  </th>
                  <th>Data quality</th>
                  <th>Detection status</th>
                </tr>
              </thead>
              <tbody>
                {selectedTargets.map((target) => {
                  const assessment = assessments[target.target_id];
                  const ineligible =
                    telescope !== "" &&
                    !target.eligible_telescopes.includes(telescope);
                  return (
                    <tr
                      className={
                        ineligible ? "report-entry-row--ineligible" : ""
                      }
                      key={target.target_id}
                    >
                      <td className="checkbox-cell">
                        <input
                          aria-label={`Remove ${target.source_name}`}
                          checked
                          className="target-checkbox"
                          onChange={() => toggleSelection(target)}
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <strong>{target.source_name}</strong>
                      </td>
                      <td>
                        <input
                          aria-label={`RMS noise for ${target.source_name}`}
                          min={0}
                          onChange={(event) =>
                            updateAssessment(target.target_id, {
                              rmsMjyPer1KmS: event.target.value,
                            })
                          }
                          placeholder="0.0"
                          step="any"
                          type="number"
                          value={assessment.rmsMjyPer1KmS}
                        />
                      </td>
                      <td>
                        <select
                          aria-label={`Data quality for ${target.source_name}`}
                          value={assessment.dataQuality}
                          onChange={(event) =>
                            updateAssessment(target.target_id, {
                              dataQuality: event.target.value as
                                | DataQuality
                                | "",
                            })
                          }
                        >
                          <option value="">Select...</option>
                          {DATA_QUALITY_OPTIONS.map(({ value, label }) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label={`Detection status for ${target.source_name}`}
                          value={assessment.detectionStatus}
                          onChange={(event) =>
                            updateAssessment(target.target_id, {
                              detectionStatus: event.target.value as
                                | DetectionStatus
                                | "",
                            })
                          }
                        >
                          <option value="">Select...</option>
                          {DETECTION_STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {capitalize(status)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="subtle">Select targets from the table below.</p>
        )}

        <label className="notes-field">
          Notes
          <textarea
            rows={5}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Add notes that apply to this observing report."
          />
        </label>
      </section>

      <section className="target-filter-panel report-target-search">
        <label>
          Search targets
          <input
            type="search"
            value={targetSearch}
            onChange={(event) => setTargetSearch(event.target.value)}
            placeholder="Target name"
          />
        </label>
        <div className="toolbar-count">
          <strong>{formatInteger(sortedTargets.length)}</strong>
          <span>matching targets</span>
        </div>
      </section>

      <section className="results-heading">
        <div>
          <h2>All Targets</h2>
          <p>Select every target included in this observing report.</p>
        </div>
      </section>

      <div className="table-wrap">
        <table className="observation-table">
          <thead>
            <tr>
              <th>Select</th>
              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => updateSort("name")}
                >
                  {sortLabel("Target", "name")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => updateSort("ra")}
                >
                  {sortLabel("RA", "ra")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => updateSort("dec")}
                >
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
                  onClick={() => updateSort("observationStatus")}
                >
                  {sortLabel("Observation status", "observationStatus")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => updateSort("detectionStatus")}
                >
                  {sortLabel("Detection status", "detectionStatus")}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedTargets.map((target) => {
              const selected = Object.hasOwn(assessments, target.target_id);
              return (
                <tr
                  className={selected ? "selected-row" : ""}
                  key={target.target_id}
                >
                  <td className="checkbox-cell">
                    <input
                      aria-label={`Select ${target.source_name}`}
                      checked={selected}
                      className="target-checkbox"
                      onChange={() => toggleSelection(target)}
                      type="checkbox"
                    />
                  </td>
                  <td>
                    <strong>{target.source_name}</strong>
                  </td>
                  <td>{target.ra_hms}</td>
                  <td>{target.dec_dms}</td>
                  <td>{formatVelocity(target.velocity_km_s)}</td>
                  <td>
                    <StatusBadge status={target.status} />
                  </td>
                  <td>
                    <DetectionBadge status={target.detection_status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedTargets.length === 0 ? (
          <div className="empty-state">No targets match this search.</div>
        ) : null}
      </div>
    </main>
  );
}
