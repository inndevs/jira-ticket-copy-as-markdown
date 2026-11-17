import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/content.js", import.meta.url), "utf8");
const adf = value => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] });
const comment = (id, value = "Reply") => ({ id: String(id), author: { displayName: "Alex" }, created: `2026-10-01T12:00:00.000Z`, body: adf(value) });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const emptyDocument = { querySelector: () => null, querySelectorAll: () => [] };

function browser({ href = "https://example.atlassian.net/browse/TEAM-42", fetch: respond, document = emptyDocument } = {}) {
  const requests = [];
  const context = vm.createContext({ URL, AbortController, setTimeout, clearTimeout, location: { href }, document,
    fetch: async (url, options) => { requests.push({ url, options }); return respond(url, options); }
  });
  return { requests, read: () => vm.runInContext(source, context) };
}

function node(value, attrs = {}, matches = {}) {
  const result = {
    textContent: value, innerText: value, innerHTML: attrs.html || value, id: attrs.id || "",
    getAttribute: name => attrs[name] ?? null, closest: () => null,
    querySelector: selector => matches[selector]?.[0] || null,
    querySelectorAll: selector => matches[selector] || [],
    cloneNode: () => result
  };
  return result;
}

test("each injection returns fresh data without a persistent listener", async () => {
  let reads = 0;
  const page = browser({ fetch: () => response({ fields: { summary: `Issue ${++reads}`, comment: { comments: [], total: 0 } } }) });
  assert.equal((await page.read()).issue.title, "Issue 1");
  assert.equal((await page.read()).issue.title, "Issue 2");
  assert.equal(page.requests.length, 2);
});

test("HTTP pages are rejected before any authenticated request", async () => {
  const page = browser({ href: "http://jira.example.test/browse/TEAM-1" });
  const result = await page.read();
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTPS/);
  assert.equal(page.requests.length, 0);
});

test("reads the current issue over same-origin GET and preserves rich content and useful metadata", async () => {
  const page = browser({ fetch: url => url.includes("/comment?") ? response({ comments: [], total: 0, startAt: 0 }) : response({ key: "TEAM-42", names: { customfield_100: "Story points", customfield_101: "Acceptance criteria", customfield_102: "Choice" },
    fields: { summary: "Export the issue", description: adf("A rich description"), issuetype: { name: "Task" }, status: { name: "In progress" }, assignee: null, reporter: { displayName: "Hannes" }, labels: ["export", "docs"], customfield_100: 5, customfield_101: adf("Done when tested"), customfield_102: { value: "Parent", child: { value: "Child" } }, environment: "Chrome", parent: { key: "TEAM-2", fields: { summary: "Project" } }, attachment: [{ id: "88", filename: "image.png", content: "https://example.atlassian.net/attachment/88", mimeType: "image/png", size: 300 }], issuelinks: [{ type: { outward: "blocks" }, outwardIssue: { key: "TEAM-3", fields: { summary: "Release" } } }] }, renderedFields: { description: "<p>A rich description</p>" }
  }) });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(result.issue.title, "Export the issue");
  assert.equal(result.issue.description.adf.content[0].content[0].text, "A rich description");
  assert.equal(result.issue.description.html, "<p>A rich description</p>");
  assert.equal(result.issue.fields.find(item => item.name === "Assignee").value, "Unassigned");
  assert.deepEqual(JSON.parse(JSON.stringify(result.issue.fields.find(item => item.name === "Parent").value)), {
    key: "TEAM-2", title: "Project", url: "https://example.atlassian.net/browse/TEAM-2",
  });
  assert.equal(result.issue.customFields.find(item => item.name === "Story points").value, "5");
  assert.equal(result.issue.customFields.find(item => item.name === "Choice").value, "Parent / Child");
  assert.ok(result.issue.sections.find(item => item.name === "Acceptance criteria").body.adf);
  assert.equal(result.issue.sections.find(item => item.name === "Linked issues").body.text, "blocks: TEAM-3 — Release");
  assert.deepEqual(JSON.parse(JSON.stringify(result.issue.sections.find(item => item.name === "Linked issues").items)), [
    { relation: "blocks", key: "TEAM-3", title: "Release", url: "https://example.atlassian.net/browse/TEAM-3" },
  ]);
  assert.equal(result.issue.attachments[0].id, "88");
  assert.equal(result.issue.warnings, undefined);
  const api = new URL(page.requests[0].url);
  assert.equal(api.pathname, "/rest/api/3/issue/TEAM-42");
  assert.equal(api.searchParams.get("fields"), "*all");
  assert.equal(api.searchParams.get("expand"), "names,renderedFields");
  for (const { url, options } of page.requests) {
    assert.equal(new URL(url).origin, "https://example.atlassian.net");
    assert.equal(options.credentials, "include");
    assert.equal(options.method || "GET", "GET");
    assert.equal(options.redirect, "error");
  }
});

