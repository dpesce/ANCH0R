import type { CatalogData } from "../types";

export async function loadCatalog(): Promise<CatalogData> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/catalog.json`, {
    cache: "no-cache",
  });

  if (!response.ok) {
    throw new Error(`Unable to load catalog data (${response.status})`);
  }

  return (await response.json()) as CatalogData;
}
