import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({
  server: { host: "127.0.0.1", port: 5413, strictPort: true },
});
let browser;

try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  // Inject only at the test's network boundary; application sources stay unchanged.
  await page.route("**/src/domain/saleSession.ts*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `
      import { InMemoryInventoryService } from "/src/domain/inventoryService.ts";
      export const saleInventory = new InMemoryInventoryService();
      const reserve = saleInventory.reserve.bind(saleInventory);
      let delayNextResponse = true;
      window.__delayedReservationReview = { service: saleInventory };
      saleInventory.reserve = async (requestId) => {
        const shouldDelay = delayNextResponse;
        delayNextResponse = false;
        const result = await reserve(requestId);
        if (shouldDelay) {
          window.__delayedReservationReview.firstResult = result;
          await new Promise((resolve) => setTimeout(resolve, 16000));
        }
        return result;
      };
    `,
  }));

  await page.clock.install();
  await page.goto("http://127.0.0.1:5413/");
  await page.getByRole("button", { name: "Mua ngay" }).click();
  await page.waitForFunction(() => window.__delayedReservationReview.firstResult !== undefined);

  const readState = () => page.evaluate(() => ({
    message: document.querySelector(".state-message").textContent,
    buyDisabled: document.querySelector(".buy-button").disabled,
    inventory: window.__delayedReservationReview.service.getSnapshot(),
    visibleInventory: Array.from(document.querySelectorAll(".inventory-cell strong"), (node) => Number(node.textContent)),
  }));

  const pending = await readState();
  assert.equal(pending.buyDisabled, true);
  assert.deepEqual(pending.visibleInventory, [4, 1, 0]);

  await page.clock.fastForward(16_000);
  await page.getByText("Thời gian giữ hàng đã hết trước khi giao diện xác nhận.").waitFor();
  const expired = await readState();
  assert.equal(expired.buyDisabled, false);
  assert.deepEqual(expired.visibleInventory, [5, 0, 0]);
  assert.equal(expired.inventory.version, 2);

  await mkdir("evidence", { recursive: true });
  await page.screenshot({ path: "evidence/delayed-reservation-recovered.png", fullPage: true });

  await page.getByRole("button", { name: "Mua ngay" }).click();
  await page.getByRole("button", { name: "Thanh toán", exact: true }).waitFor();
  const retry = await readState();
  assert.deepEqual(retry.visibleInventory, [4, 1, 0]);
  assert.equal(retry.inventory.version, 3);

  const oldExpiry = await page.evaluate(() => {
    const { service, firstResult } = window.__delayedReservationReview;
    return service.expireReservation(firstResult.reservation.id);
  });
  assert.equal(oldExpiry.changed, false);
  assert.deepEqual(oldExpiry.snapshot, retry.inventory);

  await page.getByRole("button", { name: "Thanh toán", exact: true }).click();
  await page.getByText("Đặt hàng thành công").waitFor();
  const checkout = await readState();
  assert.deepEqual(checkout.visibleInventory, [4, 0, 1]);
  assert.equal(checkout.inventory.version, 4);
  assert.deepEqual(errors, []);

  const evidence = {
    checkedAt: new Date().toISOString(),
    environment: {
      browser: `Chrome ${browser.version()}`,
      node: process.version,
      platform: os.platform(),
      osRelease: os.release(),
      server: "Vite development server; StrictMode application entrypoint",
      clock: "Playwright browser clock, advanced 16000 ms after reservation commit",
    },
    reservationTtlMs: 15_000,
    responseDelayMs: 16_000,
    pending,
    expired,
    retry,
    oldExpiry: { changed: oldExpiry.changed, snapshot: oldExpiry.snapshot },
    checkout,
    errors,
  };
  await writeFile("evidence/delayed-reservation-browser.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