test("issue references retain relation direction, ordering, titles and the Jira context path", async () => {
  const page = browser({ href: "https://jira.example.test/company/browse/TEAM-42", fetch: () => response({
    fields: {
      summary: "Related work", comment: { comments: [], total: 0 },
      parent: { key: "TEAM-1", fields: { summary: "Parent | original wording" }, self: "https://untrusted.example/parent" },
      issuelinks: [
        { type: { outward: "blocks", inward: "is blocked by" }, outwardIssue: { key: "TEAM-2", fields: { summary: "First" } } },
        { type: { outward: "blocks", inward: "is blocked by" }, inwardIssue: { key: "TEAM-3", fields: { summary: "Second [rule]" } } },
        { inwardIssue: { key: "OPS_2-4", fields: { summary: "Third" } } },
        { type: { outward: "ignorable" } },
      ],
      subtasks: [{ key: "TEAM-5", fields: { summary: "Child" } }, { key: "TEAM-6", fields: { summary: "Next child" } }],
    },
  }) });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.issue.fields.find(item => item.name === "Parent").value)), {
    key: "TEAM-1", title: "Parent | original wording", url: "https://jira.example.test/company/browse/TEAM-1",
  });
  const linked = result.issue.sections.find(item => item.name === "Linked issues");
  assert.deepEqual(JSON.parse(JSON.stringify(linked.items)), [
    { relation: "blocks", key: "TEAM-2", title: "First", url: "https://jira.example.test/company/browse/TEAM-2" },
    { relation: "is blocked by", key: "TEAM-3", title: "Second [rule]", url: "https://jira.example.test/company/browse/TEAM-3" },
    { relation: "relates to", key: "OPS_2-4", title: "Third", url: "https://jira.example.test/company/browse/OPS_2-4" },
  ]);
  assert.equal(linked.body.text, "blocks: TEAM-2 — First\nis blocked by: TEAM-3 — Second [rule]\nrelates to: OPS_2-4 — Third");
  const subtasks = result.issue.sections.find(item => item.name === "Subtasks");
  assert.deepEqual(JSON.parse(JSON.stringify(subtasks.items)), [
    { key: "TEAM-5", title: "Child", url: "https://jira.example.test/company/browse/TEAM-5" },
    { key: "TEAM-6", title: "Next child", url: "https://jira.example.test/company/browse/TEAM-6" },
  ]);
  assert.equal(subtasks.body.text, "TEAM-5 — Child\nTEAM-6 — Next child");
});

test("invalid issue reference keys preserve labels without creating links", async () => {
  const page = browser({ fetch: () => response({ fields: {
    summary: "Malformed references", comment: { comments: [], total: 0 },
    parent: { key: "//external.example", fields: { summary: "Original parent" } },
    issuelinks: [{ outwardIssue: { key: "../OTHER-1", fields: { summary: "Original issue" } } }],
  } }) });
  const result = await page.read();
  assert.equal(result.ok, true);
  const parent = result.issue.fields.find(item => item.name === "Parent").value;
  assert.equal(parent.key, "//external.example");
  assert.equal(parent.title, "Original parent");
  assert.equal(parent.url, "");
  const linked = result.issue.sections.find(item => item.name === "Linked issues").items[0];
  assert.equal(linked.key, "../OTHER-1");
  assert.equal(linked.url, "");
});

test("small custom fields remain optional data rather than ordinary sections", async () => {
  const page = browser({ fetch: () => response({ names: {
    customfield_100: "RoM Estimate (migrated)", customfield_101: "[CHART] Date of First Response",
  }, fields: {
    summary: "Small custom fields", comment: { comments: [], total: 0 },
    customfield_100: 10, customfield_101: "22/Oct/26 10:00 AM",
  } }) });
  const result = await page.read();
  assert.deepEqual(JSON.parse(JSON.stringify(result.issue.customFields)), [
    { name: "RoM Estimate (migrated)", value: "10" },
    { name: "[CHART] Date of First Response", value: "22/Oct/26 10:00 AM" },
  ]);
  assert.equal(result.issue.sections.length, 0);
});

