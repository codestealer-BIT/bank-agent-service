import type { FastifyRequest } from "fastify";

const userIdPattern = /^[A-Za-z0-9._:@-]{1,128}$/;

export function getAuthenticatedUserId(request: FastifyRequest): string {
  // Demo adapter only. In production, the bank API gateway must validate the
  // employee/customer token and inject the immutable subject into this header.
  const value = request.headers["x-user-id"];
  const userId = Array.isArray(value) ? value[0] : value;
  if (!userId || !userIdPattern.test(userId)) {
    const error = new Error("Missing or invalid X-User-Id");
    Object.assign(error, { statusCode: 401 });
    throw error;
  }
  return userId;
}
