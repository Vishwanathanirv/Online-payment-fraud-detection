import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "@fontsource-variable/mona-sans/wdth.css";
import "@fontsource-variable/geist-mono";
import "./index.css";
import { Page, Shell } from "./shell";
import { DriftPage } from "./pages/Drift";
import { Model } from "./pages/Model";
import { Playground } from "./pages/Playground";
import { Rings } from "./pages/Rings";
import { Triage } from "./pages/Triage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Triage />} />
          <Route path="/rings" element={<Page><Rings /></Page>} />
          <Route path="/model" element={<Page><Model /></Page>} />
          <Route path="/drift" element={<Page><DriftPage /></Page>} />
          <Route path="/try" element={<Page><Playground /></Page>} />
          <Route path="*" element={<Page><p className="text-muted">There's no view here. Press Ctrl K to find one.</p></Page>} />
        </Routes>
      </Shell>
    </BrowserRouter>
  </StrictMode>,
);