test("selectedIssue takes precedence and digit/underscore project keys retain Jira context paths", async () => {
  const page = browser({ href: "https://jira.example.test/jira/browse/OLD-1?selectedIssue=OPS_2-17", fetch: url => url.includes("/comment?") ? response({ comments: [], total: 0 }) : response({ fields: { summary: "Selected issue" } }) });
  const result = await page.read();
  assert.equal(result.issue.key, "OPS_2-17");
  assert.equal(result.issue.url, "https://jira.example.test/jira/browse/OPS_2-17");
  assert.equal(new URL(page.requests[0].url).pathname, "/jira/rest/api/3/issue/OPS_2-17");
});

test("issueKey works on legacy boards and API v2 is tried when v3 is unsupported", async () => {
  const page = browser({ href: "https://jira.example.test/company/secure/RapidBoard.jspa?issueKey=A_2-19", fetch: url => {
    if (url.includes("/api/3/")) return response({}, 404);
    return url.includes("/comment?") ? response({ comments: [{ ...comment(20), body: "A server comment", renderedBody: "<p>A server comment</p>" }], total: 1 }) : response({ fields: { summary: "Server issue", description: "wiki-style text" }, renderedFields: { description: "<p>Rendered description</p>" } });
  } });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(page.requests.length, 3);
  assert.equal(new URL(page.requests[1].url).pathname, "/company/rest/api/2/issue/A_2-19");
  assert.equal(result.issue.description.html, "<p>Rendered description</p>");
  assert.equal(result.issue.comments[0].id, "20");
  assert.equal(result.issue.comments[0].body.html, "<p>A server comment</p>");
});

test("comment pagination uses the actual page length, preserves identical comments by ID, and deduplicates embedded comments", async () => {
  const page = browser({ fetch: url => {
    if (!url.includes("/comment?")) return response({ fields: { summary: "Paged", comment: { total: 3, comments: [comment(1)] } } });
    const offset = Number(new URL(url).searchParams.get("startAt"));
    return response({ startAt: offset, maxResults: 1, total: 3, comments: [comment(offset + 1, "Same content")] });
  } });
  const result = await page.read();
  assert.deepEqual(Array.from(result.issue.comments, item => item.id), ["1", "2", "3"]);
  assert.deepEqual(page.requests.slice(1).map(item => new URL(item.url).searchParams.get("startAt")), ["0", "1", "2"]);
  assert.equal(result.issue.warnings, undefined);
});

test("complete embedded rich comments avoid a redundant API call", async () => {
  const page = browser({ fetch: () => response({ fields: { summary: "Complete", comment: { comments: [comment(1), { ...comment(2), body: "*Bold*", renderedBody: "<strong>Bold</strong>" }], total: 2 } } }) });
  const result = await page.read();
  assert.deepEqual(Array.from(result.issue.comments, item => item.id), ["1", "2"]);
  assert.equal(result.issue.comments[0].body.adf.content[0].content[0].text, "Reply");
  assert.equal(result.issue.comments[1].body.html, "<strong>Bold</strong>");
  assert.equal(result.issue.warnings, undefined);
  assert.equal(page.requests.length, 1);
});

test("raw embedded wiki comments still fetch rendered formatting", async () => {
  const page = browser({ fetch: url => url.includes("/comment?")
    ? response({ comments: [{ ...comment(1), body: "*Bold*", renderedBody: "<strong>Bold</strong>" }], total: 1 })
    : response({ fields: { summary: "Wiki", comment: { comments: [{ ...comment(1), body: "*Bold*" }], total: 1 } } }) });
  const result = await page.read();
  assert.equal(result.issue.comments[0].body.html, "<strong>Bold</strong>");
  assert.equal(page.requests.length, 2);
});

