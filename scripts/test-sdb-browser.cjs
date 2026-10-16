const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1536, height: 1100 },
  });
  const base = "http://127.0.0.1:4175";
  const page = await ctx.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = await ctx.request.post(base + "/api/moei/auth/login", {
    data: { username: "tester", password: "seafarer-test-only-2026" },
  });
  assert.equal(login.status(), 200);
  const out = require("node:path").resolve("tmp/sdb-qa");
  fs.mkdirSync(out, { recursive: true });
  async function route(view) {
    await page.goto(base + "/#/moei/seafarers/" + view);
    await page.locator(".loading-state").waitFor({ state: "hidden" });
    await page
      .locator("h1")
      .filter({
        hasText:
          view === "readiness"
            ? "Pre Application Readiness"
            : view === "company"
              ? "Company No Objection"
              : view === "services"
                ? "Seafarer Services"
                : view === "fulfilment"
                  ? "Printing & Delivery"
                  : "Notifications & Updates",
      })
      .waitFor();
  }
  await route("readiness");
  await page.locator(".candidate-row").first().waitFor();
  assert.equal(await page.locator(".candidate-row").count(), 7);
  await page.screenshot({
    path: out + "/readiness-desktop.png",
    fullPage: false,
  });
  async function issue(profile, delivery) {
    await route("services");
    if (profile !== "SF-002") {
      await page.locator(".preview-bar select").selectOption(profile);
      await page.locator(".loading-state").waitFor({ state: "hidden" });
    }
    await page.locator(".service-card .primary").click();
    await page.locator('input[name="format"]').first().waitFor();
    await page
      .locator('input[name="format"][value="ELECTRONIC_PRINT"]')
      .check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .locator('input[name="delivery"][value="' + delivery + '"]')
      .check();
    await page.locator(".declaration input").check();
    await page
      .getByRole("button", { name: "Confirm & generate invoice", exact: false })
      .click();
    await page.locator(".invoice-total").waitFor();
    const invoiceText = await page.locator(".invoice-total").innerText();
    assert.ok(
      invoiceText.includes(
        profile === "SF-002"
          ? "175.00"
          : delivery === "PICKUP"
            ? "130.00"
            : "155.00",
      ),
    );
    await page
      .getByRole("button", { name: "Proceed to payment", exact: false })
      .click();
    if (profile === "SF-002") {
      await page.locator(".payment-sandbox select").selectOption("FAILED");
      await page.locator(".payment-step>.primary").click();
      await page.locator(".payment-failed").waitFor();
    }
    await page.locator(".payment-sandbox select").selectOption("SUCCESS");
    await page.locator(".payment-step>.primary").click();
    await page.locator(".digital-sdb").waitFor();
    assert.ok(
      (await page.locator(".digital-sdb").innerText()).includes("SPECIMEN"),
    );
  }
  await issue("SF-002", "POST");
  await page.screenshot({ path: out + "/esdb-desktop.png", fullPage: false });
  await route("company");
  await page.locator(".preview-bar select").selectOption("SF-004");
  await page.locator(".loading-state").waitFor({ state: "hidden" });
  await page.locator(".form-grid select").selectOption("NO_OBJECTION");
  await page.locator(".form-grid input").fill("COMPANY-UAT-NOC-004");
  await page
    .getByRole("button", {
      name: "Save decision & notify seafarer",
      exact: false,
    })
    .click();
  await page.locator(".alert.success").waitFor();
  await issue("SF-004", "POST");
  await issue("SF-003", "PICKUP");
  await route("fulfilment");
  await page
    .locator(".print-row")
    .filter({ hasText: "Mariam Al Shamsi" })
    .click();
  await page
    .getByRole("button", { name: "Printed · Confirm & notify", exact: false })
    .click();
  await page.locator('input[type="datetime-local"]').waitFor();
  await page
    .locator('input[type="datetime-local"]')
    .fill(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16));
  await page
    .getByRole("button", {
      name: "Ready for collection · Confirm & notify",
      exact: false,
    })
    .click();
  await page
    .getByRole("button", { name: "Collected · Confirm & notify", exact: false })
    .waitFor();
  await page.screenshot({
    path: out + "/fulfilment-desktop.png",
    fullPage: false,
  });
  await route("notifications");
  await page.locator(".notification-row").first().waitFor();
  assert.ok((await page.locator(".notification-row").count()) > 10);
  await page.screenshot({
    path: out + "/notifications-desktop.png",
    fullPage: false,
  });
  await route("readiness");
  await page.locator(".candidate-row").first().click();
  await page.locator("details.sandbox-tools summary").click();
  await page
    .getByRole("button", {
      name: "First qualifying CoP → new candidate",
      exact: false,
    })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".candidate-row").length === 8,
  );
  await ctx.request.get(base + "/api/seafarers/v1/dashboard");
  await page.setViewportSize({ width: 390, height: 844 });
  await route("services");
  await page.getByRole("button", { name: "Switch to Arabic" }).click();
  await page.screenshot({
    path: out + "/portal-mobile-arabic.png",
    fullPage: false,
  });
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(overflow.scroll <= overflow.width + 2, JSON.stringify(overflow));
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    JSON.stringify({
      passed: true,
      screenshots: 5,
      journeys: 3,
      companyClearance: true,
      pickup: true,
      failedPaymentRetry: true,
      newCandidate: true,
      mobileRtl: true,
      consoleErrors: errors,
      overflow,
    }),
  );
})().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
