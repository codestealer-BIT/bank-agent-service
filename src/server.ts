import { join } from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { ZodError } from "zod";
import { corsOrigins, config } from "./config.js";
import { closeDatabase, migrate, pool } from "./database.js";
import { closeRedis, redis } from "./redis-leases.js";
import { registerRoutes } from "./routes.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
    ],
  },
  bodyLimit: 128 * 1024,
});

await app.register(cors, {
  credentials: true,
  origin(origin, callback) {
    if (!origin || corsOrigins.has(origin)) return callback(null, true);
    callback(new Error("Origin is not allowed"), false);
  },
});

await app.register(fastifyStatic, {
  root: join(process.cwd(), "public"),
  prefix: "/",
});

app.setErrorHandler((error, _request, reply) => {
  const normalizedError =
    error instanceof Error ? error : new Error(String(error));
  const statusCode =
    error instanceof ZodError
      ? 400
      : typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : normalizedError.message.includes("queue is full") ||
            normalizedError.message.includes("Timed out waiting")
          ? 503
          : 500;
  if (statusCode >= 500) app.log.error(normalizedError);
  reply.code(statusCode).send({
    error:
      statusCode >= 500 ? "Agent service unavailable" : normalizedError.message,
    detail:
      process.env.NODE_ENV === "production"
        ? undefined
        : normalizedError.message,
  });
});

await registerRoutes(app);
await migrate();
await redis.ping();
await pool.query("SELECT 1");

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await Promise.all([closeDatabase(), closeRedis()]);
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
