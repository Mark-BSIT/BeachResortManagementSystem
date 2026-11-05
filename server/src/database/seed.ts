import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { db } from "./connection.js";
import { env } from "../config/env.js";

// ==========================================
// ADMIN ACCOUNT
// ==========================================

const admin = db
  .prepare("SELECT id FROM users WHERE email = ?")
  .get(env.ADMIN_EMAIL);

if (!admin) {
  db.prepare(
    `INSERT INTO users
    (id, email, password_hash, role, full_name)
    VALUES (?, ?, ?, 'ADMIN', 'Resort Administrator')`
  ).run(
    randomUUID(),
    env.ADMIN_EMAIL,
    bcrypt.hashSync(env.ADMIN_PASSWORD, 12)
  );
}

// ==========================================
// ACCOMMODATION INVENTORY
// ==========================================

const items = [
  // COTTAGES
  [
    "Coastal Family Cottage",
    "Cottages",
    "Spacious private cottage near the swimming pool, perfect for families.",
    8, 6, 1800, 0, 150, 80,
    "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=1000",
  ],
  [
    "Seaside Open Cottage",
    "Cottages",
    "Open-air cottage with a relaxing view of the beach.",
    6, 4, 1500, 0, 150, 80,
    "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?w=1000",
  ],
  [
    "Premium Family Cottage",
    "Cottages",
    "Premium shaded cottage with comfortable seating for larger families.",
    12, 8, 2500, 0, 150, 80,
    "https://images.unsplash.com/photo-1510798831971-661eb04b3739?w=1000",
  ],
  [
    "Private Poolside Cottage",
    "Cottages",
    "Private cottage located beside the swimming pool.",
    10, 5, 2200, 0, 150, 80,
    "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1000",
  ],

  // ROOMS
  [
    "Deluxe Ocean Room",
    "Rooms",
    "Air-conditioned room with a relaxing tropical resort atmosphere.",
    4, 2, 0, 3200, 200, 100,
    "https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1000",
  ],
  [
    "Standard Garden Room",
    "Rooms",
    "Comfortable air-conditioned room overlooking the garden.",
    2, 1, 0, 2200, 200, 100,
    "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1000",
  ],
  [
    "Family Deluxe Room",
    "Rooms",
    "Spacious family room with comfortable beds and private bathroom.",
    6, 3, 0, 4200, 200, 100,
    "https://images.unsplash.com/photo-1566665797739-1674de7a421a?w=1000",
  ],
  [
    "Premium Couple Room",
    "Rooms",
    "Cozy room designed for couples enjoying an overnight getaway.",
    2, 0, 0, 2800, 200, 100,
    "https://images.unsplash.com/photo-1590490360182-c33d57733427?w=1000",
  ],

  // DAY-USE PACKAGES
  [
    "Day Escape Package",
    "Day-use Packages",
    "Enjoy swimming pool access and a shaded lounge for the day.",
    6, 4, 950, 0, 100, 50,
    "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1000",
  ],
  [
    "Family Fun Day Package",
    "Day-use Packages",
    "A family day package with pool access and cottage use.",
    8, 6, 1800, 0, 100, 50,
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1000",
  ],
  [
    "Couple Day Escape",
    "Day-use Packages",
    "A relaxing daytime resort experience for two guests.",
    2, 0, 700, 0, 100, 50,
    "https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?w=1000",
  ],
  [
    "Group Barkada Package",
    "Day-use Packages",
    "A fun day at the resort with friends and group pool access.",
    10, 5, 2500, 0, 100, 50,
    "https://images.unsplash.com/photo-1530789253388-582c481c54b0?w=1000",
  ],

  // OVERNIGHT PACKAGES
  [
    "Overnight Couple Package",
    "Overnight Packages",
    "Relaxing overnight stay for two with comfortable accommodation.",
    2, 0, 0, 2800, 0, 0,
    "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1000",
  ],
  [
    "Family Overnight Package",
    "Overnight Packages",
    "An overnight family getaway with spacious accommodation.",
    6, 4, 0, 4800, 200, 100,
    "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1000",
  ],
  [
    "Premium Beach Stay",
    "Overnight Packages",
    "Premium overnight resort experience for guests seeking comfort.",
    4, 2, 0, 5500, 200, 100,
    "https://images.unsplash.com/photo-1575429198097-0414ec08e8cd?w=1000",
  ],
  [
    "Barkada Overnight Package",
    "Overnight Packages",
    "Enjoy an overnight getaway with friends and family.",
    10, 5, 0, 6500, 200, 100,
    "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=1000",
  ],

  // OTHER RESORT FACILITIES
  [
    "Function Hall",
    "Function Hall",
    "Private event and celebration space for special occasions.",
    80, 20, 5000, 0, 0, 0,
    "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=1000",
  ],
  [
    "Karaoke Lounge",
    "Karaoke / Entertainment",
    "Private karaoke room for family gatherings and celebrations.",
    15, 0, 1200, 0, 0, 0,
    "https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=1000",
  ],
] as const;

// ==========================================
// INSERT ACCOMMODATIONS
// ==========================================

const insert = db.prepare(`
  INSERT OR IGNORE INTO accommodations (
    id,
    name,
    category,
    description,
    capacity_adults,
    capacity_children,
    day_price,
    night_price,
    extra_adult_fee,
    extra_child_fee,
    image_url
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const item of items) {
  const id = item[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  insert.run(id, ...item);
}

// ==========================================
// RESORT SERVICES
// ==========================================

const serviceInsert = db.prepare(`
  INSERT OR IGNORE INTO services (
    id,
    name,
    description,
    price
  )
  VALUES (?, ?, ?, ?)
`);

const services = [
  [
    "pool-access",
    "Swimming Pool Access",
    "Swimming pool access add-on.",
    150,
  ],
  [
    "karaoke-hour",
    "Karaoke (1 hour)",
    "One-hour karaoke session.",
    350,
  ],
  [
    "event-setup",
    "Function Hall Setup",
    "Basic event setup.",
    1000,
  ],
] as const;
for (const service of services) {
  serviceInsert.run(...service);
}

// ==========================================
// COMPLETION
// ==========================================

console.log(
  `Seed complete. Admin: ${env.ADMIN_EMAIL}. Set ADMIN_PASSWORD in .env before first seed.`
);
