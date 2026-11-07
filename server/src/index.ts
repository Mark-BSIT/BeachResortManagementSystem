import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { api } from "./routes/api.js";
import { dispatchOutbox } from "./services/outbox.service.js";
import "./events/handlers.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet());
const allowedOrigins = env.CORS_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        env.NODE_ENV === "development"
      ) {
        callback(null, true);
      } else {
        callback(new Error("Origin not allowed"));
      }
    },
    credentials: false,
  }),
);
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      const request = req as express.Request;

      if (request.originalUrl === '/api/payments/paymongo/webhook') {
        (request as express.Request & { rawBody?: Buffer }).rawBody =
          Buffer.from(buf);
      }
    },
  }),
);
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.use("/api", api);
app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
const server = app.listen(env.PORT, "0.0.0.0", () =>
  console.log(`Beach Resort API listening on port ${env.PORT}`),
);
const outboxTimer = setInterval(dispatchOutbox, 1500);
function shutdown() {
  clearInterval(outboxTimer);
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
