import { InMemoryInventoryService } from "./inventoryService";

// Keep one ledger for the browser session, including React StrictMode effect replay.
export const saleInventory = new InMemoryInventoryService();
