import type { RequestHandler } from "msw";

/**
 * Default handlers shared by every test. Endpoint-group handlers built from
 * `src/types/api.ts` are added with the API types (task 6). Tests add their own
 * handlers with `server.use(...)`.
 */
export const handlers: RequestHandler[] = [];
