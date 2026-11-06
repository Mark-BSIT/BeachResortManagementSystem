import { db } from "./connection.js";
console.log("\n=== BOOKING COLUMNS ===");
const columns = db
    .prepare("PRAGMA table_info(bookings)")
    .all();
console.log(columns.map((column) => column.name));
console.log("\n=== FOOD TABLES ===");
const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'food_%'")
    .all();
console.log(tables);
console.log("\n=== EXISTING ACCOMMODATIONS ===");
const accommodations = db
    .prepare("SELECT COUNT(*) AS total FROM accommodations")
    .get();
console.log(accommodations);
console.log("\n=== VERIFICATION COMPLETE ===");
db.close();
