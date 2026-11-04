# Tide & Haven — Beach Resort Management System

A TypeScript mobile application (React Native + Expo Go) connected to a TypeScript Express REST API and SQLite database. Includes Admin and Customer roles, accommodation browsing, day-use/overnight reservation requests, approval workflow, payment submission and manual verification, notifications, basic reports, and check-in/check-out operations.

> **Implementation status:** This is a functional development foundation, not a production-certified resort platform. Core API and UI flows are implemented, but several requirements still need completion and device/integration testing. Read `docs/testing/results.md` and `docs/security/security.md` before use.

## Stack
- Mobile: React Native, Expo SDK 57, TypeScript
- Backend: Node.js 22+, Express 4, TypeScript
- Database: SQLite via better-sqlite3
- Authentication: bcrypt password hashing + short-lived JWT access token
- Validation/security: Zod, Helmet, CORS allowlist, rate limiting, parameterized SQL
- EDP: typed UI event bus, typed backend domain events, SQLite event outbox, notifications
- OOP: `BookingService` encapsulates reservation behavior; typed domain contracts and modular services

## Requirements
- Node.js 22 LTS recommended
- npm 10+
- Expo Go version compatible with Expo SDK 57
- Android phone and computer on the same Wi-Fi for physical-device testing

## 1. Configure and start the backend (Windows PowerShell)

```powershell
cd server
Copy-Item .env.example .env
```

Open `server/.env` and set a unique secret (at least 32 characters), and a new admin password (at least 12 characters):

```env
NODE_ENV=development
PORT=4000
DATABASE_FILE=./data/resort.sqlite
JWT_SECRET=put-a-long-random-secret-here-at-least-32-characters
JWT_EXPIRES_IN=2h
CORS_ORIGINS=http://localhost:8081,http://localhost:19006
ADMIN_EMAIL=admin@beachresort.local
ADMIN_PASSWORD=SetYourOwnStrongAdminPassword!
```

Install and initialize:

```powershell
npm install
npm run db:seed
npm run dev
```

The API runs at `http://localhost:4000`. Check `http://localhost:4000/api/health`.

The seed command creates a demo administrator and sample resort inventory. It is safe to rerun; it does not create duplicate sample records. Admin credentials are the values you placed in `.env` before the first seed.

## 2. Configure and start the mobile app

Open a second terminal:

```powershell
cd mobile
Copy-Item .env.example .env
```

Find your computer's local IPv4 address using `ipconfig`. Edit `mobile/.env` and replace the sample IP:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000/api
```

Install and start:

```powershell
npm install
npx expo start
```

Scan the QR code with Expo Go. Do not use `localhost` as the API host on a physical phone; `localhost` would refer to the phone itself. Both devices must use the same Wi-Fi. Allow Node.js / TCP port 4000 through Windows Firewall if prompted.

### Expo Go SDK compatibility

This project pins Expo SDK 57. Expo Go must support SDK 54. If your installed Expo Go only supports a newer SDK, upgrade the mobile dependencies together using the official Expo SDK upgrade instructions and `npx expo install --fix`; do not change only the `expo` package version. Re-run the mobile type-check and test on the actual phone after upgrading.

## Demo administrator

The seed script creates the admin using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `server/.env`. Change the example password before first seed. Never publish `.env` or use demo credentials on a public server.

## Useful commands

Backend:
```powershell
cd server
npm run db:seed
npm run dev
npm test
npm run build
npm start
```

Mobile:
```powershell
cd mobile
npm run typecheck
npx expo start
```

## Booking behavior

- Pending reservations create a 30-minute hold.
- Expired pending holds are released when availability is checked or a new reservation is created.
- Booking creation uses an immediate SQLite transaction and rejects overlapping active holds, confirmed reservations, and checked-in reservations.
- Day-use and overnight pricing is calculated server-side from accommodation prices and configured guest/service fees.
- Admin approval, rejection, and cancellation are validated server-side.
- Check-in requires a confirmed reservation and verified payments covering the full booking amount.

## Payment behavior

GCash, bank transfer, and cash-on-arrival are payment methods recorded for manual review. This application does not connect to GCash or a bank and does not charge accounts. The customer mobile UI accepts a payment amount and optional transaction reference. Actual payment-proof image upload, secure file storage, and scanning are not implemented. Admin must independently verify the payment before marking it verified.

## Important limitations

- QR code generation/scanning and push notification delivery are not implemented.
- Payment proof file upload is not implemented; never treat a client-supplied file path or reference as proof.
- Accommodation image URLs are sample remote images; admin image upload/gallery management is not implemented.
- Full admin editors for services, amenities, expenses, promotions, and customer account controls are not included in the current mobile UI.
- Revenue, booking, and occupancy reports are basic API summaries; charts/export are not implemented.
- Pagination and comprehensive audit filtering need additional work.
- JWT logout removes the token on the device but does not revoke a token server-side before expiry.
- The automated test suite currently focuses on pure pricing/interval domain logic. Full API integration, concurrency, security penetration, and physical Android tests remain outstanding.
- SQLite is suitable for a single API instance and development. For a multi-instance production service, migrate to PostgreSQL and a durable background worker/queue.

See `docs/` for architecture, API, database, security, and test notes. Do not deploy publicly until the outstanding security and QA work is completed.
