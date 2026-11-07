import { db } from "./connection.js";
function columnExists(table, column) {
    const columns = db
        .prepare(`PRAGMA table_info(${table})`)
        .all();
    return columns.some((item) => item.name === column);
}
function addColumn(table, column, definition) {
    if (!columnExists(table, column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`Added column: ${table}.${column}`);
    }
}
const migrate = db.transaction(() => {
    // 1. Preserve the price breakdown for each reservation.
    addColumn("bookings", "accommodation_total", "REAL NOT NULL DEFAULT 0");
    addColumn("bookings", "adult_entrance_total", "REAL NOT NULL DEFAULT 0");
    addColumn("bookings", "child_entrance_total", "REAL NOT NULL DEFAULT 0");
    addColumn("bookings", "services_total", "REAL NOT NULL DEFAULT 0");
    // 2. Food menu managed by the admin.
    db.exec(`
    CREATE TABLE IF NOT EXISTS food_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL CHECK(
        category IN ('MEALS','DRINKS','SNACKS')
      ),
      price REAL NOT NULL CHECK(price >= 0),
      image_url TEXT,
      is_available INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_food_items_category
    ON food_items(category, is_available);
  `);
    // 3. Food orders attached to an existing reservation.
    db.exec(`
    CREATE TABLE IF NOT EXISTS food_orders (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      booking_id TEXT NOT NULL REFERENCES bookings(id),
      customer_id TEXT NOT NULL REFERENCES users(id),
      fulfillment_method TEXT NOT NULL CHECK(
        fulfillment_method IN (
          'DINE_IN',
          'COTTAGE_DELIVERY',
          'ROOM_DELIVERY'
        )
      ),
      location_note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(
        status IN (
          'PENDING',
          'PREPARING',
          'READY',
          'OUT_FOR_DELIVERY',
          'DELIVERED',
          'CANCELLED'
        )
      ),
      total REAL NOT NULL DEFAULT 0 CHECK(total >= 0),
      special_instructions TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_food_orders_booking
    ON food_orders(booking_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_food_orders_customer
    ON food_orders(customer_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_food_orders_status
    ON food_orders(status);
  `);
    // 4. Individual items belonging to each food order.
    db.exec(`
    CREATE TABLE IF NOT EXISTS food_order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
      food_item_id TEXT REFERENCES food_items(id),
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price REAL NOT NULL CHECK(unit_price >= 0),
      line_total REAL NOT NULL CHECK(line_total >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_food_order_items_order
    ON food_order_items(order_id);
  `);
    // 5. PayMongo checkout and automatic payment verification.
    addColumn("payments", "gateway", "TEXT");
    addColumn("payments", "checkout_session_id", "TEXT");
    addColumn("payments", "checkout_url", "TEXT");
    addColumn("payments", "gateway_payment_id", "TEXT");
    addColumn("payments", "paid_at", "TEXT");
    db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_checkout_session
    ON payments(checkout_session_id)
    WHERE checkout_session_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_gateway_payment
    ON payments(gateway_payment_id)
    WHERE gateway_payment_id IS NOT NULL;
  `);
    console.log("Database migration completed.");
});
try {
    migrate.immediate();
}
finally {
    db.close();
}
