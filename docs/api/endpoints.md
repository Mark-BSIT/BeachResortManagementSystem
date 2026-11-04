# API endpoints

All paths are prefixed with `/api`. Authenticated requests use `Authorization: Bearer <access-token>`.

- `GET /health`
- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET /accommodations`, `GET /accommodations/:id`, `GET /services`
- `GET /bookings/availability`, `POST /bookings`, `GET /bookings/mine`, `GET /bookings/:id`, `POST /bookings/:id/cancel`
- `POST /payments`, `GET /payments/mine`
- `GET /notifications`, `PATCH /notifications/:id/read`
- Admin: `GET /admin/dashboard`, `GET /admin/bookings`, `PATCH /admin/bookings/:id/status`, `GET /admin/payments`, `PATCH /admin/payments/:id/status`, `GET /admin/customers`, `POST /admin/accommodations`, `PATCH /admin/accommodations/:id`, `DELETE /admin/accommodations/:id`
- Admin reports: `GET /admin/reports/revenue`, `/bookings`, `/occupancy`
- Admin operations: `POST /admin/bookings/:id/check-in`, `POST /admin/bookings/:id/check-out`
- Reviews: `POST /reviews`, `GET /reviews`

JSON validation failures return HTTP 400. Unauthorized requests return 401; role failures return 403. Customers receive 404 rather than confirmation when requesting another customer's booking.
