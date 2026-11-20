import { expect, test } from "@playwright/test";

// Returning visitors have seen the first-visit pitch. It has its own tests below.
test.beforeEach(async ({ page }, info) => {
  if (!info.title.startsWith("first visit")) await page.addInitScript(() => localStorage.setItem("fraudlens-pitch-seen", "1"));
});

test("first visit: the idea, then the riskiest live case in one click", async ({ page }) => {
  await page.goto("/");
  const pitch = page.getByRole("dialog", { name: /case you can close/ });
  await expect(pitch).toBeVisible();
  await expect(pitch.getByRole("button", { name: "Work a live case →" })).toBeFocused();
  await pitch.getByRole("button", { name: "Work a live case →" }).click();
  await expect(pitch).toBeHidden();
  // The case opens on the desk, with its evidence.
  await expect(page.getByText(/Exhibit A/).first()).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("how it works follows one payment through the real scorer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "How it works" }).click();
  const how = page.getByRole("dialog", { name: "Follow one payment onto the desk" });
  const stage = (n: RegExp) => how.getByRole("list", { name: "Stages" }).getByRole("button", { name: n });
  await stage(/Score/).click();
  await expect(how.getByText("Chance of fraud")).toBeVisible();
  await stage(/Evidence/).click();
  await expect(how.getByText("Implied travel speed")).toBeVisible();
  await how.getByRole("radio", { name: "Weekly groceries" }).click();
  await stage(/Decision/).click();
  await expect(how.getByText(/Review at [\d.]+% or more/)).toBeVisible();
  await how.getByRole("button", { name: "Score your own on the Test bench →" }).click();
  await expect(page).toHaveURL(/\/try$/);
});

test("every view opens without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [path, heading] of [["/", "Case desk"], ["/rings", "Ring board"], ["/model", "Lab report"], ["/drift", "Drift watch"], ["/try", "Test bench"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("the lab report shows the benchmark on real card data", async ({ page }) => {
  await page.goto("/model");
  await expect(page.getByText("Second opinion: real card data")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("cell", { name: "Logistic regression" }).first()).toBeVisible();
});

test("case desk: stamp cases with the keyboard and the next file opens", async ({ page }) => {
  await page.goto("/");
  // First visit: a briefing explains the desk; it goes away for good once dismissed.
  await expect(page.getByRole("complementary", { name: "Briefing" })).toBeVisible();
  await page.getByRole("button", { name: "Start the shift" }).click();
  await expect(page.getByRole("complementary", { name: "Briefing" })).toHaveCount(0);
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 30_000 });
  const queue = page.getByRole("region", { name: "Queue" });
  await expect(queue.locator("li button").first()).toBeVisible({ timeout: 30_000 });
  const first = await page.getByRole("article").getAttribute("aria-label");
  await expect(page.getByText("Weight of evidence")).toBeVisible();
  await page.keyboard.press("f");
  // The stamp lands on the file, then the next one opens.
  await expect(page.getByRole("status").filter({ hasText: "Fraud" })).toBeVisible();
  await expect(page.getByRole("article")).not.toHaveAttribute("aria-label", first!);
  await expect(page.getByText("1 closed this shift")).toBeVisible();
  await page.keyboard.press("l");
  await expect(page.getByText("2 closed this shift")).toBeVisible();
  await expect(page.getByRole("list", { name: "Your verdicts, oldest first" }).locator("li")).toHaveCount(2);
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Briefing" })).toHaveCount(0);
});

test("case desk works on a phone: drawer, file, stamp", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  // A page of its own, so the returning-visitor setup above doesn't reach it.
  await page.addInitScript(() => localStorage.setItem("fraudlens-pitch-seen", "1"));
  await page.goto("/");
  await page.getByRole("button", { name: "Start the shift" }).click();
  const queue = page.getByRole("region", { name: "Queue" });
  await queue.locator("li button").first().tap({ timeout: 30_000 });
  await expect(page.getByRole("article")).toBeVisible();
  await page.getByRole("button", { name: /Stamp fraud/i }).tap();
  await expect(page.getByText("1 closed this shift")).toBeAttached();
  // Nothing on the page scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.close();
});

test("the command menu switches views and runs actions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Case desk" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Search payments by card or ID/).fill("drift");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/drift$/);
  await page.keyboard.press("5");
  await expect(page.getByRole("heading", { level: 1, name: "Test bench" })).toBeVisible();
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
  // Which features shift "as expected" depends on the hour the test runs: the clock features only
  // move when the live window's time of day differs from training. The demo's cards always have
  // less history than the training set, so that reason is present at any hour.
  await expect(page.getByText(/Expected shift: cards here have \d+ days of history; the model trained on 90/).first()).toBeVisible({ timeout: 30_000 });
});
