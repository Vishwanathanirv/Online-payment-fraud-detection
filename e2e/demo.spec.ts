import { expect, test } from "@playwright/test";

const stopped = async (page: import("@playwright/test").Page) => Number((await page.locator("h1 .text-stopped").innerText()).replace(/[^\d]/g, ""));

test("the page loads the real test window and answers the staffing question", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText(/56,962 real card payments/)).toBeVisible();
  await expect(page.locator("h1")).toContainText("lost to fraud");
  await expect(page.locator("h1")).toContainText("€7,729");
  expect(errors).toEqual([]);
});

test("more analysts stop more fraud, and none stop none", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("€");
  await page.waitForTimeout(600);
  const base = await stopped(page);
  await page.getByRole("button", { name: "More: analysts" }).click();
  await page.waitForTimeout(700);
  expect(await stopped(page)).toBeGreaterThanOrEqual(base);
  const fewer = page.getByRole("button", { name: "Less: analysts" });
  while (await fewer.isEnabled()) await fewer.click();
  await page.waitForTimeout(700);
  expect(await stopped(page)).toBe(0);
  await expect(page.getByText("75 payments nobody looked at")).toBeVisible();
});

test("the queue lists the reviews worst first and explains a tree-ranked payment", async ({ page }) => {
  await page.goto("/");
  const queue = page.locator("#queue");
  await queue.scrollIntoViewIfNeeded();
  await queue.locator("tbody tr").first().click();
  await expect(queue.getByText(/Why the trees ranked it here/)).toBeVisible();
  await expect(queue.getByText(/Component V\d+/).first()).toBeVisible();
  await queue.getByRole("tab", { name: /that were genuine/ }).click();
  await expect(queue.locator("tbody tr").first()).toContainText("Genuine");
});

test("switching the ranking model changes the outcome", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(600);
  const trees = await stopped(page);
  await page.getByRole("combobox", { name: "Model that ranks the payments" }).selectOption("iforest");
  await page.waitForTimeout(700);
  expect(await stopped(page)).not.toBe(trees);
});

test("on a phone nothing scrolls sideways", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("lost to fraud");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.close();
});

test("every amount converts to the chosen currency, with the rate's source and date", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("€7,729");
  await page.getByRole("combobox", { name: "Show amounts in" }).selectOption("INR");
  await expect(page.locator("h1")).toContainText("₹");
  await expect(page.getByText(/shown in INR at the ECB reference rate of \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(page.locator("h1")).not.toContainText("€");
});

test("your own CSV is read in the browser and answers the same question", async ({ page }) => {
  await page.goto("/");
  const csv = ["time,amount,risk_score,is_fraud", "2026-11-02T09:00:00Z,40,0.01,0", "2026-11-02T09:10:00Z,1800,0.92,1", "2026-11-02T09:20:00Z,12,0.02,0", "2026-11-02T10:05:00Z,300,0.75,1", "2026-11-02T10:30:00Z,25,0.05,0"].join("\n");
  await page.getByRole("combobox", { name: "Currency of your amounts" }).selectOption("GBP");
  await page.getByLabel("Your transactions file").setInputFiles({ name: "my-queue.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText(/5 of your transactions/)).toBeVisible();
  await expect(page.locator("h1")).toContainText("£2,100");
  await expect(page.getByRole("combobox", { name: "Model that ranks the payments" })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to the public data" }).click();
  await expect(page.getByText(/56,962 real card payments/)).toBeVisible();
});

test("a file without the needed columns is refused with a reason", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your transactions file").setInputFiles({ name: "wrong.csv", mimeType: "text/csv", buffer: Buffer.from("id,value\n1,20\n") });
  await expect(page.getByRole("alert")).toContainText("Missing columns: time, score, fraud");
});
