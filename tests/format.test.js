import test from "node:test";
import assert from "node:assert/strict";
import { escapeText, formatDate, link, oneLine } from "../src/format.js";

const context = { baseUrl: "https://jira.example.test/company/browse/DEMO-12" };

test("readable dates retain the supplied daylight-saving offset rather than the machine time zone", () => {
  assert.equal(formatDate("2026-06-25T15:55:04.360+0200"), "25 Jun 2026, 15:55 UTC+02:00");
  assert.equal(formatDate("2026-11-04T08:51:48.262+0100"), "4 Nov 2026, 08:51 UTC+01:00");
  assert.equal(formatDate("2026-11-04T08:51:48-04:00", { seconds: true }), "4 Nov 2026, 08:51:48 UTC-04:00");
  assert.equal(formatDate("2026-11-04T08:51:48+05:30"), "4 Nov 2026, 08:51 UTC+05:30");
});

test("UTC date conversion handles midnight, year boundaries and fractional-hour offsets", () => {
  assert.equal(formatDate("2027-01-01T00:30:45+0100", { utc: true, seconds: true }), "31 Dec 2026, 23:30:45 UTC");
  assert.equal(formatDate("2026-12-31T23:30:45-0400", { utc: true }), "1 Jan 2027, 03:30 UTC");
  assert.equal(formatDate("2026-11-04T08:51:48+05:30", { utc: true, seconds: true }), "4 Nov 2026, 03:21:48 UTC");
});

test("zero offsets share the UTC label and optional seconds remain explicit", () => {
  assert.equal(formatDate("2026-11-03T15:21:33.000Z", { seconds: true }), "3 Nov 2026, 15:21:33 UTC");
  assert.equal(formatDate("2026-11-03T15:21+0000", { seconds: true }), "3 Nov 2026, 15:21:00 UTC");
  assert.equal(formatDate("2026-11-03T15:21:33+00:00"), "3 Nov 2026, 15:21 UTC");
});

test("date-only fields stay date-only and unzoned ISO timestamps are preserved", () => {
  assert.equal(formatDate("2026-11-04"), "4 Nov 2026");
  assert.equal(formatDate("2024-02-29", { utc: true }), "29 Feb 2024");
  assert.equal(formatDate("2026-11-04T08:51:48"), "2026-11-04T08:51:48");
});

test("invalid dates, times and time-zone offsets are not silently repaired", () => {
  for (const value of [
    "2026-02-29", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00",
    "2026-11-04T24:00:00Z", "2026-11-04T08:60:00Z", "2026-11-04T08:00:60Z",
    "2026-11-04T08:00:00+2400", "2026-11-04T08:00:00+0160", "31/Apr/26 10:00 AM",
    "22/Oct/26 00:00 AM", "22/Oct/26 13:00 PM", "22/Oct/26 10:60 AM",
  ]) assert.equal(formatDate(value), value, value);
});

test("Jira chart dates explicitly retain their unknown time zone", () => {
  assert.equal(formatDate("22/Oct/26 10:00 AM"), "22 Oct 2026, 10:00 AM — time zone unspecified");
  assert.equal(formatDate("2/oct/2026 1:05 pm", { utc: true }), "2 Oct 2026, 1:05 PM — time zone unspecified");
  assert.equal(formatDate("29/Feb/24 12:00 AM"), "29 Feb 2024, 12:00 AM — time zone unspecified");
});

test("unknown and missing date values remain readable without guessing their meaning", () => {
  assert.equal(formatDate("Yesterday"), "Yesterday");
  assert.equal(formatDate(" 03/04/2026 "), "03/04/2026");
  assert.equal(formatDate(null), "");
});

test("same-origin Jira URLs shorten to issue keys while retaining queries and fragments", () => {
  const href = "https://jira.example.test/company/browse/COIPR-2022?view=detail#icft=COIPR-2022";
  assert.equal(link(escapeText(href), href, context), `[COIPR-2022](${href})`);
  assert.equal(link("", "/company/browse/TEAM_2-8/?a=1&b=2#description", context),
    "[TEAM\\_2-8](https://jira.example.test/company/browse/TEAM_2-8/?a=1&b=2#description)");
});

test("custom Jira link labels and external issue URLs preserve their original labels", () => {
  const href = "https://jira.example.test/company/browse/DEMO-12";
  assert.equal(link(oneLine("Implementation [details]"), href, context), `[Implementation \\[details\\]](${href})`);
  const external = "https://another.example.test/browse/DEMO-12";
  assert.equal(link(escapeText(external), external, context), `[${external}](${external})`);
  const lookalike = "https://jira.example.test@external.example.test/browse/DEMO-12";
  assert.equal(link(escapeText(lookalike), lookalike, context), `[${lookalike}](${lookalike})`);
});

test("ordinary same-origin links keep their label and Markdown URL delimiters are encoded", () => {
  const href = "https://jira.example.test/company/help?q=(one)&next=two#section";
  assert.equal(link(escapeText(href), href, context),
    `[${escapeText(href)}](https://jira.example.test/company/help?q=%28one%29&next=two#section)`);
});

test("unsafe links remain inert text even when shaped like Jira issue links", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///browse/DEMO-12"]) {
    assert.equal(link("Issue details", href, context), "Issue details");
  }
});
