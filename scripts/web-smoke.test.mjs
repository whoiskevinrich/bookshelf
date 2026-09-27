import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSite } from "./web-smoke.mjs";

const HTML =
  '<!doctype html><html><head><link rel="icon" href="/favicon.svg" />' +
  '<script type="module" crossorigin src="/assets/index-abc.js"></script>' +
  '<link rel="stylesheet" crossorigin href="/assets/index-abc.css"></head>' +
  '<body><div id="root"></div></body></html>';
const POOL = "us-west-2_AbC123";

/** Build a fake fetch from a path → {status, body, type} map (unknown paths 404). */
function fakeFetch(routes) {
  return async (url) => {
    const { pathname } = new URL(url);
    if (routes[pathname] instanceof Error) throw routes[pathname];
    const r = routes[pathname] ?? { status: 404, body: "" };
    const headers = new Headers(r.type ? { "content-type": r.type } : {});
    return { status: r.status, headers, text: async () => r.body };
  };
}

const healthy = {
  "/": { status: 200, body: HTML, type: "text/html" },
  "/shelf": { status: 200, body: HTML, type: "text/html" },
  "/assets/index-abc.js": { status: 200, body: "", type: "application/javascript" },
  "/assets/index-abc.css": { status: 200, body: "", type: "text/css" },
  "/config.json": { status: 200, body: JSON.stringify({ cognito: { userPoolId: POOL } }) },
};

test("a healthy site passes, with and without an expected pool", async () => {
  const fetchImpl = fakeFetch(healthy);
  assert.deepEqual(await checkSite({ baseUrl: "https://x.test/", fetchImpl }), []);
  assert.deepEqual(
    await checkSite({ baseUrl: "https://x.test", expectedUserPoolId: POOL, fetchImpl }),
    [],
  );
});

test("S3 AccessDenied on every path (the BOOKSHELF-109 outage) fails all three", async () => {
  const denied = { status: 403, body: "<Error><Code>AccessDenied</Code></Error>" };
  const fetchImpl = fakeFetch({ "/": denied, "/shelf": denied, "/config.json": denied });
  const failures = await checkSite({ baseUrl: "https://x.test", fetchImpl });
  assert.equal(failures.length, 3);
  assert.match(failures[0], /GET \/ → 403/);
});

test("a 200 without the React mount point fails", async () => {
  const fetchImpl = fakeFetch({ ...healthy, "/": { status: 200, body: "<html></html>" } });
  const failures = await checkSite({ baseUrl: "https://x.test", fetchImpl });
  assert.deepEqual(failures, ['GET / → missing <div id="root"']);
});

test("a missing bundle served as the SPA fallback (200 text/html) fails", async () => {
  const fallback = { status: 200, body: HTML, type: "text/html" };
  const fetchImpl = fakeFetch({
    ...healthy,
    "/assets/index-abc.js": fallback,
    "/assets/index-abc.css": fallback,
  });
  const failures = await checkSite({ baseUrl: "https://x.test", fetchImpl });
  assert.deepEqual(failures, [
    "GET /assets/index-abc.js → content-type text/html (expected javascript)",
    "GET /assets/index-abc.css → content-type text/html (expected css)",
  ]);
});

test("config.json that isn't JSON, lacks a pool, or names the wrong pool fails", async () => {
  const cases = [
    [{ status: 200, body: "<html>" }, undefined, /not valid JSON/],
    [{ status: 200, body: "{}" }, undefined, /not a pool id/],
    [
      { status: 200, body: JSON.stringify({ cognito: { userPoolId: POOL } }) },
      "us-west-2_Other",
      /expected us-west-2_Other/,
    ],
  ];
  for (const [cfg, expectedUserPoolId, pattern] of cases) {
    const fetchImpl = fakeFetch({ ...healthy, "/config.json": cfg });
    const failures = await checkSite({ baseUrl: "https://x.test", expectedUserPoolId, fetchImpl });
    assert.equal(failures.length, 1);
    assert.match(failures[0], pattern);
  }
});

test("a network error is reported, not thrown", async () => {
  const fetchImpl = fakeFetch({ ...healthy, "/shelf": new Error("ECONNRESET") });
  const failures = await checkSite({ baseUrl: "https://x.test", fetchImpl });
  assert.deepEqual(failures, ["GET /shelf → request failed: ECONNRESET"]);
});
