import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { chromium } from "playwright";
import { preview } from "vite";

const previewServer = await preview({
  preview: { host: "127.0.0.1", port: 0, strictPort: true },
});
const address = previewServer.httpServer.address();
assert(address && typeof address !== "string");
const baseUrl = `http://127.0.0.1:${address.port}/`;
let browser;

try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const errors = [];
  const failedResponses = [];
  const openPage = async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push({ text: message.text(), location: message.location() });
    });
    page.on("response", (response) => {
      if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
    });
    await page.clock.install();
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "Mua ngay" }).waitFor();
    assert.equal(await page.evaluate(() => window.__delayedReservationReview), undefined);
    return page;
  };
  const readInventory = async (page) =>
    (await page.locator(".inventory-cell strong").allTextContents()).map(Number);
  const readState = async (page) => ({
    message: await page.locator(".state-message").textContent(),
    buyDisabled: await page.getByRole("button", { name: "Mua ngay" }).isDisabled(),
    inventory: await readInventory(page),
  });

  const checkoutPage = await openPage();
  assert.deepEqual(await readInventory(checkoutPage), [5, 0, 0]);
  await checkoutPage.getByRole("button", { name: "Mua ngay" }).click();
  const checkoutButton = checkoutPage.getByRole("button", { name: "Thanh toán", exact: true });
  await checkoutButton.waitFor();
  assert.deepEqual(await readInventory(checkoutPage), [4, 1, 0]);
  assert.equal(await checkoutPage.getByRole("button", { name: "Mua ngay" }).isDisabled(), true);
  const heldCountdown = await checkoutPage.locator(".hold-countdown").textContent();
  assert(heldCountdown && heldCountdown !== "00:00");
  await checkoutButton.click();
  await checkoutPage.getByText("Đặt hàng thành công").waitFor();
  const checkout = await readState(checkoutPage);
  assert.deepEqual(checkout.inventory, [4, 0, 1]);
  await mkdir("evidence", { recursive: true });
  await checkoutPage.screenshot({ path: "evidence/production-preview-checkout.png", fullPage: true });

  const expiryPage = await openPage();
  await expiryPage.getByRole("button", { name: "Mua ngay" }).click();
  await expiryPage.getByRole("button", { name: "Thanh toán", exact: true }).waitFor();
  const pending = await readState(expiryPage);
  assert.deepEqual(pending.inventory, [4, 1, 0]);
  assert.equal(pending.buyDisabled, true);

  await expiryPage.clock.fastForward(16_000);
  await expiryPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expiryPage.getByText("Thời gian giữ hàng đã hết; sản phẩm được trả lại kho.").waitFor();
  const expired = await readState(expiryPage);
  assert.deepEqual(expired.inventory, [5, 0, 0]);
  assert.equal(expired.buyDisabled, false);
  await expiryPage.screenshot({ path: "evidence/production-preview-expiry.png", fullPage: true });

  await expiryPage.getByRole("button", { name: "Mua ngay" }).click();
  await expiryPage.getByRole("button", { name: "Thanh toán", exact: true }).waitFor();
  const retry = await readState(expiryPage);
  assert.deepEqual(retry.inventory, [4, 1, 0]);
  await expiryPage.getByRole("button", { name: "Thanh toán", exact: true }).click();
  await expiryPage.getByText("Đặt hàng thành công").waitFor();
  const retryCheckout = await readState(expiryPage);
  assert.deepEqual(retryCheckout.inventory, [4, 0, 1]);
  console.log(JSON.stringify({ errors, failedResponses }, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(failedResponses, []);

  const evidence = {
    checkedAt: new Date().toISOString(),
    environment: {
      browser: `Chrome ${browser.version()}`,
      node: process.version,
      platform: os.platform(),
      osRelease: os.release(),
      server: "Vite production preview serving dist; no service injection or test harness",
      clock: "Playwright browser clock; advanced 16000 ms then dispatched visibilitychange for expiry refresh",
    },
    initial: [5, 0, 0],
    checkout,
    pending,
    expired,
    retry,
    retryCheckout,
    instrumentationPresent: false,
    errors,
    failedResponses,
  };
  await writeFile("evidence/production-preview-browser.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close();
  await previewServer.close();
}
