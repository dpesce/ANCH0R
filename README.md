# ANCH0R

The ANCH0R program is conducting a volume-limited survey to search every galaxy within 20 Mpc for 22 GHz water megamaser emission, with the goal of finding "the next NGC 4258."  The ANCH0R survey makes use of the Green Bank Telescope, the Effelsberg 100m telescope,
and the Sardinia Radio Telescope.

NGC 4258 is the nearest, brightest, and "cleanest" disk megamaser system known, and its geometric distance carries disproportionate weight in setting the absolute scale of most extragalactic distance-measuring techniques used in cosmology today.  This unique role makes NGC 4258 the most important galaxy in the Universe for cosmology, but it also presents a single point of failure that is no longer acceptable in the era of percent-level cosmological measurements and in the face of the current "Hubble tension" (the >5σ discrepancy between the CMB-based value of the Hubble constant and direct local-Universe measurements).

The ANCH0R strategy is deliberately simple: a comprehensive survey of galaxies out to 20 Mpc.  This approach avoids selection-based blind spots (e.g., associated with AGN activity markers) while ensuring that any detected system is nearby enough to enable an anchor-quality distance measurement.  The ANCH0R survey will cover a volume roughly an order of magnitude larger than that bounded by NGC 4258 itself.  Finding even one additional NGC 4258-like system will immediately reduce the current reliance on a single galaxy, enable consistency checks between calibrators, and harden the absolute distance scale against subtle systematics that can dominate at the percent level.

Because the ANCH0R survey targets are selected purely by proximity and will all be observed to a comparable sensitivity level, the resulting detection statistics will also provide the first genuinely unbiased accounting of the incidence rate and luminosity function for 22 GHz megamaser emission in the local Universe.  This sample will thus enable demographic tests of how megamaser occurrence correlates with basic host galaxy properties, removing selection function ambiguities and providing a reference population that can be used to optimize target-selection strategies for the next generation of megamaser discovery experiments.

This repository contains a static GitHub Pages coordination site. It tracks the
master target catalog, campaign observation status, links to spectrum images,
and provides a browser-side target planner for upcoming observing sessions.

## Repository Layout

```text
data/
  raw/                    Original telescope source lists
  observations.csv         Observation history and spectrum links
  reservations.csv         Planned or reserved targets
  master_targets.csv       Generated review table
public/
  data/catalog.json        Generated website data
  spectra/                 Spectrum images linked from observations.csv
scripts/
  build_catalog.py         Builds generated catalog products
  validate_data.py         Validates source and campaign CSV files
src/                       Vite/React/TypeScript website
```

The raw source lists remain the telescope-specific inputs. Campaign progress is
tracked through ordinary CSV edits in `data/observations.csv` and
`data/reservations.csv`.

## Local Development

Requirements:

- Python 3.10 or newer
- Node.js 22 or newer
- pnpm

Build the generated catalog:

```bash
python3 scripts/build_catalog.py
```

Validate the catalog inputs:

```bash
python3 scripts/validate_data.py
```

Install website dependencies and start the development server:

```bash
corepack enable
pnpm install
pnpm run dev
```

Build the deployed static site:

```bash
pnpm run build
```

## Updating Campaign State

To mark a target as observed, add a row to `data/observations.csv` with
`status` set to `observed`. Put spectrum images under `public/spectra/` and use
a site-relative URL such as `/ANCH0R/spectra/example.png` in the `spectrum_url`
column.

To reserve a target for an upcoming session, add a row to
`data/reservations.csv` with `status` set to `reserved`, `active`, `planned`, or
`scheduled`.

After editing data files:

```bash
python3 scripts/validate_data.py
python3 scripts/build_catalog.py
git add data public/data public/spectra
git commit
git push
```

GitHub Actions validates the data, builds the site, and deploys GitHub Pages on
pushes to `main`.

## Data Notes

Target IDs are generated from source names. If a source name ever appears for
multiple physical targets, the builder appends a coordinate suffix to keep the
ID stable and unique.

The target planner uses telescope eligibility from the source lists and a
browser-side altitude calculation based on the site coordinates in
`src/lib/telescopes.ts`. It is intended for campaign coordination, not final
telescope scheduling constraints.

## License

This repository is distributed under the MIT License. See `LICENSE`.
