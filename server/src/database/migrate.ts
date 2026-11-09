
import { db } from "./connection.js";

function columnExists(table: string, column: string): boolean {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;

  return columns.some((item) => item.name === column);
}

function addColumn(table: string, column: string, definition: string) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Added column: ${table}.${column}`);
  }
}

const migrate = db.transaction(() => {
  // 1. Preserve the price breakdown for each reservation.
  addColumn(
    "bookings",
    "accommodation_total",
    "REAL NOT NULL DEFAULT 0",
  );

  addColumn(
    "bookings",
    "adult_entrance_total",
    "REAL NOT NULL DEFAULT 0",
  );

  addColumn(
    "bookings",
    "child_entrance_total",
    "REAL NOT NULL DEFAULT 0",
  );

  addColumn(
    "bookings",
    "services_total",
    "REAL NOT NULL DEFAULT 0",
  );

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
  addColumn(
    "payments",
    "gateway",
    "TEXT",
  );

  addColumn(
    "payments",
    "checkout_session_id",
    "TEXT",
  );

  addColumn(
    "payments",
    "checkout_url",
    "TEXT",
  );

  addColumn(
    "payments",
    "gateway_payment_id",
    "TEXT",
  );

  addColumn(
    "payments",
    "paid_at",
    "TEXT",
  );

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_checkout_session
    ON payments(checkout_session_id)
    WHERE checkout_session_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_gateway_payment
    ON payments(gateway_payment_id)
    WHERE gateway_payment_id IS NOT NULL;
  `);
  
  // 6. Function Hall inventory managed by the admin.
  db.exec(`
    CREATE TABLE IF NOT EXISTS function_halls (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      capacity INTEGER NOT NULL CHECK(capacity > 0),
      hourly_rate REAL NOT NULL CHECK(hourly_rate >= 0),
      whole_day_rate REAL NOT NULL CHECK(whole_day_rate >= 0),
      whole_day_hours INTEGER NOT NULL DEFAULT 8
        CHECK(whole_day_hours = 8),
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_function_halls_active
    ON function_halls(is_active);
  `);

  // 7. Customer Function Hall reservations.
  db.exec(`
    CREATE TABLE IF NOT EXISTS function_hall_bookings (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL REFERENCES users(id),
      function_hall_id TEXT NOT NULL REFERENCES function_halls(id),

      event_type TEXT NOT NULL,
      guest_count INTEGER NOT NULL CHECK(guest_count > 0),

      rental_type TEXT NOT NULL CHECK(
        rental_type IN ('HOURLY', 'WHOLE_DAY')
      ),

      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,

      hourly_rate REAL NOT NULL DEFAULT 0,
      whole_day_rate REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL CHECK(total >= 0),

      special_request TEXT NOT NULL DEFAULT '',

      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(
        status IN (
          'PENDING',
          'CONFIRMED',
          'REJECTED',
          'CANCELLED',
          'COMPLETED'
        )
      ),

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CHECK(start_at < end_at),
      CHECK(
        rental_type != 'WHOLE_DAY'
        OR end_at = datetime(start_at, '+8 hours')
      )
    );

    CREATE INDEX IF NOT EXISTS idx_function_hall_booking_dates
    ON function_hall_bookings(
      function_hall_id,
      start_at,
      end_at,
      status
    );

    CREATE INDEX IF NOT EXISTS idx_function_hall_booking_customer
    ON function_hall_bookings(customer_id, created_at);
  `);

  // 8. Function Hall payments.
  // Kept separate to preserve the existing payments table
  // and its NOT NULL accommodation booking relationship.
  db.exec(`
    CREATE TABLE IF NOT EXISTS function_hall_payments (
      id TEXT PRIMARY KEY,
      function_hall_booking_id TEXT NOT NULL
        REFERENCES function_hall_bookings(id),

      customer_id TEXT NOT NULL REFERENCES users(id),

      method TEXT NOT NULL CHECK(
        method IN ('GCASH', 'BANK_TRANSFER', 'CASH_ON_ARRIVAL')
      ),

      amount REAL NOT NULL CHECK(amount > 0),
      reference_number TEXT,
      proof_path TEXT,

      status TEXT NOT NULL CHECK(
        status IN ('SUBMITTED', 'VERIFIED', 'REJECTED')
      ),

      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_function_hall_payments_booking
    ON function_hall_payments(function_hall_booking_id);

    CREATE INDEX IF NOT EXISTS idx_function_hall_payments_customer
    ON function_hall_payments(customer_id, created_at);
  `);

  console.log("Database migration completed.");
});

try {
  migrate.immediate();
} finally {
  db.close();
}