test("comment limits are explicit and keep the first 1000 comments", async () => {
  const page = browser({ fetch: url => {
    if (!url.includes("/comment?")) return response({ fields: { summary: "Large issue" } });
    const offset = Number(new URL(url).searchParams.get("startAt"));
    return response({ startAt: offset, total: 1001, comments: Array.from({ length: 100 }, (_, index) => comment(offset + index + 1)) });
  } });
  const result = await page.read();
  assert.equal(result.issue.comments.length, 1000);
  assert.match(result.issue.warnings.join(" "), /1000 of 1001/);
  assert.equal(page.requests.length, 11);
});

test("comment retrieval failure preserves embedded comments with a warning", async () => {
  const page = browser({ fetch: url => url.includes("/comment?") ? response({}, 403) : response({ fields: { summary: "Restricted comments", comment: { comments: [comment(99)], total: 2 } } }) });
  const result = await page.read();
  assert.equal(result.issue.comments[0].id, "99");
  assert.match(result.issue.warnings.join(" "), /Could not retrieve all comments.*HTTP 403/);
});

test("ordinary board-card links cannot select an arbitrary issue", async () => {
  const card = node("WRONG-1", { href: "/browse/WRONG-1" });
  const page = browser({ href: "https://example.atlassian.net/jira/software/projects/TEAM/boards/1", document: { querySelector: () => null, querySelectorAll: selector => selector === "a[href]" ? [card] : [] } });
  const result = await page.read();
  assert.equal(result.ok, false);
  assert.match(result.error, /No current Jira issue/);
  assert.equal(page.requests.length, 0);
});

test("DOM fallback exports visible description and comment metadata without clicking or scrolling", async () => {
  const summary = node("Visible issue title");
  const description = node("Description content", { html: "<p>Description content</p>" });
  const author = node("Sam");
  const date = node("Yesterday", { datetime: "2026-10-04T12:30:00Z" });
  const body = node("Visible reply", { html: "<p>Visible reply</p>" });
  const entry = node("", { id: "comment-100" });
  entry.querySelector = selector => selector.includes(".action-body") ? body : selector.includes(".user-hover") ? author : selector.includes("time,") ? date : null;
  const document = {
    querySelectorAll: selector => selector.startsWith("#summary-val") ? [summary] : selector.startsWith(".issue-comment") ? [entry] : [],
    querySelector: selector => selector.startsWith("#description-val") ? description : null
  };
  const page = browser({ document, fetch: () => response({}, 403) });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(result.issue.title, "Visible issue title");
  assert.equal(result.issue.description.html, "<p>Description content</p>");
  assert.equal(result.issue.comments[0].author, "Sam");
  assert.equal(result.issue.comments[0].created, "2026-10-04T12:30:00Z");
  assert.equal(result.issue.comments[0].id, "100");
  assert.match(result.issue.warnings[0], /visible page content.*unloaded content/);
  assert.equal(page.requests.length, 1);
});

test("a current-issue breadcrumb can identify an open modal on a board", async () => {
  const summary = node("Modal issue");
  const breadcrumb = node("TEAM_2-8", { href: "/browse/TEAM_2-8" });
  const document = { querySelector: () => null, querySelectorAll: selector => selector.startsWith("#summary-val") ? [summary] : selector.startsWith("#key-val") ? [breadcrumb] : [] };
  const page = browser({ href: "https://example.atlassian.net/jira/software/projects/TEAM/boards/1", document, fetch: url => url.includes("/comment?") ? response({ comments: [], total: 0 }) : response({ fields: { summary: "Modal issue" } }) });
  const result = await page.read();
  assert.equal(result.issue.key, "TEAM_2-8");
  assert.equal(result.issue.url, "https://example.atlassian.net/browse/TEAM_2-8");
});

test("a stale issue heading cannot provide fallback content for a different selected issue", async () => {
  const summary = node("Previous issue");
  const breadcrumb = node("OLD-1", { href: "/browse/OLD-1" });
  const document = { querySelector: () => null, querySelectorAll: selector => selector.startsWith("#summary-val") ? [summary] : selector.startsWith("#key-val") ? [breadcrumb] : [] };
  const page = browser({ href: "https://example.atlassian.net/jira/software/projects/TEAM/boards/1?selectedIssue=NEW-2", document, fetch: () => response({}, 403) });
  const result = await page.read();
  assert.equal(result.ok, false);
  assert.match(result.error, /Could not read NEW-2/);
});

