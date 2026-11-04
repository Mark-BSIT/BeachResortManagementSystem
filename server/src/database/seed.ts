import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { db } from './connection.js';
import { env } from '../config/env.js';

const admin = db.prepare("SELECT id FROM users WHERE email=?").get(env.ADMIN_EMAIL);
if (!admin) db.prepare("INSERT INTO users(id,email,password_hash,role,full_name) VALUES(?,?,?,'ADMIN','Resort Administrator')")
  .run(randomUUID(),env.ADMIN_EMAIL,bcrypt.hashSync(env.ADMIN_PASSWORD,12));
const items = [
 ['Coastal Family Cottage','Cottages','Private cottage near the pool',8,6,1800,0,150,80,'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=1000'],
 ['Deluxe Ocean Room','Rooms','Air-conditioned overnight room',4,2,0,3200,200,100,'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1000'],
 ['Day Escape Package','Day-use Packages','Pool access and shaded lounge',6,4,950,0,100,50,'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1000'],
 ['Overnight Couple Package','Overnight Packages','Relaxing overnight stay for two',2,0,0,2800,0,0,'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1000'],
 ['Function Hall','Function Hall','Private event and celebration space',80,20,5000,0,0,0,'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=1000'],
 ['Karaoke Lounge','Karaoke / Entertainment','Private karaoke room',15,0,1200,0,0,0,'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=1000']
] as const;
const insert = db.prepare(`INSERT OR IGNORE INTO accommodations(id,name,category,description,capacity_adults,capacity_children,day_price,night_price,extra_adult_fee,extra_child_fee,image_url)
 VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
for (const item of items) insert.run(item[0].toLowerCase().replace(/[^a-z0-9]+/g,'-'),...item);
const serviceInsert = db.prepare('INSERT OR IGNORE INTO services(id,name,description,price) VALUES(?,?,?,?)');
serviceInsert.run('pool-access','Swimming Pool Access','Pool access add-on',150);
serviceInsert.run('karaoke-hour','Karaoke (1 hour)','One-hour karaoke session',350);
serviceInsert.run('event-setup','Function Hall Setup','Basic event setup',1000);
console.log(`Seed complete. Admin: ${env.ADMIN_EMAIL}. Set ADMIN_PASSWORD in .env before first seed.`);
