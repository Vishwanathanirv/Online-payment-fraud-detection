import { expect, test, type Page } from "@playwright/test";

const money = async (page: Page, sel: string) => Number((await page.locator(sel).first().innerText()).replace(/[^\d]/g, ""));
const csv = (rows: string[]) => ({ name: "queue.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });

test("loads the real test window with the cheapest policy", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("of €7,729 fraud");
  await expect(page.locator("header")).toContainText("56,962 payments");
  await expect(page).toHaveURL(/#a=2&min=6/);
  expect(errors).toEqual([]);
});

test("moving the review line changes the bands and the cost", async ({ page }) => {
  await page.goto("/");
  const t = page.locator("#thresholds");
  await t.scrollIntoViewIfNeeded();
  const reviewRow = t.locator("tbody tr").nth(1);
  const before = await reviewRow.innerText();
  await t.getByRole("button", { name: "Lower: review line" }).click();
  await t.getByRole("button", { name: "Lower: review line" }).click();
  await expect(reviewRow).not.toHaveText(before);
  await t.getByRole("button", { name: "Cheapest", exact: true }).click();
  await expect(reviewRow).toHaveText(before);
});

test("a smaller team times out reviews and lets fraud through", async ({ page }) => {
  await page.goto("/");
  const s = page.locator("#staffing");
  await s.scrollIntoViewIfNeeded();
  const less = s.getByRole("button", { name: "Less: analysts" });
  while (await less.isEnabled()) await less.click();
  await expect(s.getByText("Reviewed in time").locator("..")).toContainText("0");
  await expect(page.locator("#overview")).toContainText("timed out");
});

test("segments break fraud down, and cases list what the policy touched", async ({ page }) => {
  await page.goto("/");
  await page.locator("#segments").scrollIntoViewIfNeeded();
  await expect(page.locator("#segments tbody tr")).toHaveCount(6);
  await page.locator("#segments").getByRole("tab", { name: "Hour" }).click();
  await expect(page.locator("#segments tbody tr").first()).toContainText(":00");
  const cases = page.locator("#cases");
  await cases.scrollIntoViewIfNeeded();
  await cases.locator("tbody tr").first().click();
  await expect(cases.getByText(/Component V\d+/).first()).toBeVisible();
});

test("every amount converts to the chosen currency", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Currency" }).selectOption("INR");
  await expect(page.locator("h1")).toContainText("₹");
  await expect(page.locator("h1")).not.toContainText("€");
  await expect(page.getByText(/Converted from EUR at the ECB rate of \d{4}-\d{2}-\d{2}/)).toBeVisible();
});

test("your own file: mapped, analysed in the browser, with no network requests", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page
    .getByLabel("Your transactions file")
    .setInputFiles(csv(["Transaction ID;Created At;Amount;Risk Score;Is Fraud;Billing Country", "a;2026-11-02T09:00:00Z;40,00;0.01;false;IE", "b;2026-11-02T09:10:00Z;1.800,00;0.92;true;NG", "c;2026-11-02T09:20:00Z;12,00;0.02;false;IE", "d;2026-11-02T10:05:00Z;300,00;0.75;true;FR", "e;2026-11-02T10:30:00Z;25,00;0.05;false;FR"]));
  await expect(page.getByRole("combobox", { name: "Column for Country" })).toHaveValue("5");
  await page.getByRole("combobox", { name: "Currency of your amounts" }).selectOption("GBP");
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page.locator("header")).toContainText("queue.csv");
  await expect(page.locator("h1")).toContainText("£2,100 fraud");
  await expect(page.locator("header")).toContainText("0 network requests since opening");
  await expect(page.locator("#segments").getByRole("tab", { name: "Country" })).toBeVisible();
  await page.getByRole("button", { name: "Back to the public data" }).click();
  await expect(page.locator("header")).toContainText("56,962 payments");
});

test("a file with card numbers is refused", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your transactions file").setInputFiles(csv(["time,card,amount,score,fraud", "1,4111111111111111,10,0.1,0", "2,5500005555555559,20,0.9,1"]));
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page.getByRole("alert")).toContainText("full card numbers");
});

test("a file without the needed columns says which", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your transactions file").setInputFiles(csv(["id,value", "1,20"]));
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page.getByRole("alert")).toContainText("Time, Score, Fraud outcome");
});

test("settings travel in the link", async ({ page }) => {
  await page.goto("/#a=5&min=10&to=30&o=oldest&fm=2&rc=8&dc=20&cur=GBP");
  await expect(page.locator("h1")).toContainText("£");
  await expect(page.locator("#staffing")).toContainText("oldest");
  expect(await money(page, "#staffing [aria-label='analysts'] span")).toBe(5);
});

test("on a phone nothing scrolls sideways", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("fraud");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.close();
});