test("invalid context metadata cannot redirect authenticated requests off site", async () => {
  const context = node("", { content: "/\\external.example.test" });
  const document = { querySelector: selector => selector.startsWith("meta[") ? context : null, querySelectorAll: () => [] };
  const page = browser({ href: "https://example.atlassian.net/jira/software/projects/TEAM/boards/1?selectedIssue=TEAM-1", document, fetch: url => url.includes("/comment?") ? response({ comments: [], total: 0 }) : response({ fields: { summary: "Issue" } }) });
  const result = await page.read();
  assert.equal(result.ok, true);
  for (const request of page.requests) assert.equal(new URL(request.url).origin, "https://example.atlassian.net");
});

const developmentIssue = (extra = {}) => ({ id: "10142", key: "TEAM-42", fields: {
  summary: "Export development activity", description: adf("Keep the issue description"),
  comment: { comments: [comment(1)], total: 1 },
}, ...extra });
const developmentSummary = ({ commits = 0, pullRequests = 0, repositories = {}, providers = {}, open = pullRequests } = {}) => ({
  errors: [], summary: {
    repository: { overall: { count: commits }, byInstanceType: repositories },
    pullrequest: { overall: { count: open, details: { total: pullRequests } }, byInstanceType: providers },
  },
});

test("development extraction normalizes multiple providers and deduplicates by URL or repository identity", async () => {
  const sharedCommit = { id: "abcdef123456789", displayId: "abcdef1", message: "Add export\n\nPreserve the full message.", url: "https://git.example.test/team/repo/commits/abcdef123456789", author: { name: "Alex" }, authorTimestamp: 1791273600000 };
  const stashRequest = { id: "7", title: "Add export", url: "https://git.example.test/team/repo/pull-requests/7", status: "MERGED", author: { displayName: "Alex" }, source: { branch: "feature/export", repository: { name: "team/repo" } }, destination: { branch: "main" } };
  const page = browser({ fetch: rawURL => {
    const url = new URL(rawURL);
    if (url.pathname.includes("/rest/api/")) return response(developmentIssue());
    if (url.pathname.endsWith("/summary")) return response(developmentSummary({ commits: 3, pullRequests: 2, open: 0, repositories: { stash: { count: 2 }, GitHub: { count: 2 } }, providers: { stash: { count: 1 }, GitHub: { count: 1 } } }));
    assert.equal(url.pathname, "/rest/dev-status/1.0/issue/detail");
    const provider = url.searchParams.get("applicationType");
    if (url.searchParams.get("dataType") === "repository") {
      return response({ errors: [], detail: [{ repositories: [{ name: provider === "stash" ? "team/repo" : "team/other", url: `https://git.example.test/${provider}`, commits: [sharedCommit, { id: "same-id", displayId: "same-id", message: "Distinct repository commit" }, sharedCommit] }] }] });
    }
    return response({ errors: [], detail: [{ pullRequests: [stashRequest, provider === "stash" ? stashRequest : { ...stashRequest, url: "https://github.example.test/team/repo/pull/7" }] }] });
  } });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(result.issue.commits.length, 3);
  assert.equal(result.issue.pullRequests.length, 2);
  const commit = result.issue.commits.find(item => item.id === sharedCommit.id);
  assert.equal(commit.displayId, "abcdef1");
  assert.equal(commit.message, sharedCommit.message);
  assert.equal(commit.url, sharedCommit.url);
  assert.equal(commit.author, "Alex");
  assert.equal(commit.date, "2026-10-06T08:00:00.000Z");
  assert.ok(["team/repo", "team/other"].includes(commit.repository));
  assert.deepEqual(Array.from(result.issue.commits.filter(item => item.id === "same-id"), item => item.repository).sort(), ["team/other", "team/repo"]);
  const request = result.issue.pullRequests.find(item => item.url === stashRequest.url);
  assert.equal(request.title, "Add export");
  assert.equal(request.status, "MERGED");
  assert.equal(request.author, "Alex");
  assert.equal(request.repository, "team/repo");
  assert.equal(request.sourceBranch, "feature/export");
  assert.equal(request.destinationBranch, "main");
  const details = page.requests.filter(item => new URL(item.url).pathname.endsWith("/detail"));
  assert.equal(details.length, 4);
  assert.ok(details.every(item => new URL(item.url).searchParams.get("issueId") === "10142"));
  assert.deepEqual(details.map(item => `${new URL(item.url).searchParams.get("applicationType")}:${new URL(item.url).searchParams.get("dataType")}`).sort(), ["GitHub:pullrequest", "GitHub:repository", "stash:pullrequest", "stash:repository"]);
  assert.equal(result.issue.warnings, undefined);
});

