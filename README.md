# ANCH0R

Website: [https://dpesce.github.io/ANCH0R](https://dpesce.github.io/ANCH0R)

The ANCH0R program is conducting a volume-limited survey to search every galaxy within 20 Mpc for 22 GHz water megamaser emission, with the goal of finding "the next NGC 4258."  The ANCH0R survey makes use of the Green Bank Telescope, the Effelsberg 100m telescope,
and the Sardinia Radio Telescope.

This repository contains a static GitHub Pages coordination site. It tracks the
master target catalog, campaign observation status, links to spectrum images,
and provides a browser-side target planner for upcoming observing sessions.

## Repository Layout

```text
data/
  raw/                    Original telescope source lists
  observations.csv         Observation history, assessments, and spectrum links
  master_targets.csv       Generated review table
public/
  data/catalog.json        Generated website data
  spectra/                 Spectrum images linked from observations.csv
scripts/
  build_catalog.py         Builds generated catalog products
  validate_data.py         Validates source and campaign CSV files
observing_scripts/
  anch0r_kfpa_config.py    Shared KFPA/VEGAS AstrID configuration
  anch0r_kfpa_survey.py    Five-minute survey observations
  anch0r_kfpa_followup.py  Thirty-minute single-target follow-up
src/                       Vite/React/TypeScript website
```

The raw source lists remain the telescope-specific inputs. Campaign progress is
tracked through ordinary CSV edits in `data/observations.csv`.

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

Vite will print a local URL. Open the `/ANCH0R/` path, typically:

```text
http://localhost:5173/ANCH0R/
```

Build the deployed static site:

```bash
pnpm run build
```

## Updating Campaign State

To mark a target as observed, add a row to `data/observations.csv` with
`status` set to `observed`. Successful observations require:

- `rms_mjy_per_1_km_s`: RMS noise in mJy per 1 km/s spectral channel
- `data_quality`: `trusted`, `possible_pointing_problems`,
  `possible_other_problems`, or `untrusted`
- `detection_status`: `detected`, `marginal`, or `undetected`

A target that was attempted but not observed uses `status=failed`, with blank
RMS, data-quality, and detection fields. Put spectrum images under
`public/spectra/` and use a site-relative URL such as
`/ANCH0R/spectra/example.png` in the `spectrum_url` column.

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

The target-level detection status shown on the website comes from the last
successfully observed row for that target that contains a detection assessment.
This keeps repeated observations in the history while allowing a later report
to update the current classification.

The target planner uses telescope eligibility from the source lists and a
browser-side altitude calculation based on the site coordinates in
`src/lib/telescopes.ts`. It is intended for campaign coordination, not final
telescope scheduling constraints.

Filtered GBT targets and the complete available GBT catalog are exported as
fixed-width `.cat` source catalogs. The format follows
`examples/example_GBT_catalog.cat`, including its column alignment, and adds a
`veldef=VOPT-HEL` header so AstrID interprets target velocities as heliocentric
optical velocities. The GBT AstrID configuration and scheduling blocks are in
`observing_scripts/`; review that directory's README and have the blocks
validated by the project's GBT support scientist before telescope use.
Filtered SRT targets and the complete available SRT catalog are exported as
`.txt` schedule catalogs following `examples/example_SRT_catalog.txt`, with the
template header retained and one `Nodcal`/`SARDARA` row per target. Effelsberg
and combined catalogs remain CSV until additional telescope-specific formats
are added.

## Observing Reports

The report page first shows an in-app confirmation screen. The observer opens
the prefilled GitHub issue and clicks Create. No copying or pasting is needed.
The browser compresses target IDs, RMS values, assessments, and notes using gzip
and URL-safe base64. Source names and coordinates are recovered from the master
catalog instead of being transmitted again.

Each complete URL is measured against a conservative 1,800-character budget.
Larger reports split into numbered parts, each submitted as its own issue.
Every part preserves the notes and the original target order. If the notes
alone prevent even a single-target link from fitting, the page asks the observer
to shorten the notes while retaining all entered targets and assessments.
The confirmation page also offers a readable text download for the observer's
records.

Each issue contains a versioned, machine-readable payload. The
observing-report workflow validates that payload, adds one row per selected
target to `data/observations.csv`, rebuilds the generated catalog files, and
opens a pull request for review. The workflow also replaces the initial compact
issue description with a readable target table and notes while keeping the
compressed payload in a collapsed details section. Reports use the current V5
payload format; decompression is bounded and every target and assessment is
validated before observation rows are written. Earlier report formats are
intentionally unsupported while the interface is
under active design.

## License

This repository is distributed under the MIT License. See `LICENSE`.
