/** Delimited text to a header and rows. Handles quoted fields, doubled quotes and a leading byte-order mark. */
export type Table = { header: string[]; rows: string[][]; delimiter: string };

export function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

export function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseTable(text: string): Table {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/);
  let first = 0;
  while (first < lines.length && !lines[first].trim()) first++;
  if (first >= lines.length) throw new Error("The file is empty.");
  const delimiter = detectDelimiter(lines[first]);
  const header = splitLine(lines[first], delimiter);
  const rows: string[][] = [];
  for (let i = first + 1; i < lines.length; i++) if (lines[i].trim()) rows.push(splitLine(lines[i], delimiter));
  if (!rows.length) throw new Error("The file has a header but no rows.");
  return { header, rows, delimiter };
}
