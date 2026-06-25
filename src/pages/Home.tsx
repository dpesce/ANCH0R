import type { CatalogData } from "../types";
import { formatInteger } from "../lib/format";
import { TELESCOPES, TELESCOPE_CODES } from "../lib/telescopes";

interface HomeProps {
  catalog: CatalogData;
}

export function Home({ catalog }: HomeProps) {
  const available = catalog.stats.status_counts.available ?? 0;
  const reserved = catalog.stats.status_counts.reserved ?? 0;
  const observed = catalog.stats.status_counts.observed ?? 0;

  return (
    <main>
      <section className="hero-band">
        <div className="page-shell hero-layout">
          <div>
            <p className="eyebrow">22 GHz galaxy survey</p>
            <h1>ANCH0R Survey Coordination</h1>
            <p className="hero-copy">
              ANCH0R coordinates multi-year radio observations of nearby galaxies with
              the Green Bank Telescope, the Effelsberg 100m telescope, and the Sardinia
              Radio Telescope. This site tracks target status and helps observers build
              telescope-specific target lists for upcoming sessions.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#planner">
                Plan an observation
              </a>
              <a className="button button-secondary" href="#targets">
                View master table
              </a>
            </div>
          </div>
          <div className="metric-grid">
            <div className="metric-card">
              <span>Total targets</span>
              <strong>{formatInteger(catalog.stats.total_targets)}</strong>
            </div>
            <div className="metric-card">
              <span>Available</span>
              <strong>{formatInteger(available)}</strong>
            </div>
            <div className="metric-card">
              <span>Reserved</span>
              <strong>{formatInteger(reserved)}</strong>
            </div>
            <div className="metric-card">
              <span>Observed</span>
              <strong>{formatInteger(observed)}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="page-shell section-grid">
        <article>
          <p className="section-label">Project Team</p>
          <h2>Campaign roles</h2>
          <dl className="team-list">
            <div>
              <dt>Principal Investigator</dt>
              <dd>D. Pesce</dd>
            </div>
            <div>
              <dt>Collaboration</dt>
              <dd>ANCH0R observing team</dd>
            </div>
            <div>
              <dt>Facilities</dt>
              <dd>GBT, Effelsberg 100m, and SRT</dd>
            </div>
          </dl>
        </article>

        <article>
          <p className="section-label">Telescope Eligibility</p>
          <h2>Raw source-list coverage</h2>
          <div className="coverage-list">
            {TELESCOPE_CODES.map((code) => (
              <div key={code} className="coverage-row">
                <span>{TELESCOPES[code].label}</span>
                <strong>{formatInteger(catalog.stats.eligible_by_telescope[code])}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
