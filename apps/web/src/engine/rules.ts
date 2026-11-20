import { CAT_FIELDS, type CatField, type Dataset } from "./dataset";

/**
 * Rules the way fraud teams write them, checked against history:
 *   amount > 500 and country in ("NG", "GH")
 *   count_1h(device) >= 4 or (gbdt > 0.3 and channel = "online")
 * Parsed into a tree and compiled to a row test; nothing is ever passed to eval.
 */

export type RuleAction = "block" | "review";
export type Rule = { x: string; a: RuleAction; on: boolean };

type Lit = { k: "num"; v: number } | { k: "str"; v: string };
type Val = Lit | { k: "field"; f: string; at: number } | { k: "win"; fn: WinFn; f: string; at: number };
type Node = { k: "and"; a: Node; b: Node } | { k: "or"; a: Node; b: Node } | { k: "not"; a: Node } | { k: "cmp"; op: Op; l: Val; r: Val; at: number } | { k: "in"; v: Val; list: Lit[]; neg: boolean; at: number } | { k: "val"; v: Val; at: number };
type Op = "=" | "!=" | "<" | "<=" | ">" | ">=";

export const WINDOWS = ["count_1h", "count_24h", "sum_1h", "sum_24h"] as const;
type WinFn = (typeof WINDOWS)[number];

export class RuleError extends Error {
  constructor(
    message: string,
    public at: number,
  ) {
    super(message);
  }
}

type Tok = { t: "id" | "num" | "str" | "op" | "punct" | "end"; v: string; at: number };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const at = i;
    if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
      out.push({ t: "id", v: src.slice(at, i).toLowerCase(), at });
    } else if (/[0-9.]/.test(c) || (c === "-" && /[0-9.]/.test(src[i + 1] ?? "") && (!out.length || out[out.length - 1].t === "op" || out[out.length - 1].v === "(" || out[out.length - 1].v === ","))) {
      // A minus is part of a number after an operator, a bracket or a comma: score > -1.5.
      if (c === "-") i++;
      while (i < src.length && /[0-9._]/.test(src[i])) i++;
      const raw = src.slice(at, i).replace(/_/g, "");
      if (!/^-?(\d+\.?\d*|\.\d+)$/.test(raw)) throw new RuleError(`"${raw}" isn't a number.`, at);
      out.push({ t: "num", v: raw, at });
    } else if (c === '"' || c === "'") {
      i++;
      let s = "";
      while (i < src.length && src[i] !== c) s += src[i++];
      if (i >= src.length) throw new RuleError("A quote is never closed.", at);
      i++;
      out.push({ t: "str", v: s, at });
    } else if ("<>=!".includes(c)) {
      const two = src.slice(i, i + 2);
      if (["<=", ">=", "!=", "==", "<>"].includes(two)) {
        out.push({ t: "op", v: two === "==" ? "=" : two === "<>" ? "!=" : two, at });
        i += 2;
      } else if (c === "!") throw new RuleError('Use "not" or "!=".', at);
      else {
        out.push({ t: "op", v: c, at });
        i++;
      }
    } else if ("(),".includes(c)) {
      out.push({ t: "punct", v: c, at });
      i++;
    } else if (c === "&" && src[i + 1] === "&") {
      out.push({ t: "id", v: "and", at });
      i += 2;
    } else if (c === "|" && src[i + 1] === "|") {
      out.push({ t: "id", v: "or", at });
      i += 2;
    } else throw new RuleError(`"${c}" isn't understood here.`, at);
  }
  out.push({ t: "end", v: "", at: src.length });
  return out;
}

export const MAX_RULE = 500;
const MAX_DEPTH = 40;

