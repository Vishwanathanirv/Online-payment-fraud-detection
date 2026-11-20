import { expect, test, type Page } from "@playwright/test";

const money = async (page: Page, sel: string) => Number((await page.locator(sel).first().innerText()).replace(/[^\d]/g, ""));
const csv = (rows: string[]) => ({ name: "queue.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });

/* ───────────── the desk */

test("the first screen says the idea, with real benchmark numbers, and every object opens", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Where you draw the line is money.");
  await expect(page.getByText("0.766", { exact: true })).toBeVisible();
  await expect(page.getByText("56,962", { exact: true })).toBeVisible();
  await expect(page.getByText(/At the dial's line now: €[\d,]+ caught/)).toBeVisible();
  for (const [name, h1] of [
    ["Money dial", "Every notch"],
    ["Ledger", "fraud"],
  ] as const) {
    await page.goto("/");
    await page.getByRole("link", { name: new RegExp(`^${name}`) }).click();
    await expect(page.locator("h1")).toContainText(h1);
  }
  expect(errors).toEqual([]);
});

test("the palette and single-key shortcuts reach every scene", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/At the dial's line now/)).toBeVisible();
  await page.keyboard.press("d");
  await expect(page).toHaveURL(/\/dial#/);
  await page.keyboard.press("/");
  const search = page.getByRole("combobox", { name: "Search the desk" });
  await expect(search).toBeFocused();
  await search.fill("ledger");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/ledger#/);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search the desk" }).fill("INR");
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toContainText("₹");
  await page.keyboard.press("g");
  await expect(page).toHaveURL(/localhost:\d+\/#/);
});

/* ───────────── the money dial */

test("turning the money dial trades fraud caught against customers blocked", async ({ page }) => {
  await page.goto("/dial");
  const dial = page.getByRole("slider", { name: /Money dial/ });
  await expect(dial).toHaveAttribute("aria-valuenow", /\d+/);
  const at = async () => Number(await dial.getAttribute("aria-valuenow"));
  const caught = async () => Number((await page.locator("p.eyebrow", { hasText: /^Fraud caught$/ }).locator("xpath=following-sibling::p[1]").innerText()).replace(/[^\d]/g, ""));
  const start = await at();
  await dial.focus();
  await page.keyboard.press("Home");
  expect(await at()).toBe(0);
  await expect.poll(caught).toBe(0);
  await page.keyboard.press("End");
  expect(await at()).toBe(56962);
  await expect.poll(caught).toBe(7729);
  await page.keyboard.press("c");
  expect(await at()).toBe(start);
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowRight");
  expect(await at()).toBeGreaterThan(start);
  await expect(page).toHaveURL(/line=/);
  // The line travels in the link.
  const url = page.url();
  const other = await page.context().newPage();
  await other.goto(url);
  await expect(other.getByRole("slider", { name: /Money dial/ })).toHaveAttribute("aria-valuenow", String(await at()));
});

test("the dial follows a drag", async ({ page }) => {
  await page.goto("/dial");
  const dial = page.getByRole("slider", { name: /Money dial/ });
  await expect(dial).toHaveAttribute("aria-valuenow", /\d+/);
  await dial.scrollIntoViewIfNeeded();
  const box = (await dial.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - box.width * 0.3, cy + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(cx, cy - box.height * 0.4, { steps: 6 });
  await page.mouse.move(cx + box.width * 0.3, cy + box.height * 0.3, { steps: 6 });
  await page.mouse.up();
  expect(Number(await dial.getAttribute("aria-valuenow"))).toBeGreaterThan(20000);
});

/* ───────────── the case file */

test("a case file says why, and what would have cleared it, on the same trees", async ({ page }) => {
  await page.goto("/case/fraud");
  await expect(page).toHaveURL(/\/case\/\d+#/);
  await expect(page.locator("h1")).toContainText(/Caught|Missed/);
  await expect(page.getByText(/Component V\d+/).first()).toBeVisible();
  const whatIf = page.getByText(/would have taken it from|No believable change clears it|already goes through/);
  await expect(whatIf).toBeVisible();
  if (await page.getByText(/would have taken it from/).count()) {
    await expect(page.getByText("Cleared", { exact: true })).toBeVisible();
    // Drag the first change all the way back past where it started: declined again.
    const hand = page.getByRole("slider", { name: /Try a value for/ }).first();
    await hand.focus();
    for (let i = 0; i < 2; i++) await page.keyboard.press("Home");
    await page.keyboard.press("End");
    await page.keyboard.press("Home");
    await expect(page.getByText(/your version: [\d.]+% [<≥]/)).toBeVisible();
  }
  const first = page.url();
  await page.locator("h1").click();
  await page.keyboard.press("]");
  await expect(page).not.toHaveURL(first);
  await page.keyboard.press("a");
  await expect(page.locator("h1")).toContainText(/False alarm|Cleared/);
});

test("a counterfactual never changes the amount or time when told to keep them", async ({ page }) => {
  await page.goto("/case/fraud");
  await page.getByLabel("Keep the amount and time as they were").check();
  await expect(page.getByRole("slider", { name: /Try a value for (Amount|Time of day)/ })).toHaveCount(0);
});

test("a case file shares as a link that reopens it, and as an image", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/case/fraud");
  await expect(page).toHaveURL(/\/case\/\d+#/);
  const number = (await page.locator("article").getAttribute("aria-label"))!;
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Link copied ✓" })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/case\/\d+#.*line=/);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save as image" }).click();
  expect((await download).suggestedFilename()).toBe(`fraudlens-${number.replace("Case ", "").toLowerCase()}.png`);
  const size = await page.getByRole("img", { name: /as an image/ }).evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size).toEqual([2400, 1260]);
  const other = await context.newPage();
  await other.goto(link);
  await expect(other.locator("article")).toHaveAttribute("aria-label", number);
});

/* ───────────── the ring board */

test("the ring board unmasks rings from separate alerts, and leaves households alone", async ({ page }) => {
  await page.goto("/rings");
  await expect(page.locator("h1")).toContainText("33 alerts.");
  await expect(page.getByText(/^Phone D/)).toHaveCount(0);
  await page.getByRole("button", { name: /Unmask the rings/ }).click();
  await expect(page.getByText(/^Phone D/)).toHaveCount(3);
  await expect(page.locator("h1")).toContainText("24 of them are 3 rings.", { timeout: 8000 });
  await expect(page.getByText("RING · 1 CASE")).toHaveCount(3);
  await expect(page.getByText("Household · left alone")).toHaveCount(2);
  await page.getByRole("button", { name: "1. Alerts" }).click();
  await expect(page.locator("h1")).toContainText("33 alerts.");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "2. Shared devices" })).toHaveAttribute("aria-current", "step");
});

