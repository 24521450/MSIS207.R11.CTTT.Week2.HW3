import type { SaleConfig } from "./contracts";

export const SALE_CONFIG = {
  productName: "Tai nghe không dây MegaSound One",
  priceVnd: 1_290_000,
  initialStock: 5,
  unitsPerPurchase: 1,
  saleDurationMs: 120_000,
  reservationDurationMs: 15_000,
} as const satisfies SaleConfig;
