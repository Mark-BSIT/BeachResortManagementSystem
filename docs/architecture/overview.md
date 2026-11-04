# Architecture overview

The mobile app is a TypeScript Expo application. It calls a single Express REST API; the API owns authentication, authorization, pricing, booking availability, payment review and persistence. SQLite is the source of truth.

## Event-driven flow

Mobile controls use React Native event handlers. A small typed UI event bus emits `loginSucceeded`, `catalogLoaded`, `bookingSubmitted`, and `screenChanged`. On the server, successful domain operations write an event record to `event_outbox` in the same SQLite transaction as the business operation. A dispatcher emits typed domain events; subscribers write idempotent activity records. User-facing booking/payment notifications are inserted transactionally alongside the corresponding operation.

## OOP / modularity

`BookingService` encapsulates reservation creation and status transitions. Pricing is isolated as a domain function. Routes validate and delegate rather than embedding all booking rules. Repositories are currently represented by focused parameterized SQLite statements within service/route modules; a dedicated repository layer is a future refactor.

## Booking policy

Pending booking holds expire after 30 minutes. Expired holds are released during availability checks and booking creation. A booking is inserted using an immediate SQLite transaction, and overlapping pending, confirmed or checked-in reservations are rejected. Overnight pricing is based on the number of 24-hour periods in the submitted date range; the client should submit local check-in/check-out instants with explicit timezone offsets converted to ISO UTC.