test("pull requests include open, merged and declined results using the summary total", async () => {
  const page = browser({ fetch: rawURL => {
    const url = new URL(rawURL);
    if (url.pathname.includes("/rest/api/")) return response(developmentIssue());
    if (url.pathname.endsWith("/summary")) return response(developmentSummary({ pullRequests: 3, open: 1, providers: { stash: { count: 1 } } }));
    return response({ errors: [], detail: [{ pullRequests: ["OPEN", "MERGED", "DECLINED"].map((status, index) => ({ id: String(index + 1), title: `${status} request`, status, url: `https://git.example.test/repo/pull-requests/${index + 1}` })) }] });
  } });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.issue.pullRequests, item => item.status).sort(), ["DECLINED", "MERGED", "OPEN"]);
  assert.equal(result.issue.warnings, undefined);
});

test("a denied development provider preserves other provider data and issue content with a warning", async () => {
  const page = browser({ fetch: rawURL => {
    const url = new URL(rawURL);
    if (url.pathname.includes("/rest/api/")) return response(developmentIssue());
    if (url.pathname.endsWith("/summary")) return response(developmentSummary({ commits: 2, repositories: { stash: { count: 1 }, GitHub: { count: 1 } } }));
    if (url.searchParams.get("applicationType") === "GitHub") return response({}, 403);
    return response({ errors: [], detail: [{ repositories: [{ name: "repo", commits: [{ id: "abc", message: "Available commit", url: "https://git.example.test/repo/commits/abc" }] }] }] });
  } });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(result.issue.title, "Export development activity");
  assert.equal(result.issue.description.adf.content[0].content[0].text, "Keep the issue description");
  assert.equal(result.issue.comments[0].id, "1");
  assert.equal(result.issue.commits.length, 1);
  assert.match(result.issue.warnings.join(" "), /403/);
});

test("missing development services are skipped after supported version fallbacks", async () => {
  const page = browser({ fetch: rawURL => new URL(rawURL).pathname.includes("/rest/api/") ? response(developmentIssue()) : response({}, 404) });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(result.issue.commits.length, 0);
  assert.equal(result.issue.pullRequests.length, 0);
  assert.equal(result.issue.warnings, undefined);
  assert.deepEqual(page.requests.slice(1).map(item => new URL(item.url).pathname), ["/rest/dev-status/1.0/issue/summary", "/rest/dev-status/latest/issue/summary"]);
});

test("development permission failures are reported without losing the issue", async () => {
  const page = browser({ fetch: rawURL => new URL(rawURL).pathname.includes("/rest/api/") ? response(developmentIssue()) : response({}, 403) });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(result.issue.title, "Export development activity");
  assert.match(result.issue.warnings.join(" "), /403/);
  assert.equal(page.requests.length, 2);
});

test("development version fallback retains Jira context paths and authenticated same-origin GET requests", async () => {
  const page = browser({ href: "https://jira.example.test/company/browse/TEAM-42", fetch: rawURL => {
    const url = new URL(rawURL);
    if (url.pathname.includes("/rest/api/")) return response(developmentIssue());
    if (url.pathname.includes("/dev-status/1.0/")) return response({}, 404);
    if (url.pathname.endsWith("/summary")) return response(developmentSummary({ commits: 1, repositories: { stash: { count: 1 } } }));
    return response({ errors: [], detail: [{ repositories: [{ name: "repo", commits: [{ id: "abc", message: "Context path commit", url: "https://git.example.test/repo/commits/abc" }] }] }] });
  } });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(result.issue.commits[0].message, "Context path commit");
  assert.equal(result.issue.warnings, undefined);
  assert.ok(page.requests.some(item => new URL(item.url).pathname === "/company/rest/dev-status/latest/issue/detail"));
  for (const { url: rawURL, options } of page.requests) {
    const url = new URL(rawURL);
    assert.equal(url.origin, "https://jira.example.test");
    assert.ok(url.pathname.startsWith("/company/rest/"));
    assert.equal(options.credentials, "include");
    assert.equal(options.method || "GET", "GET");
    assert.equal(options.redirect, "error");
  }
});

