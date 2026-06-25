export type TelescopeCode = "GBT" | "EFF" | "SRT";

export type TargetStatus = "unobserved" | "observed";

export interface Target {
  target_id: string;
  source_name: string;
  ra_hms: string;
  dec_dms: string;
  ra_hours: number;
  ra_deg: number;
  dec_deg: number;
  velocity_km_s: number;
  coordinate_system: string;
  epoch: string;
  velocity_frame: string;
  velocity_convention: string;
  eligible_telescopes: TelescopeCode[];
  eligible_gbt: boolean;
  eligible_eff: boolean;
  eligible_srt: boolean;
  gbt_group: string;
  raw_flags: Partial<Record<TelescopeCode, string>>;
  status: TargetStatus;
  assigned_telescope: TelescopeCode | "";
  spectrum_url: string;
  notes: string;
  observations_count: number;
}

export interface Observation {
  observation_id: string;
  target_id: string;
  telescope: TelescopeCode;
  observer: string;
  start_utc: string;
  end_utc: string;
  status: string;
  spectrum_url: string;
  notes: string;
}

export interface CatalogStats {
  total_targets: number;
  raw_sources: Record<
    TelescopeCode,
    {
      path: string;
      rows: number;
      unique_names: number;
    }
  >;
  eligible_by_telescope: Record<TelescopeCode, number>;
  status_counts: Partial<Record<TargetStatus, number>>;
  eligibility_overlap_counts: Record<string, number>;
  observations: number;
}

export interface CatalogData {
  schema_version: number;
  project: {
    name: string;
    description: string;
  };
  telescopes: Record<TelescopeCode, string>;
  stats: CatalogStats;
  targets: Target[];
  observations: Observation[];
}
