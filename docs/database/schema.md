# Database

SQLite schema is defined in `server/src/database/schema.ts` and applied when the API starts. Tables include users, accommodations, services, bookings, booking_services, payments, notifications, activity_logs, event_outbox, check_in_out, reviews, promotions and expenses. Foreign keys are enabled and indexes cover booking overlap checks, customer booking history, notification feeds and pending outbox records.

For production, use a persistent volume and scheduled encrypted backups. For concurrent multi-instance production deployments, migrate to PostgreSQL and a durable queue/outbox worker.
