import { setupServer } from "msw/node";

import { handlers } from "./handlers";

export const server = setupServer(...handlers);

/** Requests that reached the network layer without a matching handler. */
export const unhandledRequests: string[] = [];

export function unhandledRequestMessage(method: string, url: string): string {
  return `Unmocked network request: ${method} ${url}. Tests must not reach the network; add an MSW handler.`;
}
