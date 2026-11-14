import { expect, test } from "@playwright/test";

test("every page opens without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [path, heading] of [["/", "The live tape"], ["/cases", "Case queue"], ["/rings", "Fraud rings"], ["/model", "Model performance"], ["/drift", "Data drift"], ["/try", "Try a payment"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("the live tape prints payments and explains one", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Printing live")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.locator("tbody tr").first().click();
  await expect(page.getByText("Model explanation")).toBeVisible();
});

test("the example payments get the decisions a fraud desk would expect", async ({ page }) => {
  await page.goto("/try");
  await page.getByRole("button", { name: "Weekly groceries" }).click();
  const result = page.locator("section").nth(1);
  await expect(result.getByLabel("approve")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Late-night crypto" }).click();
  await expect(result.getByLabel("block")).toBeVisible();
  await page.getByRole("button", { name: "Skimmed card abroad" }).click();
  await expect(result.getByText(/Implied travel at \d+ km\/h/)).toBeVisible();
  await expect(result.getByLabel(/review|block/)).toBeVisible();
});

test("drift explains expected shifts instead of raising false alarms", async ({ page }) => {
  await page.goto("/drift");
  await expect(page.getByText(/Expected shift: follows the clock/).first()).toBeVisible({ timeout: 30_000 });
});