test("malformed development details warn about incomplete exports", async () => {
  const page = browser({ fetch: rawURL => {
    const url = new URL(rawURL);
    if (url.pathname.includes("/rest/api/")) return response(developmentIssue());
    if (url.pathname.endsWith("/summary")) return response(developmentSummary({ commits: 2, repositories: { stash: { count: 2 } } }));
    return response({ detail: { repositories: [] } });
  } });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(result.issue.commits.length, 0);
  assert.ok(result.issue.warnings.length > 0);
  assert.match(result.issue.warnings.join(" "), /invalid|incomplete/i);
});

test("development count mismatches report the exported and expected item counts", async () => {
  const page = browser({ fetch: rawURL => {
    const url = new URL(rawURL);
    if (url.pathname.includes("/rest/api/")) return response(developmentIssue());
    if (url.pathname.endsWith("/summary")) return response(developmentSummary({ pullRequests: 3, open: 1, providers: { stash: { count: 1 } } }));
    return response({ errors: [], detail: [{ pullRequests: [{ id: "1", title: "Only one returned", status: "OPEN", url: "https://git.example.test/repo/pull-requests/1" }] }] });
  } });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(result.issue.pullRequests.length, 1);
  assert.match(result.issue.warnings.join(" "), /1 of 3/);
});

test("only a numeric issue ID enables development API requests", async () => {
  const page = browser({ fetch: () => response(developmentIssue({ id: "//untrusted.example/42" })) });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(page.requests.length, 1);
  assert.equal(result.issue.commits.length, 0);
  assert.equal(result.issue.pullRequests.length, 0);
});

function developmentDocument(key, summary) {
  const heading = node("Visible development issue");
  const panel = node("", { "data-issue-id": "10142", "data-issue-key": key });
  const cached = node("", { "data-json": JSON.stringify({ cachedValue: summary }) });
  panel.querySelector = selector => selector.includes("dev-summary") ? cached : null;
  return {
    querySelectorAll: selector => selector.startsWith("#summary-val") ? [heading] : [],
    querySelector: selector => selector.includes("devstatus-container") ? panel : null,
  };
}

test("a matching development panel supplies the numeric issue ID during visible-page fallback", async () => {
  const page = browser({ document: developmentDocument("TEAM-42"), fetch: rawURL => {
    const url = new URL(rawURL);
    if (url.pathname.includes("/rest/api/")) return response({}, 403);
    assert.equal(url.searchParams.get("issueId"), "10142");
    if (url.pathname.endsWith("/summary")) return response(developmentSummary({ commits: 1, repositories: { stash: { count: 1 } } }));
    return response({ detail: [{ repositories: [{ name: "repo", commits: [{ id: "abc", message: "Fallback development", url: "https://git.example.test/repo/commits/abc" }] }] }] });
  } });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(result.issue.title, "Visible development issue");
  assert.equal(result.issue.commits[0].message, "Fallback development");
  assert.match(result.issue.warnings.join(" "), /visible page content/);
  assert.equal(page.requests.length, 3);
});

test("a stale development panel cannot supply another issue's ID or cached summary", async () => {
  const page = browser({ document: developmentDocument("OTHER-1", developmentSummary({ commits: 1, repositories: { stash: { count: 1 } } })), fetch: () => response(developmentIssue({ id: undefined })) });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(page.requests.length, 1);
  assert.equal(result.issue.commits.length, 0);
  assert.equal(result.issue.warnings, undefined);
});

test("the matching panel's cached summary can recover development details when summary routes are unavailable", async () => {
  const cached = developmentSummary({ pullRequests: 1, providers: { stash: { count: 1 } } });
  const page = browser({ document: developmentDocument("TEAM-42", cached), fetch: rawURL => {
    const url = new URL(rawURL);
    if (url.pathname.includes("/rest/api/")) return response(developmentIssue());
    if (url.pathname.endsWith("/summary")) return response({}, 404);
    return response({ detail: [{ pullRequests: [{ id: "1", title: "Recovered request", status: "MERGED", url: "https://git.example.test/repo/pull-requests/1" }] }] });
  } });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(result.issue.pullRequests[0].title, "Recovered request");
  assert.match(result.issue.warnings.join(" "), /summary.*404/i);
});
