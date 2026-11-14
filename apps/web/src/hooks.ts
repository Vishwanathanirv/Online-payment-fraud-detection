import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Tx } from "./api";

/** Subscribes to the server-sent event stream of scored transactions. */
export function useLiveFeed(max = 60) {
  const [items, setItems] = useState<Tx[]>([]);
  const [connected, setConnected] = useState(false);
  const fresh = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    api<{ transactions: Tx[] }>(`/api/transactions?limit=${max}`).then((r) => !cancelled && setItems(r.transactions)).catch(() => {});
    const es = new EventSource("/api/stream");
    es.addEventListener("hello", () => setConnected(true));
    es.addEventListener("tx", (e) => {
      const tx = JSON.parse((e as MessageEvent).data) as Tx;
      fresh.current.add(tx.id);
      setTimeout(() => fresh.current.delete(tx.id), 1500);
      setItems((prev) => [tx, ...prev.filter((p) => p.id !== tx.id)].slice(0, max));
    });
    es.onerror = () => setConnected(false);
    return () => {
      cancelled = true;
      es.close();
    };
  }, [max]);

  return { items, connected, isFresh: (id: string) => fresh.current.has(id), setItems };
}

/** Polls an endpoint on an interval and exposes a manual refresh. */
export function usePoll<T>(path: string | null, ms = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    void load();
    if (!ms) return;
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load, ms]);
  return { data, error, reload: load };
}
