import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes } from "react-router";
import "@fontsource-variable/inter";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/jetbrains-mono/400.css";
import "./index.css";
import { Live } from "./pages/Live";
import { Cases } from "./pages/Cases";
import { Model } from "./pages/Model";
import { DriftPage } from "./pages/Drift";
import { Playground } from "./pages/Playground";
import { Rings } from "./pages/Rings";

const NAV = [
  { to: "/", t: "Live tape" },
  { to: "/cases", t: "Cases" },
  { to: "/rings", t: "Rings" },
  { to: "/model", t: "Model" },
  { to: "/drift", t: "Drift" },
  { to: "/try", t: "Try a payment" },
];

function Shell() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end gap-x-8 gap-y-2 px-4 pt-4 sm:px-6">
          <a href="/" className="flex items-center gap-2.5 pb-2.5">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="display text-[1.45rem] font-extrabold leading-none tracking-tight">FraudLens</span>
          </a>
          <nav className="-mb-px order-last flex basis-full gap-0.5 overflow-x-auto sm:order-none sm:flex-1 sm:basis-auto" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end className={({ isActive }) => `tab ${isActive ? "tab-active" : ""}`}>
                {n.t}
              </NavLink>
            ))}
          </nav>
          <a href="https://github.com/Vishwanathanirv/online-payment-fraud-detection" className="hidden pb-3 text-sm text-muted underline-offset-4 hover:text-ink hover:underline sm:block">
            Source on GitHub
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6">
        <Routes>
          <Route path="/" element={<Live />} />
          <Route path="/cases" element={<Cases />} />
          <Route path="/rings" element={<Rings />} />
          <Route path="/model" element={<Model />} />
          <Route path="/drift" element={<DriftPage />} />
          <Route path="/try" element={<Playground />} />
          <Route path="*" element={<p className="text-muted">There's no page here. Pick a tab above.</p>} />
        </Routes>
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-faint sm:px-6">
        Built by{" "}
        <a href="https://vishwanathan.dev" className="text-muted underline underline-offset-4">
          Vishwanathan R
        </a>
        . Synthetic data only, no real card details.
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  </StrictMode>,
);