test("the desk's ring board object opens it already playing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /^Ring board/ }).click();
  await expect(page).toHaveURL(/\/rings\/unmask/);
  await expect(page.getByText("RING · 1 CASE")).toHaveCount(3, { timeout: 8000 });
});

/* ───────────── how it works */

test("how it works follows one real payment through all five steps", async ({ page }) => {
  await page.goto("/how");
  await expect(page.getByText("€1,504.93")).toBeVisible();
  await expect(page.getByText(/\d+ of 30/)).toBeVisible();
  await page.getByRole("button", { name: /Next: The score/ }).click();
  await expect(page.getByText("Trees counted · 141 of 141")).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("96.0%").first()).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "The reasons" })).toBeVisible();
  await expect(page.getByText(/Component V\d+/).first()).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("the public data has no card or device ids")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Declined", { exact: true })).toBeVisible();
  await expect(page.getByText(/it would have been let through if/)).toBeVisible();
  await page.getByRole("button", { name: "Open its case file →" }).click();
  await expect(page).toHaveURL(/\/case\/21322#/);
});

/* ───────────── the ledger */

test("loads the real test window with the cheapest policy", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/ledger");
  await expect(page.locator("h1")).toContainText("of €7,729 fraud");
  await expect(page.locator("#overview")).toContainText("56,962 payments");
  await expect(page).toHaveURL(/#a=2&min=6/);
  expect(errors).toEqual([]);
});

test("moving the review line changes the bands and the cost", async ({ page }) => {
  await page.goto("/ledger");
  const t = page.locator("#thresholds");
  await t.scrollIntoViewIfNeeded();
  const reviewRow = t.locator("tbody tr").nth(1);
  const before = (await reviewRow.textContent()) ?? "";
  await t.getByRole("button", { name: "Lower: review line" }).click();
  await t.getByRole("button", { name: "Lower: review line" }).click();
  await expect(reviewRow).not.toHaveText(before);
  await t.getByRole("button", { name: "Cheapest", exact: true }).click();
  await expect(reviewRow).toHaveText(before);
});

test("a smaller team times out reviews and lets fraud through", async ({ page }) => {
  await page.goto("/ledger");
  const s = page.locator("#staffing");
  await s.scrollIntoViewIfNeeded();
  const less = s.getByRole("button", { name: "Less: analysts" });
  while (await less.isEnabled()) await less.click();
  await expect(s.getByText("Reviewed in time").locator("..")).toContainText("0");
  await expect(page.locator("#overview")).toContainText("timed out");
});

test("segments break fraud down, and cases list what the policy touched", async ({ page }) => {
  await page.goto("/ledger");
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
  await page.goto("/ledger");
  await page.getByRole("combobox", { name: "Currency" }).selectOption("INR");
  await expect(page.locator("h1")).toContainText("₹");
  await expect(page.locator("h1")).not.toContainText("€");
  await expect(page.getByText(/Converted from EUR at the ECB rate of \d{4}-\d{2}-\d{2}/)).toBeVisible();
});

test("your own file: mapped, analysed in the browser, with no network requests", async ({ page }) => {
  await page.goto("/ledger");
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
  await expect(page.locator("#overview")).toContainText("56,962 payments");
});

test("a file with card numbers is refused", async ({ page }) => {
  await page.goto("/ledger");
  await page.getByLabel("Your transactions file").setInputFiles(csv(["time,card,amount,score,fraud", "1,4111111111111111,10,0.1,0", "2,5500005555555559,20,0.9,1"]));
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page.getByRole("alert")).toContainText("full card numbers");
});

test("a file without the needed columns says which", async ({ page }) => {
  await page.goto("/ledger");
  await page.getByLabel("Your transactions file").setInputFiles(csv(["id,value", "1,20"]));
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page.getByRole("alert")).toContainText("Time, Score, Fraud outcome");
});

test("settings travel in the link", async ({ page }) => {
  await page.goto("/ledger#a=5&min=10&to=30&o=oldest&fm=2&rc=8&dc=20&cur=GBP");
  await expect(page.locator("h1")).toContainText("£");
  await expect(page.locator("#staffing")).toContainText("oldest");
  expect(await money(page, "#staffing [aria-label='analysts'] span")).toBe(5);
});

test("on a phone nothing scrolls sideways, in any scene", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const path of ["/", "/dial", "/case/fraud", "/rings/unmask", "/how", "/ledger"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
  await page.close();
});
