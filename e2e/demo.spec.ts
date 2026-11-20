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
  await page.getByRole("button", { name: "More analysts" }).click();
  await page.waitForTimeout(700);
  expect(await stopped(page)).toBeGreaterThanOrEqual(base);
  const fewer = page.getByRole("button", { name: "Fewer analysts" });
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
