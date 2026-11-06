export const schemaSql = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('ADMIN','CUSTOMER')), full_name TEXT NOT NULL,
 phone TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customer_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, address TEXT, emergency_contact TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS accommodations (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 capacity_adults INTEGER NOT NULL CHECK(capacity_adults > 0), capacity_children INTEGER NOT NULL DEFAULT 0,
 day_price REAL NOT NULL DEFAULT 0 CHECK(day_price >= 0), night_price REAL NOT NULL DEFAULT 0 CHECK(night_price >= 0),
 extra_adult_fee REAL NOT NULL DEFAULT 0, extra_child_fee REAL NOT NULL DEFAULT 0,
 image_url TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS accommodation_images (
 id TEXT PRIMARY KEY, accommodation_id TEXT NOT NULL REFERENCES accommodations(id) ON DELETE CASCADE, image_url TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS amenities (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS services (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price REAL NOT NULL CHECK(price >= 0),
 is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS bookings (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL REFERENCES users(id),
 accommodation_id TEXT NOT NULL REFERENCES accommodations(id), kind TEXT NOT NULL CHECK(kind IN ('DAY_USE','OVERNIGHT')),
 start_at TEXT NOT NULL, end_at TEXT NOT NULL, adults INTEGER NOT NULL CHECK(adults > 0), children INTEGER NOT NULL DEFAULT 0 CHECK(children >= 0),
 special_request TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('PENDING','CONFIRMED','REJECTED','CANCELLED','CHECKED_IN','COMPLETED','EXPIRED')),
 total REAL NOT NULL CHECK(total >= 0), hold_expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(start_at < end_at)
);
CREATE INDEX IF NOT EXISTS idx_bookings_accommodation_dates ON bookings(accommodation_id,start_at,end_at,status);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id,created_at);
CREATE TABLE IF NOT EXISTS booking_services (
 booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 service_id TEXT NOT NULL REFERENCES services(id), quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price REAL NOT NULL,
 PRIMARY KEY(booking_id,service_id)
);
CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), customer_id TEXT NOT NULL REFERENCES users(id),
 method TEXT NOT NULL CHECK(method IN ('GCASH','BANK_TRANSFER','CASH_ON_ARRIVAL')),
 amount REAL NOT NULL CHECK(amount > 0), reference_number TEXT, proof_path TEXT,
 status TEXT NOT NULL CHECK(status IN ('SUBMITTED','VERIFIED','REJECTED')), reviewed_by TEXT REFERENCES users(id),
 reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payment_proofs (
 id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE, storage_key TEXT NOT NULL, mime_type TEXT NOT NULL, file_size INTEGER NOT NULL, uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, message TEXT NOT NULL,
 type TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at);
CREATE TABLE IF NOT EXISTS activity_logs (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, entity_type TEXT NOT NULL,
 entity_id TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS event_outbox (
 id TEXT PRIMARY KEY, event_name TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 processed_at TEXT, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON event_outbox(processed_at,created_at);
CREATE TABLE IF NOT EXISTS check_in_out (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id), checked_in_by TEXT REFERENCES users(id),
 checked_in_at TEXT, checked_out_by TEXT REFERENCES users(id), checked_out_at TEXT, extra_charge REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reviews (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id), customer_id TEXT NOT NULL REFERENCES users(id),
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS promotions (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE, discount_amount REAL NOT NULL DEFAULT 0,
 discount_percent REAL NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS expenses (
 id TEXT PRIMARY KEY, description TEXT NOT NULL, amount REAL NOT NULL CHECK(amount >= 0), expense_date TEXT NOT NULL
);
`;
