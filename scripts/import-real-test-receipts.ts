import { readFile } from "node:fs/promises";

import { EventReceiptSchema } from "../src/domain.js";
import { createConfiguredStore } from "../src/factory.js";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: tsx scripts/import-real-test-receipts.ts <receipts.json>");
  process.exit(1);
}

if (process.env.APP_MODE !== "real_test") {
  console.error("APP_MODE=real_test is required for receipt import.");
  process.exit(1);
}

const raw = await readFile(filePath, "utf8");
const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;

const { store } = await createConfiguredStore();

let imported = 0;
for (const item of parsed) {
  const receipt = EventReceiptSchema.parse({
    ...item,
    dataProvenance: "real_event",
  });
  await store.recordReceipt(receipt);
  imported += 1;
}

await store.close();
console.log(`Imported ${imported} real_test receipts from ${filePath}.`);
