/**
 * The shareable case file: the same facts, stamp and counterfactual, drawn onto a 1200×630 card
 * (the size link previews use), with the case's own address printed on it.
 */
export type CardFacts = {
  number: string;
  seen: string;
  amount: string;
  risk: string;
  line: string;
  truth: string;
  declined: boolean;
  headline: string;
  reasons: { name: string; value: number }[];
  whatIf: string[];
  url: string;
};

export function drawCaseCard(c: CardFacts, scale = 1): HTMLCanvasElement {
  const W = 1200;
  const H = 630;
  const cv = document.createElement("canvas");
  cv.width = W * scale;
  cv.height = H * scale;
  const g = cv.getContext("2d")!;
  g.scale(scale, scale);
  const serif = '"Fraunces Variable", Georgia, serif';
  const mono = '"JetBrains Mono Variable", ui-monospace, monospace';
  const sans = '"Hanken Grotesk Variable", system-ui, sans-serif';

  // The room, the lamp, and the folder.
  g.fillStyle = "#0c0b0a";
  g.fillRect(0, 0, W, H);
  const lamp = g.createRadialGradient(W / 2, -80, 40, W / 2, -80, 760);
  lamp.addColorStop(0, "rgba(255,196,119,0.22)");
  lamp.addColorStop(1, "rgba(255,196,119,0)");
  g.fillStyle = lamp;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#8c7a55";
  g.fillRect(48, 70, W - 96, H - 110);
  g.fillRect(80, 44, 190, 30);
  g.fillStyle = "#2b2416";
  g.font = `500 15px ${mono}`;
  g.fillText(c.number, 104, 66);
  const paper = g.createLinearGradient(0, 84, 0, H - 52);
  paper.addColorStop(0, "#e9dcbd");
  paper.addColorStop(1, "#d6c69f");
  g.fillStyle = paper;
  g.fillRect(62, 84, W - 124, H - 138);

  const ink = "#221c13";
  const soft = "#5a4e3a";
  g.fillStyle = soft;
  g.font = `500 13px ${mono}`;
  g.fillText("FRAUDLENS · CASE FILE · REAL PAYMENT, ULB / WORLDLINE TEST WINDOW", 100, 128);
  g.fillStyle = ink;
  g.font = `420 46px ${serif}`;
  g.fillText(c.headline, 100, 186);

  // Facts, typed.
  const facts: [string, string][] = [
    ["Seen", c.seen],
    ["Amount", c.amount],
    ["Risk", c.risk],
    ["Line", c.line],
    ["Truth", c.truth],
  ];
  facts.forEach(([k, v], i) => {
    g.fillStyle = soft;
    g.font = `400 17px ${mono}`;
    g.fillText(k, 100, 240 + i * 36);
    g.fillStyle = ink;
    g.font = `${k === "Amount" || k === "Risk" ? 700 : 400} 17px ${mono}`;
    g.fillText(v, 196, 240 + i * 36);
  });

  // The stamp.
  g.save();
  g.translate(250, 480);
  g.rotate((-7 * Math.PI) / 180);
  g.strokeStyle = g.fillStyle = c.declined ? "#b3261e" : "#1f6e57";
  g.globalAlpha = 0.88;
  g.lineWidth = 4;
  g.font = `800 34px ${mono}`;
  const label = c.declined ? "DECLINED" : "LET THROUGH";
  const tw = g.measureText(label).width + 40;
  g.strokeRect(-tw / 2, -30, tw, 58);
  g.textAlign = "center";
  g.fillText(label, 0, 12);
  g.restore();

  // Why, and what would have cleared it.
  const x0 = 640;
  g.fillStyle = soft;
  g.font = `500 13px ${mono}`;
  g.fillText("WHY THE MODEL FLAGGED IT", x0, 234);
  const max = Math.max(0.01, ...c.reasons.map((r) => Math.abs(r.value)));
  c.reasons.slice(0, 4).forEach((r, i) => {
    const y = 268 + i * 30;
    g.fillStyle = ink;
    g.font = `400 16px ${sans}`;
    g.fillText(r.name, x0, y);
    g.fillStyle = "rgba(34,28,19,0.12)";
    g.fillRect(x0 + 170, y - 8, 260, 6);
    g.fillStyle = r.value > 0 ? "#b3261e" : "#1f6e57";
    g.fillRect(x0 + 170, y - 8, (Math.abs(r.value) / max) * 260, 6);
  });
  g.fillStyle = soft;
  g.font = `500 13px ${mono}`;
  g.fillText("WHAT WOULD HAVE CLEARED IT", x0, 410);
  g.fillStyle = ink;
  g.font = `400 17px ${sans}`;
  c.whatIf.slice(0, 4).forEach((line, i) => g.fillText(line, x0, 442 + i * 27, W - x0 - 100));

  g.fillStyle = soft;
  g.font = `400 13px ${mono}`;
  g.fillText(c.url, 100, H - 70);
  return cv;
}

export function downloadCanvas(cv: HTMLCanvasElement, name: string) {
  return new Promise<void>((resolve) =>
    cv.toBlob((blob) => {
      if (!blob) return resolve();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      resolve();
    }, "image/png"),
  );
}
