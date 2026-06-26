import type { CatalogData } from "../types";
import { formatInteger } from "../lib/format";

interface HomeProps {
  catalog: CatalogData;
}

const TEAM_MEMBERS = [
  "Jim Braatz",
  "Paola Castangia",
  "Frédéric Courbin",
  "Christian Henkel",
  "Cheng-Yu Kuo",
  "Elisabetta Ladu",
  "Dom Pesce",
  "Mark Reid",
  "Andrea Tarchi",
];

export function Home({ catalog }: HomeProps) {
  const totalTargets = catalog.stats.total_targets;
  const observed = catalog.stats.status_counts.observed ?? 0;
  const progressPercent = totalTargets > 0 ? (observed / totalTargets) * 100 : 0;

  return (
    <main>
      <section className="hero-band">
        <div className="page-shell hero-layout">
          <h1>ANCH0R Survey</h1>
          <p className="definition">
            <span className="definition-emphasis">ANCH0R</span>
            <span> = </span>
            <span className="definition-emphasis">A</span>dditional{" "}
            <span className="definition-emphasis">N</span>earby{" "}
            <span className="definition-emphasis">C</span>alibrators for{" "}
            <span className="definition-emphasis">
              H<sub>0</sub>
            </span>{" "}
            <span className="definition-emphasis">R</span>eliability
          </p>
          <p className="hero-copy">
            The ANCH0R program is conducting a volume-limited survey to search every
            galaxy within 20 Mpc for 22 GHz water megamaser emission, with the goal of
            finding "the next NGC 4258." This survey makes use of the Green Bank
            Telescope, the Effelsberg 100m telescope, and the Sardinia Radio Telescope.
          </p>
          <p>
            <a href="https://greenbankobservatory.org/science/gbt-surveys/anch0r/">
              GBT project page
            </a>
          </p>
          <div className="progress-block" aria-label="Project observation progress">
            <div className="progress-label">
              <span>Project status</span>
              <strong>
                {formatInteger(observed)} / {formatInteger(totalTargets)} targets observed
              </strong>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        </div>
      </section>

      <section className="page-shell content-stack">
        <article>
          <h2>Project Team</h2>
          <ul className="team-list">
            {TEAM_MEMBERS.map((member) => (
              <li key={member}>{member}</li>
            ))}
          </ul>
        </article>

        <article className="longform">
          <h2>Project Description</h2>
          <p>
            NGC 4258 is the nearest, brightest, and "cleanest" disk megamaser system
            known, and its geometric distance carries disproportionate weight in setting
            the absolute scale of most extragalactic distance-measuring techniques used
            in cosmology today. This unique role makes NGC 4258 the most important
            galaxy in the Universe for cosmology, but it also presents a single point of
            failure that is no longer acceptable in the era of percent-level
            cosmological measurements and in the face of the current "Hubble tension"
            (the &gt;5 sigma discrepancy between the CMB-based value of the Hubble
            constant and direct local-Universe measurements).
          </p>
          <p>
            The ANCH0R strategy is deliberately simple: a comprehensive survey of
            galaxies out to 20 Mpc. This approach avoids selection-based blind spots
            while ensuring that any detected system is nearby enough to enable an
            anchor-quality distance measurement. The ANCH0R survey will cover a volume
            roughly an order of magnitude larger than that bounded by NGC 4258 itself.
            Finding even one additional NGC 4258-like system will immediately reduce
            the current reliance on a single galaxy, enable consistency checks between
            calibrators, and harden the absolute distance scale against subtle
            systematics that can dominate at the percent level.
          </p>
          <p>
            Because the ANCH0R survey targets are selected purely by proximity and will
            all be observed to a comparable sensitivity level, the resulting detection
            statistics will also provide the first genuinely unbiased accounting of the
            incidence rate and luminosity function for 22 GHz megamaser emission in the
            local Universe. This sample will thus enable demographic tests of how
            megamaser occurrence correlates with basic host galaxy properties, removing
            selection function ambiguities and providing a reference population that can
            be used to optimize target-selection strategies for the next generation of
            megamaser discovery experiments.
          </p>
          <p>
            ANCH0R is part of a concerted effort from the ERC-funded RedH0T synergy
            project to address the Hubble tension with all known cosmological probes,
            aiming to set the most reliable measurement of the Hubble constant.  The
            ANCH0R survey is an international effort that makes use of the Green Bank
            Telescope, the Effelsberg 100m telescope, and the Sardinia Radio Telescope
            to efficiently survey all nearby galaxies for megamaser emission.
          </p>
        </article>
      </section>
    </main>
  );
}
