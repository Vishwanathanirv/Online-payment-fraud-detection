import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const file = (name: string, rows: string[]) => ({ name, mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });

/**
 * Synthetic test data, labelled as such: 240 days of payments, three a day, with a fraud every
 * other day reported 5 to 45 days later. The file ends on day 240, so recent fraud is unreported.
 */
function history() {
  const day = 86400_000;
  const start = Date.UTC(2026, 0, 1);
  const end = start + 240 * day;
  const tx = ["id,time,amount,score,fraud,channel,network"];
  const disputes = ["Transaction ID,Dispute Date,Reason Code"];
  for (let d = 0; d < 240; d++) {
    for (let k = 0; k < 3; k++) tx.push(`g${d}-${k},${new Date(start + d * day + k * 3600_000).toISOString()},${20 + k},0.0${k + 1},0,${k ? "online" : "pos"},${k === 2 ? "mastercard" : "visa"}`);
    if (d % 2) continue;
    const at = start + d * day + 5 * 3600_000;
    const reported = at + (5 + (d % 9) * 5) * day;
    // Reported fraud carries its label; fraud whose report hasn't come by the file's end still looks genuine.
    tx.push(`f${d},${new Date(at).toISOString()},400,0.6,0,online,visa`);
    if (reported <= end) disputes.push(`f${d},${new Date(reported).toISOString().slice(0, 10)},10.4`);
  }
  return { tx, disputes };
}

test("a rule is backtested as it is typed, and can join the policy", async ({ page }) => {
  await page.goto("/");
  const rules = page.locator("#rules");
  const input = rules.getByRole("textbox", { name: "Rule 1" });
  await expect(input).toHaveValue("amount >= 500 and gbdt >= 0.05");
  await expect(rules.getByText("Matches")).toBeVisible();
  await input.fill("amout > 5");
  await expect(rules.getByRole("alert")).toContainText(`"amout" isn't a field`);
  await input.fill("amount > 100 and gbdt > 0.5");
  await expect(rules.getByText("Net")).toBeVisible();
  await rules.getByRole("combobox", { name: "Rule 1 action" }).selectOption("block");
  await rules.getByRole("checkbox", { name: "In the policy" }).check();
  await expect(page.locator("#overview p.eyebrow")).toContainText("1 rule in the policy");
  await expect(page).toHaveURL(/r=1b/);
  await page.reload();
  await expect(page.locator("#rules").getByRole("textbox", { name: "Rule 1" })).toHaveValue("amount > 100 and gbdt > 0.5");
  await expect(page.locator("#overview p.eyebrow")).toContainText("1 rule in the policy");
});

test("the public window is judged against the card-network limits as one period", async ({ page }) => {
  await page.goto("/");
  const m = page.locator("#disputes");
  await expect(m.getByRole("row", { name: /Whole window/ })).toBeVisible();
  await expect(m).toContainText("hours without calendar dates: judged as one period");
  await expect(m).toContainText("fraud labels stand in");
  await m.getByRole("button", { name: "More: Visa ratio" }).click();
  await expect(page).toHaveURL(/vr=1\.6/);
});

test("disputes joined to your file show late labels, and maturity changes what is judged", async ({ page }) => {
  const { tx, disputes } = history();
  await page.goto("/");
  await expect(page.locator("#labels")).toContainText("no report dates");
  // The transactions file knows of one fraud; the processor's dispute export knows the rest.
  await page.getByLabel("Your transactions file").setInputFiles(file("history.csv", tx.map((l) => (l.startsWith("f0,") ? l.replace(",0,online,", ",1,online,") : l))));
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page.locator("header")).toContainText("history.csv");
  const labels = page.locator("#labels");
  await expect(labels).toContainText("join your processor's disputes export");
  await labels.getByLabel("Your disputes file").setInputFiles(file("disputes.csv", disputes));
  await expect(labels.getByRole("combobox", { name: "Column for Reason code" })).toHaveValue("2");
  await labels.getByRole("button", { name: "Join" }).click();
  await expect(page.locator("#overview")).toContainText("disputed payments joined from disputes.csv");
  await expect(page.locator("#overview")).toContainText("newly marked fraud by reason code");
  await expect(labels).toContainText("Half of reports arrive within");
  await expect(page.locator("header")).toContainText("0 network requests since opening");
});

test("a file with report dates: delays, unreported fraud and monthly ratios", async ({ page }) => {
  const { tx, disputes } = history();
  // Fold the disputes into the transactions as a reported_at column, and label the reported fraud.
  const reported = new Map(disputes.slice(1).map((l) => l.split(",") as [string, string, string]).map(([id, date]) => [id, date]));
  const rows = [
    tx[0] + ",reported_at",
    ...tx.slice(1).map((l) => {
      const id = l.split(",")[0];
      const r = reported.get(id);
      return r ? l.replace(/,0,online,/, ",1,online,") + `,${r}` : l + ",";
    }),
  ];
  await page.goto("/");
  await page.getByLabel("Your transactions file").setInputFiles(file("history.csv", rows));
  await expect(page.getByRole("combobox", { name: "Column for Reported at" })).toHaveValue("7");
  await page.getByRole("button", { name: "Analyse" }).click();
  const labels = page.locator("#labels");
  await expect(labels).toContainText("Half of reports arrive within");
  await expect(labels).toContainText("unreported fraud");
  const payments = async () => Number(((await page.locator("header").innerText()).match(/([\d,]+) payments/)?.[1] ?? "0").replace(/,/g, ""));
  const all = await payments();
  await labels.getByRole("checkbox").check();
  await expect(page.locator("#overview p.eyebrow")).toContainText("payments older than");
  expect(await payments()).toBeLessThan(all);
  const monthly = page.locator("#disputes");
  await expect(monthly.getByRole("row", { name: /Feb 2026/ })).toBeVisible();
  await expect(monthly).toContainText("Counted in the month the report came in");
  await expect(monthly.getByRole("checkbox", { name: "online" })).toBeChecked();
  await expect(monthly.getByRole("checkbox", { name: "pos" })).not.toBeChecked();
  await expect(page.locator("header")).toContainText("0 network requests since opening");
});

test("the decision record downloads with the policy and its outcome", async ({ page }) => {
  await page.goto("/");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download the decision record" }).click()]);
  const text = readFileSync(await download.path(), "utf8");
  expect(download.suggestedFilename()).toMatch(/^fraudlens-decision-\d{4}-\d{2}-\d{2}\.txt$/);
  expect(text).toContain("Block at score >=");
  expect(text).toContain("Total cost: EUR");
});

test("calibration sets each score band against the fraud seen", async ({ page }) => {
  await page.goto("/");
  const c = page.locator("#calibration");
  await expect(c).toContainText("turned out to be fraud");
  await expect(c.getByRole("row")).toHaveCount(11);
});

test("models compete at their own cheapest lines, and one click switches", async ({ page }) => {
  await page.goto("/");
  const s = page.locator("#models");
  await expect(s).toContainText("is cheapest, by");
  await expect(s.getByRole("row")).toHaveCount(4);
  await s.getByRole("button", { name: "Use" }).first().click();
  await expect(s.getByText("in use")).toHaveCount(1);
});

test("drift compares the earlier and later half", async ({ page }) => {
  await page.goto("/");
  const s = page.locator("#drift");
  await expect(s).toContainText("between the earlier and later half");
  await expect(s.getByRole("row")).toHaveCount(7);
});