export function parse(src: string): Node {
  if (src.length > MAX_RULE) throw new RuleError(`Keep a rule under ${MAX_RULE} characters; split it into two.`, MAX_RULE);
  const toks = lex(src);
  let p = 0;
  // Brackets and "not" nest; past this depth the rule is refused rather than overflowing the stack.
  let depth = 0;
  const deeper = (at: number) => {
    if (++depth > MAX_DEPTH) throw new RuleError("Too deeply nested.", at);
  };
  const peek = () => toks[p];
  const take = () => toks[p++];
  const isKw = (w: string) => peek().t === "id" && peek().v === w;
  const expect = (v: string) => {
    const t = take();
    if (t.v !== v || (t.t !== "punct" && t.t !== "op")) throw new RuleError(`Expected "${v}".`, t.at);
  };
  const lit = (): Lit => {
    const t = take();
    if (t.t === "num") return { k: "num", v: Number(t.v) };
    if (t.t === "str") return { k: "str", v: t.v };
    if (t.t === "id" && t.v !== "and" && t.v !== "or" && t.v !== "not" && t.v !== "in") return { k: "str", v: t.v };
    throw new RuleError("Expected a value.", t.at);
  };
  const val = (): Val => {
    const t = peek();
    if (t.t === "num" || t.t === "str") return lit();
    if (t.t === "id" && !["and", "or", "not", "in"].includes(t.v)) {
      take();
      if (peek().t === "punct" && peek().v === "(") {
        if (!(WINDOWS as readonly string[]).includes(t.v)) throw new RuleError(`"${t.v}" isn't a function. Use ${WINDOWS.join(", ")}.`, t.at);
        take();
        const f = take();
        if (f.t !== "id") throw new RuleError(`${t.v} takes a field, for example ${t.v}(device).`, f.at);
        expect(")");
        return { k: "win", fn: t.v as WinFn, f: f.v, at: t.at };
      }
      return { k: "field", f: t.v, at: t.at };
    }
    throw new RuleError(t.t === "end" ? "The rule ends too early." : `Expected a field or a value, found "${t.v}".`, t.at);
  };
  const cmp = (): Node => {
    const t = peek();
    if (t.t === "punct" && t.v === "(") {
      take();
      deeper(t.at);
      const e = or();
      depth--;
      expect(")");
      return e;
    }
    const l = val();
    let neg = false;
    if (isKw("not") && toks[p + 1]?.t === "id" && toks[p + 1].v === "in") {
      take();
      neg = true;
    }
    if (isKw("in")) {
      take();
      expect("(");
      const list: Lit[] = [lit()];
      while (peek().t === "punct" && peek().v === ",") {
        take();
        list.push(lit());
      }
      expect(")");
      return { k: "in", v: l, list, neg, at: t.at };
    }
    if (peek().t === "op") {
      const op = take().v as Op;
      return { k: "cmp", op, l, r: val(), at: t.at };
    }
    return { k: "val", v: l, at: t.at };
  };
  const not = (): Node => {
    if (isKw("not")) {
      deeper(take().at);
      const a = not();
      depth--;
      return { k: "not", a };
    }
    return cmp();
  };
  const and = (): Node => {
    let a = not();
    while (isKw("and")) {
      take();
      a = { k: "and", a, b: not() };
    }
    return a;
  };
  const or = (): Node => {
    let a = and();
    while (isKw("or")) {
      take();
      a = { k: "or", a, b: and() };
    }
    return a;
  };
  if (peek().t === "end") throw new RuleError("Write a rule, for example: amount > 500.", 0);
  const tree = or();
  if (peek().t !== "end") throw new RuleError(`"${peek().v}" isn't expected here. Join conditions with "and" or "or".`, peek().at);
  return tree;
}

/* ───────────── the fields a rule can read */

/** Score columns are named by model: gbdt, logreg, iforest on the public data; score, score2 on a file. */
export const scoreField = (id: string) => (id === "own" ? "score" : id === "own2" ? "score2" : id);

export type Fields = { numeric: string[]; text: CatField[]; windows: boolean };

export function fieldsOf(d: Dataset): Fields {
  const numeric = ["amount", ...d.models.map(scoreField), "hour"];
  if (d.timeKind === "epoch") numeric.push("weekday");
  const text = CAT_FIELDS.filter((f) => d.cats[f]);
  return { numeric, text, windows: text.length > 0 };
}

/** A text column as rules compare it: trimmed, lower case. Kept per dataset. */
const textCache = new WeakMap<Dataset, Map<CatField, string[]>>();
function textOf(d: Dataset, field: CatField) {
  let m = textCache.get(d);
  if (!m) textCache.set(d, (m = new Map()));
  if (!m.has(field)) m.set(field, d.cats[field]!.map((x) => (x ?? "").trim().toLowerCase()));
  return m.get(field)!;
}
const isBlank = (k: string) => k === "" || k === "(blank)";

/**
 * Payments with the same value in the window ending at each payment, itself included. Payments
 * with no value aren't one shared entity: their window is 0.
 */
function windowColumn(d: Dataset, fn: WinFn, field: CatField): Float64Array {
  const keys = textOf(d, field);
  const span = fn.endsWith("_1h") ? 3600 : 86400;
  const sum = fn.startsWith("sum");
  const out = new Float64Array(d.t.length);
  const groups = new Map<string, number[]>();
  for (let i = 0; i < d.t.length; i++) {
    if (isBlank(keys[i])) continue;
    const g = groups.get(keys[i]);
    if (g) g.push(i);
    else groups.set(keys[i], [i]);
  }
  for (const g of groups.values()) {
    let lo = 0;
    let acc = 0;
    for (let k = 0; k < g.length; k++) {
      acc += sum ? d.amount[g[k]] : 1;
      while (d.t[g[lo]] <= d.t[g[k]] - span) {
        acc -= sum ? d.amount[g[lo]] : 1;
        lo++;
      }
      out[g[k]] = acc;
    }
  }
  return out;
}

const windowCache = new WeakMap<Dataset, Map<string, Float64Array>>();
function windowOf(d: Dataset, fn: WinFn, field: CatField) {
  let m = windowCache.get(d);
  if (!m) windowCache.set(d, (m = new Map()));
  const key = `${fn}:${field}`;
  if (!m.has(key)) m.set(key, windowColumn(d, fn, field));
  return m.get(key)!;
}

type Col = { kind: "num"; at: (i: number) => number } | { kind: "text"; at: (i: number) => string };

