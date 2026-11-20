import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "@fontsource-variable/mona-sans/wdth.css";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/fraunces/opsz.css";
import "./index.css";
import { Page, Shell } from "./shell";

// The desk loads first; the other rooms load when someone walks into them.
const DriftPage = lazy(() => import("./pages/Drift").then((m) => ({ default: m.DriftPage })));
const Model = lazy(() => import("./pages/Model").then((m) => ({ default: m.Model })));
const Playground = lazy(() => import("./pages/Playground").then((m) => ({ default: m.Playground })));
const Rings = lazy(() => import("./pages/Rings").then((m) => ({ default: m.Rings })));
const Loading = () => <div className="h-40 animate-pulse rounded-[3px] bg-panel-2" aria-label="Loading" />;
import { Triage } from "./pages/Triage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Shell>
        <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Triage />} />
          <Route path="/rings" element={<Page><Rings /></Page>} />
          <Route path="/model" element={<Page><Model /></Page>} />
          <Route path="/drift" element={<Page><DriftPage /></Page>} />
          <Route path="/try" element={<Page><Playground /></Page>} />
          <Route path="*" element={<Page><p className="text-muted">There's no view here. Press Ctrl K to find one.</p></Page>} />
        </Routes>
        </Suspense>
      </Shell>
    </BrowserRouter>
  </StrictMode>,
);
