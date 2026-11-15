import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import * as axeMatchers from "vitest-axe/matchers";

import { server, unhandledRequestMessage, unhandledRequests } from "./msw/server";

expect.extend(axeMatchers);

// findBy* and waitFor give up after 5 s instead of 1 s, so slower CI runners do not time out
// while a lazy route or a chained request (token, then GET /me, then page data) settles.
configure({ asyncUtilTimeout: 5_000 });

// jsdom has no canvas; axe probes it for icon ligatures. Report "no canvas" instead of
// letting jsdom print a "not implemented" error. Colour contrast is checked against the
// design tokens by a dedicated unit test, since jsdom does not compute styles.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  server.listen({
    // Requirement 23.13: an unmocked request fails, and the error names the URL.
    onUnhandledRequest(request, print) {
      unhandledRequests.push(unhandledRequestMessage(request.method, request.url));
      // Makes the request fail as a network error; MSW's message also names the URL.
      print.error();
    },
  });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  // Fail the test even when application code swallowed the rejected request.
  const leaked = unhandledRequests.splice(0);
  if (leaked.length > 0) {
    throw new Error(leaked.join("\n"));
  }
});

afterAll(() => {
  server.close();
});
