import test from "node:test";
import assert from "node:assert/strict";
import { renderCommits, renderPullRequests } from "../src/development.js";

const context = { baseUrl: "https://jira.example.test/browse/TEAM-1" };
const hash = "a".repeat(40);
const commit = (changes = {}) => ({
  id: hash, displayId: "aaaaaaa", message: "TEAM-1: Add export", author: "Alex",
  date: "2026-11-03T12:00:00.000+0200", repository: "portal",
  url: `https://git.example.test/projects/TEAM/repos/portal/commits/${hash}`, ...changes,
});

test("combines full commit hashes across repositories while retaining every link and distinct hashes", () => {
  const result = renderCommits([
    commit(), commit({ repository: "ipr", url: `https://git.example.test/projects/TEAM/repos/ipr/commits/${hash}` }),
    commit({ id: "b".repeat(40), displayId: "bbbbbbb", url: `https://git.example.test/commits/${"b".repeat(40)}` }),
  ], context);
  assert.match(result, /2 unique commits/);
  assert.equal(result.match(/^\| `aaaaaaa`/gm)?.length, 1);
  assert.equal(result.match(/^\| `bbbbbbb`/gm)?.length, 1);
  assert.ok(result.includes(`[portal](https://git.example.test/projects/TEAM/repos/portal/commits/${hash}) · [ipr](https://git.example.test/projects/TEAM/repos/ipr/commits/${hash})`));
  assert.match(result, /3 Nov 2026, 10:00:00 UTC/);
  assert.match(result, /\*\*Author:\*\* Alex/);
});

test("short and missing commit IDs never combine across repositories", () => {
  const result = renderCommits([
    commit({ id: "short", displayId: "short" }), commit({ id: "short", displayId: "short", repository: "ipr" }),
    commit({ id: "", displayId: "", repository: "portal", url: "" }), commit({ id: "", displayId: "", repository: "ipr", url: "" }),
  ], context);
  assert.equal(result.match(/^\| `short`/gm)?.length, 2);
  assert.equal(result.match(/^\| `Commit`/gm)?.length, 2);
  assert.ok(!result.includes("unique commits"));
});

test("full hash duplicates preserve richer messages, conflicting subjects, dates and authors", () => {
  const result = renderCommits([
    commit(), commit({ message: "TEAM-1: Add export\n\nFull body with ``` and </details>.", author: "Blake", date: "2026-11-04T12:00:00Z" }),
    commit({ message: "A different subject" }),
  ], context);
  assert.equal(result.match(/^\| `aaaaaaa`/gm)?.length, 2, "One commit row plus one attribution row");
  assert.ok(result.includes("Alex · Blake"));
  assert.ok(result.includes("Full body with ``` and </details>."));
  assert.ok(result.includes("````text\nTEAM-1: Add export"));
  assert.ok(result.includes("A different subject"));
  assert.ok(result.includes("4 Nov 2026, 12:00:00 UTC"));
});

test("commit dates sort newest first and unsafe links and Markdown stay inert", () => {
  const result = renderCommits([
    commit({ id: "old", displayId: "old", message: "# *old* | [subject]", url: "javascript:alert(1)", repository: "<repo>" }),
    commit({ id: "new", displayId: "new", date: "2026-11-04T12:00:00Z" }),
  ], context);
  assert.ok(result.indexOf("`new`") < result.indexOf("`old`"));
  assert.ok(result.includes("\\# \\*old\\* \\| \\[subject\\]"));
  assert.ok(result.includes("\\<repo\\>"));
  assert.ok(!result.includes("javascript:"));
});

test("a full hash remains readable when no usable link contains it", () => {
  const sha256 = "f".repeat(64);
  const result = renderCommits([
    commit({ url: "javascript:alert(1)" }),
    commit({ id: sha256, displayId: "fffffff", url: "", repository: "ipr" }),
  ], context);
  assert.ok(result.includes(`| \`${hash}\` |`));
  assert.ok(result.includes(`| \`${sha256}\` |`));
  assert.ok(!result.includes("javascript:"));
});

test("PR table is compact and preserves full titles, authors and branches in details", () => {
  const result = renderPullRequests([{
    id: "#7", title: "TEAM-1 TEAM-2: Add export", status: "MERGED", author: "Alex",
    repository: "portal", url: "https://git.example.test/projects/TEAM/repos/portal/pull-requests/7",
    sourceBranch: "feature/TEAM-1-*", destinationBranch: "main",
  }, {
    id: "8", title: "chore(deps): update Vitest to 5.0.5", status: "DECLINED", repository: "ipr",
    url: "https://git.example.test/projects/TEAM/repos/ipr/pull-requests/8",
  }], context);
  assert.ok(result.startsWith("| PR | Title | Status | Repository |\n"));
  assert.ok(result.includes("| Add export | Merged | [portal](https://git.example.test/projects/TEAM/repos/portal) |"));
  assert.ok(result.includes("chore(deps): update Vitest to 5.0.5 | Declined"));
  assert.ok(result.includes("**Original title:** TEAM-1 TEAM-2: Add export"));
  assert.ok(result.includes("**Author:** Alex"));
  assert.ok(result.includes("**Branches:** `feature/TEAM-1-*` → `main`"));
  assert.match(result, /<details>\n<summary>Authors, branches and original titles<\/summary>/);
});

test("PR identifiers in different repositories remain separate and values are escaped", () => {
  const result = renderPullRequests([
    { id: "7", title: "Fix [export] | <script>", status: "OPEN", repository: "*portal*", url: "javascript:alert(1)" },
    { id: "7", title: "Other request", status: "CUSTOM_STATE", repository: "ipr", url: "/pull-request/7" },
  ], context);
  assert.equal(result.match(/^\| (?:\\#7|\[\\#7\])/gm)?.length, 2);
  assert.ok(result.includes("Fix \\[export\\] \\| \\<script\\> | Open | \\*portal\\*"));
  assert.ok(result.includes("CUSTOM\\_STATE"));
  assert.ok(!result.includes("javascript:"));
});

test("empty or malformed arrays do not emit empty development tables", () => {
  assert.equal(renderCommits(null), "");
  assert.equal(renderPullRequests(undefined), "");
  assert.equal(renderCommits([null, "bad"]), "");
  assert.equal(renderPullRequests([null]), "");
});
