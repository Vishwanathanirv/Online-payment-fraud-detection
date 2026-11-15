import { expect, test } from "@playwright/test";

test("every view opens without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [path, heading] of [["/", "Triage"], ["/rings", "Fraud rings"], ["/model", "Model performance"], ["/drift", "Data drift"], ["/try", "Try a payment"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("triage: judge payments with the keyboard and the queue moves on", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 30_000 });
  const queue = page.getByRole("region", { name: "Queue" });
  await expect(queue.locator("li button").first()).toBeVisible({ timeout: 30_000 });
  const first = await page.getByRole("article").getAttribute("aria-label");
  await expect(page.getByText("Model explanation")).toBeVisible();
  await page.keyboard.press("f");
  await expect(page.getByRole("article")).not.toHaveAttribute("aria-label", first!);
  await expect(page.getByText("1 decided this session")).toBeVisible();
  await page.keyboard.press("l");
  await expect(page.getByText("2 decided this session")).toBeVisible();
  await page.keyboard.press("j");
  await page.keyboard.press("k");
});

test("the command menu switches views and runs actions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Triage" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Search payments by card or ID/).fill("drift");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/drift$/);
  await page.keyboard.press("5");
  await expect(page.getByRole("heading", { level: 1, name: "Try a payment" })).toBeVisible();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});

// The examples must behave the same whatever time it is when someone opens the page.
for (const at of ["2026-11-15T03:00:00", "2026-11-15T14:30:00", "2026-11-15T21:35:00"]) {
  test(`the example payments get the decisions a fraud desk would expect (at ${at.slice(11, 16)})`, async ({ page }) => {
    await page.clock.install({ time: new Date(at) });
    await page.goto("/try");
    const result = page.locator("section").nth(1);
    await page.getByRole("button", { name: "Weekly groceries" }).click();
    await expect(result.getByLabel("approve")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Late-night crypto" }).click();
    await expect(result.getByLabel("block")).toBeVisible();
    await page.getByRole("button", { name: "Skimmed card abroad" }).click();
    await expect(result.getByText(/Implied travel at [\d,]+ km\/h/)).toBeVisible();
    await expect(result.getByLabel(/review|block/)).toBeVisible();
  });
}

test("drift explains expected shifts instead of raising false alarms", async ({ page }) => {
  await page.goto("/drift");
  await expect(page.getByText(/Expected shift: follows the clock/).first()).toBeVisible({ timeout: 30_000 });
});
