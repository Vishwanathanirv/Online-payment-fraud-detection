import { useRef, useState } from "react";
import type { Table } from "./engine/csv";
import type { Dataset } from "./engine/dataset";
import { currencyList, type Rates } from "./engine/money";
import { buildDataset, FIELD_LABEL, guessMapping, REQUIRED, TEMPLATE, type Field, type Mapping } from "./engine/mapping";

const OPTIONAL: Field[] = ["id", "score2", "merchant", "category", "country", "channel", "device", "decision"];
const MAX_BYTES = 300 * 1024 * 1024;

/** Mappings are remembered per header layout, in this browser only. */
const memoKey = (header: string[]) => `fraudlens-map:${header.join("|").toLowerCase()}`;
function recall(header: string[]): Mapping | null {
  try {
    const raw = localStorage.getItem(memoKey(header));
    return raw ? (JSON.parse(raw) as Mapping) : null;
  } catch {
    return null;
  }
}
function remember(header: string[], m: Mapping) {
  try {
    localStorage.setItem(memoKey(header), JSON.stringify(m));
  } catch {
    /* storage unavailable: the mapping just isn't remembered */
  }
}

function parseInWorker(text: string): Promise<Table> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./engine/parse.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ ok: boolean; table?: Table; error?: string }>) => {
      w.terminate();
      if (e.data.ok) resolve(e.data.table!);
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || "The file couldn't be read."));
    };
    w.postMessage(text);
  });
}

export function Import({ current, rates, onLoad, onReset }: { current: Dataset; rates: Rates | null; onLoad: (d: Dataset, note: string | null) => void; onReset: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<{ t: Table; name: string } | null>(null);
  const [map, setMap] = useState<Mapping>({});
  const [currency, setCurrency] = useState("EUR");
  const [over, setOver] = useState(false);

  const open = async (f: File) => {
    setError(null);
    setTable(null);
    if (f.size > MAX_BYTES) {
      setError("Over 300 MB. Export fewer days or fewer columns.");
      return;
    }
    if (/\.(xlsx|xls|numbers)$/i.test(f.name)) {
      setError("Save the sheet as CSV first (File, Save as, CSV).");
      return;
    }
    try {
      setBusy(`Reading ${f.name}…`);
      const t = await parseInWorker(await f.text());
      setMap(recall(t.header) ?? guessMapping(t.header));
      setTable({ t, name: f.name });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const analyse = () => {
    if (!table) return;
    try {
      const { dataset, skipped } = buildDataset(table.t, map, table.name, currency);
      remember(table.t.header, map);
      onLoad(dataset, skipped ? `${skipped.toLocaleString("en")} unreadable rows skipped.` : null);
      setTable(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const template = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "fraudlens-template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const fieldRow = (f: Field, required: boolean) => {
    const c = map[f];
    const sample = table && c !== undefined ? table.t.rows.slice(0, 3).map((r) => r[c]).join(" · ") : "";
    return (
      <tr key={f} className="border-t border-rule-soft">
        <td className="py-2.5 pr-6 text-ash">
          {FIELD_LABEL[f]}
          {required && <span className="text-smoke"> *</span>}
        </td>
        <td className="py-2.5 pr-6">
          <select
            className="inline-select text-bone"
            value={c ?? ""}
            aria-label={`Column for ${FIELD_LABEL[f]}`}
            onChange={(e) => {
              const v = e.target.value === "" ? undefined : Number(e.target.value);
              setMap((m) => ({ ...m, [f]: v }));
            }}
          >
            <option value="">—</option>
            {table!.t.header.map((h, i) => (
              <option key={i} value={i}>
                {h || `column ${i + 1}`}
              </option>
            ))}
          </select>
        </td>
        <td className="figure max-w-[18rem] truncate py-2.5 text-[13px] text-smoke">{sample}</td>
      </tr>
    );
  };

  return (
    <div>
      {!table && (
        <div
          className={`border border-dashed px-6 py-14 text-center transition-colors ${over ? "border-bone bg-desk-2" : "border-rule"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void open(f);
          }}
        >
          <p className="display text-[1.6rem] !leading-snug">{busy ?? "Drop a CSV of scored, labelled transactions."}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-x-8 gap-y-3 text-[15px]">
            <button className="link" onClick={() => input.current?.click()}>
              Choose a file
            </button>
            <button className="link" onClick={template}>
              Template
            </button>
            {current.kind === "own" && (
              <button className="link" onClick={onReset}>
                Back to the public data
              </button>
            )}
          </div>
          <p className="mt-6 text-[14px] text-smoke">Read in this browser. Never uploaded.</p>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/plain"
        className="hidden"
        aria-label="Your transactions file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void open(f);
          e.target.value = "";
        }}
      />

      {table && (
        <div>
          <p className="text-ash">
            <span className="text-bone">{table.name}</span> · {table.t.rows.length.toLocaleString("en")} rows · {table.t.header.length} columns
          </p>
          <table className="mt-6 w-full max-w-3xl text-[15px]">
            <tbody>
              {REQUIRED.map((f) => fieldRow(f, true))}
              {OPTIONAL.map((f) => fieldRow(f, false))}
              <tr className="border-t border-rule-soft">
                <td className="py-2.5 pr-6 text-ash">Currency</td>
                <td className="py-2.5" colSpan={2}>
                  <select className="inline-select text-bone" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency of your amounts">
                    {currencyList(rates, "EUR").map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-[15px]">
            <button className="rounded-full bg-lamp px-5 py-2 font-medium text-ink transition-transform active:scale-95" onClick={analyse}>
              Analyse
            </button>
            <button className="link" onClick={() => setTable(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-6 max-w-xl text-[15px] text-lost">
          {error}
        </p>
      )}
    </div>
  );
}