function column(d: Dataset, v: Val): Col {
  const f = fieldsOf(d);
  const list = () => [...f.numeric, ...f.text].join(", ");
  if (v.k === "num") return { kind: "num", at: () => v.v };
  if (v.k === "str") return { kind: "text", at: () => v.v.trim().toLowerCase() };
  if (v.k === "win") {
    if (!(CAT_FIELDS as readonly string[]).includes(v.f) || !d.cats[v.f as CatField]) throw new RuleError(f.text.length ? `${v.fn} needs a text field: ${f.text.join(", ")}.` : `${v.fn} needs a text column, such as device, in your file.`, v.at);
    const c = windowOf(d, v.fn, v.f as CatField);
    return { kind: "num", at: (i) => c[i] };
  }
  const name = v.f;
  if (name === "amount") return { kind: "num", at: (i) => d.amount[i] };
  if (name === "hour") return { kind: "num", at: d.timeKind === "epoch" ? (i) => new Date(d.t[i] * 1000).getUTCHours() : (i) => Math.floor(d.t[i] / 3600) % 24 };
  if (name === "weekday" && d.timeKind === "epoch") return { kind: "num", at: (i) => (new Date(d.t[i] * 1000).getUTCDay() + 6) % 7 };
  const model = d.models.find((m) => scoreField(m) === name);
  if (model) {
    const s = d.score[model];
    return { kind: "num", at: (i) => s[i] };
  }
  if ((CAT_FIELDS as readonly string[]).includes(name) && d.cats[name as CatField]) {
    const c = textOf(d, name as CatField);
    return { kind: "text", at: (i) => c[i] };
  }
  throw new RuleError(`"${name}" isn't a field here. Fields: ${list()}.`, v.at);
}

export type Test = (i: number) => boolean;

export function compile(d: Dataset, src: string): Test {
  const build = (n: Node): Test => {
    if (n.k === "and") {
      const a = build(n.a);
      const b = build(n.b);
      return (i) => a(i) && b(i);
    }
    if (n.k === "or") {
      const a = build(n.a);
      const b = build(n.b);
      return (i) => a(i) || b(i);
    }
    if (n.k === "not") {
      const a = build(n.a);
      return (i) => !a(i);
    }
    if (n.k === "val") throw new RuleError("Compare it with something, for example: amount > 500.", n.at);
    if (n.k === "in") {
      const c = column(d, n.v);
      if (c.kind === "num") {
        const set = new Set(n.list.map((x) => (x.k === "num" ? x.v : Number(x.v))));
        return (i) => set.has(c.at(i)) !== n.neg;
      }
      const set = new Set(n.list.map((x) => String(x.v).trim().toLowerCase()));
      return (i) => set.has(c.at(i)) !== n.neg;
    }
    const l = column(d, n.l);
    let r: Col;
    try {
      r = column(d, n.r);
    } catch (e) {
      // country = NG: an unknown bare word next to a text field is the value itself.
      if (!(e instanceof RuleError) || n.r.k !== "field" || l.kind !== "text") throw e;
      const word = n.r.f;
      r = { kind: "text", at: () => word };
    }
    if (l.kind === "text" || r.kind === "text") {
      if (n.op !== "=" && n.op !== "!=") throw new RuleError("Text can only be compared with = or !=.", n.at);
      const ls = l.kind === "text" ? l.at : (i: number) => String(l.at(i));
      const rs = r.kind === "text" ? r.at : (i: number) => String(r.at(i));
      return n.op === "=" ? (i) => ls(i) === rs(i) : (i) => ls(i) !== rs(i);
    }
    const a = l.at;
    const b = r.at;
    switch (n.op) {
      case "=":
        return (i) => a(i) === b(i);
      case "!=":
        return (i) => a(i) !== b(i);
      case "<":
        return (i) => a(i) < b(i);
      case "<=":
        return (i) => a(i) <= b(i);
      case ">":
        return (i) => a(i) > b(i);
      case ">=":
        return (i) => a(i) >= b(i);
    }
  };
  return build(parse(src));
}

export function matches(d: Dataset, test: Test): Uint8Array {
  const out = new Uint8Array(d.t.length);
  for (let i = 0; i < out.length; i++) out[i] = test(i) ? 1 : 0;
  return out;
}

/** Forced bands from rules: 2 block, 1 review, 0 left to the score. Rules that fail to compile are skipped. */
export function forceOf(d: Dataset, rules: Rule[]): Uint8Array | undefined {
  const live = rules.filter((r) => r.on);
  if (!live.length) return undefined;
  const out = new Uint8Array(d.t.length);
  for (const r of live) {
    let test: Test;
    try {
      test = compile(d, r.x);
    } catch {
      continue;
    }
    const v = r.a === "block" ? 2 : 1;
    for (let i = 0; i < out.length; i++) if (out[i] < v && test(i)) out[i] = v;
  }
  return out;
}

/** Whether a rule compiles on this data; one that doesn't is left out of the policy. */
export function compiles(d: Dataset, x: string): boolean {
  try {
    compile(d, x);
    return true;
  } catch {
    return false;
  }
}
