import { useEffect, useMemo, useState } from "react";
import { loadCatalog } from "./lib/api";
import { Home } from "./pages/Home";
import { MasterTable } from "./pages/MasterTable";
import { PlanObservation, SubmitObservingReport } from "./pages/ObservationWorkflow";
import type { CatalogData } from "./types";

type Route = "home" | "targets" | "plan" | "report";

const ROUTES: Route[] = ["home", "targets", "plan", "report"];

function getRouteFromHash(): Route {
  const hash = window.location.hash.replace("#", "");
  if (hash === "planner") {
    return "plan";
  }
  const route = hash as Route;
  return ROUTES.includes(route) ? route : "home";
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => getRouteFromHash());

  useEffect(() => {
    const updateRoute = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);

  return route;
}

export default function App() {
  const route = useHashRoute();
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCatalog()
      .then(setCatalog)
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Unable to load catalog");
      });
  }, []);

  const page = useMemo(() => {
    if (error) {
      return (
        <main className="page-shell page-block">
          <div className="message-error">{error}</div>
        </main>
      );
    }

    if (!catalog) {
      return (
        <main className="page-shell page-block">
          <div className="loading-state">Loading catalog...</div>
        </main>
      );
    }

    if (route === "targets") {
      return <MasterTable catalog={catalog} />;
    }
    if (route === "plan") {
      return <PlanObservation catalog={catalog} />;
    }
    if (route === "report") {
      return <SubmitObservingReport catalog={catalog} />;
    }
    return <Home catalog={catalog} />;
  }, [catalog, error, route]);

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#home" aria-label="ANCH0R home">
          ANCH0R
        </a>
        <nav aria-label="Primary navigation">
          <a className={route === "home" ? "active" : ""} href="#home">
            Home
          </a>
          <a className={route === "targets" ? "active" : ""} href="#targets">
            Targets
          </a>
          <span className="nav-label">Observations</span>
          <a className={route === "plan" ? "active" : ""} href="#plan">
            Plan
          </a>
          <a className={route === "report" ? "active" : ""} href="#report">
            Report
          </a>
        </nav>
      </header>
      {page}
    </>
  );
}
