import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { moneyFormat } from "./engine/money";

/** Amounts are recorded in the data's currency and shown in the chosen one: `k` converts. */
export type Money = { view: string; k: number; fmt: (v: number, digits?: number) => string };
export const MoneyCtx = createContext<Money>({ view: "EUR", k: 1, fmt: moneyFormat("EUR") });
export const useMoney = () => useContext(MoneyCtx);

/** Eases a number towards its new value, so a change reads as movement. */
export function useTween(target: number, ms = 420) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (!Number.isFinite(target) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      setV(target);
      return;
    }
    const start = performance.now();
    const a = Number.isFinite(from.current) ? from.current : target;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const x = a + (target - a) * (1 - Math.pow(1 - k, 3));
      from.current = x;
      setV(x);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** An amount in the data's currency, shown converted. */
export function Amount({ v, className = "", serif = false, digits = 0 }: { v: number; className?: string; serif?: boolean; digits?: number }) {
  const m = useMoney();
  const t = useTween(v * m.k);
  return <span className={`${serif ? "[font-variant-numeric:tabular-nums]" : "figure"} ${className}`}>{m.fmt(t, digits)}</span>;
}

export function Count({ v, className = "" }: { v: number; className?: string }) {
  const t = useTween(v);
  return <span className={`figure ${className}`}>{Math.round(t).toLocaleString("en")}</span>;
}

/** A number inside a sentence that can be changed. */
export function Inline({ value, display, min, max, step = 1, onChange, label }: { value: number; display?: string; min: number; max: number; step?: number; onChange: (v: number) => void; label: string }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  return (
    <span className="inline-num" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label={`Less: ${label}`}>
        −
      </button>
      <span className="[font-variant-numeric:tabular-nums]" aria-live="polite">
        {display ?? value}
      </span>
      <button type="button" onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={`More: ${label}`}>
        +
      </button>
    </span>
  );
}

export function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <select className="inline-select text-bone" value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
      {options.map(([v, t]) => (
        <option key={v} value={v}>
          {t}
        </option>
      ))}
    </select>
  );
}

export function Section({ id, kicker, title, children }: { id: string; kicker: string; title: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="arrive scroll-mt-20 border-t border-rule py-20 md:py-28">
      <p className="eyebrow">{kicker}</p>
      <h2 className="mt-4 max-w-[24ch] font-serif text-[clamp(1.9rem,3.8vw,2.8rem)] leading-[1.06] tracking-[-0.01em]">{title}</h2>
      <div className="mt-10">{children}</div>
    </section>
  );
}

export function Stat({ label, children, note, tone = "" }: { label: string; children: ReactNode; note?: ReactNode; tone?: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className={`mt-3 text-[1.75rem] leading-none ${tone}`}>{children}</dd>
      {note && <dd className="mt-2 text-[14px] text-ash">{note}</dd>}
    </div>
  );
}

export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
