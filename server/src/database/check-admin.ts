import { db } from "./connection.js";

console.log("\n========== USERS TABLE COLUMNS ==========\n");

const columns = db.prepare(`
  PRAGMA table_info(users)
`).all();

console.table(columns);

console.log("\n========== ADMIN ACCOUNTS ==========\n");

const admins = db.prepare(`
  SELECT *
  FROM users
  WHERE LOWER(role) = 'admin'
`).all();

if (admins.length === 0) {
  console.log("NO ADMIN ACCOUNT FOUND.");
} else {
  console.log("ADMIN ACCOUNT(S) FOUND:");
  console.table(admins);
}

console.log("\nTotal admin accounts:", admins.length);

console.log("\n====================================\n");

db.close();