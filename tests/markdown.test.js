import test from "node:test";
import assert from "node:assert/strict";
import { adfToMarkdown, renderIssue } from "../src/markdown.js";

const text = (value, marks) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content) => ({ type: "paragraph", content });
const doc = (...content) => ({ type: "doc", version: 1, content });
const item = (...content) => ({ type: "listItem", content });
const baseUrl = "https://example.atlassian.net/browse/DEMO-12?view=detail";

test("renders ADF headings, marks, readable inline nodes and a hard break", () => {
  const result = adfToMarkdown(doc(
    { type: "heading", attrs: { level: 2 }, content: [text("A [heading]")] },
    paragraph(text("Bold", [{ type: "strong" }]), text(" and "), text("emphasis", [{ type: "em" }]), { type: "hardBreak" },
      { type: "mention", attrs: { text: "@Person" } }, text(" "), { type: "emoji", attrs: { text: "😀" } }, text(" "),
      { type: "status", attrs: { text: "In progress" } }),
    { type: "rule" },
  ));
  assert.equal(result, "## A \\[heading\\]\n\n**Bold** and *emphasis*  \n@Person 😀 **In progress**\n\n---");
});

test("escapes literal syntax, HTML and accidental list markers", () => {
  const result = adfToMarkdown(doc(paragraph(text("# title\n- item\n1. item\n[x] *raw* <script> &copy;"))));
  assert.equal(result, "\\# title\n\\- item\n1\\. item\n\\[x\\] \\*raw\\* \\<script\\> &amp;copy;");
});

test("literal underline-like lines do not become headings or horizontal rules", () => {
  const result = adfToMarkdown(doc(paragraph(text("Title\n===\n---\n+"))));
  assert.equal(result, "Title\n\\===\n\\---\n\\+");
});

test("formats edge whitespace outside emphasis and combines a link with inline code", () => {
  const result = adfToMarkdown(doc(paragraph(
    text(" bold ", [{ type: "strong" }]),
    text("`cmd`", [{ type: "code" }, { type: "link", attrs: { href: "../help?q=one&next=two#details" } }]),
  )), { baseUrl });
  assert.equal(result, "**bold** [`` `cmd` ``](https://example.atlassian.net/help?q=one&next=two#details)");
});

test("relative URLs resolve against the source and queries survive Markdown delimiters", () => {
  const result = adfToMarkdown(doc(paragraph(text("download", [{ type: "link", attrs: {
    href: "/secure/attachment/42/figure (final).png?download=1&token=a%2Bb#preview",
  } }]))), { baseUrl });
  assert.equal(result, "[download](https://example.atlassian.net/secure/attachment/42/figure%20%28final%29.png?download=1&token=a%2Bb#preview)");
});

test("unsafe URL schemes retain their label without active links", () => {
  const result = adfToMarkdown(doc(paragraph(text("click", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))), { baseUrl });
  assert.equal(result, "click");
});

test("nested lists preserve ordered starts and align continuation paragraphs", () => {
  const result = adfToMarkdown(doc({ type: "orderedList", attrs: { order: 9 }, content: [
    item(paragraph(text("First")), { type: "bulletList", content: [
      item(paragraph(text("Nested")), { type: "orderedList", attrs: { order: 3 }, content: [item(paragraph(text("Deep")))] }),
    ] }),
    item(paragraph(text("Second")), paragraph(text("Continuation"))),
  ] }));
  assert.equal(result, "9. First\n   - Nested\n     3. Deep\n10. Second\n\n    Continuation");
});

test("code fences exceed embedded backticks and preserve source indentation", () => {
  const source = "  const sample = `x`;\n```\n\n  end";
  const result = adfToMarkdown(doc({ type: "codeBlock", attrs: { language: "javascript" }, content: [text(source)] }));
  assert.equal(result, `\`\`\`\`javascript\n${source}\n\`\`\`\``);
});

test("tables escape pipes, retain multiline cells, and keep a real header", () => {
  const cell = (type, ...content) => ({ type, content });
  const result = adfToMarkdown(doc({ type: "table", content: [
    { type: "tableRow", content: [cell("tableHeader", paragraph(text("Name"))), cell("tableHeader", paragraph(text("Notes")))] },
    { type: "tableRow", content: [cell("tableCell", paragraph(text("A|B"))), cell("tableCell", paragraph(text("first")), paragraph(text("second")))] },
  ] }));
  assert.equal(result, "| Name | Notes |\n| --- | --- |\n| A\\|B | first<br>second |");
});

test("headerless tables keep the first row as data and pad merged cells", () => {
  const result = adfToMarkdown(doc({ type: "table", content: [
    { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 2 }, content: [paragraph(text("Wide"))] }] },
    { type: "tableRow", content: ["Left", "Right"].map((value) => ({ type: "tableCell", content: [paragraph(text(value))] })) },
  ] }));
  assert.equal(result, "|  |  |\n| --- | --- |\n| Wide |  |\n| Left | Right |");
});

test("blockquotes and unknown containers preserve readable descendant content", () => {
  const result = adfToMarkdown(doc({ type: "blockquote", content: [paragraph(text("First")), paragraph(text("Second"))] },
    { type: "futureContainer", content: [paragraph(text("Retained"))] }));
  assert.equal(result, "> First\n>\n> Second\n\nRetained");
});

test("matching ADF media embeds an image and retains signed attachment query strings", () => {
  const result = adfToMarkdown(doc({ type: "mediaSingle", content: [{ type: "media", attrs: { id: "media-42" } }] }), {
    baseUrl, attachments: [{ id: "42", mediaId: "media-42", name: "screen.png", mimeType: "image/png", url: "/attachment/42?token=secret&expires=123" }],
  });
  assert.equal(result, "![screen.png](https://example.atlassian.net/attachment/42?token=secret&expires=123)");
});

test("missing and ambiguous media produce source links rather than broken images", () => {
  const mediaDoc = doc({ type: "mediaSingle", content: [{ type: "media", attrs: { id: "unmapped", alt: "screen.png" } }] });
  const result = adfToMarkdown(mediaDoc, { baseUrl, attachments: [
    { id: "1", name: "screen.png", url: "/first" }, { id: "2", name: "screen.png", url: "/second" },
  ] });
  assert.equal(result, `[screen.png — view in Jira](${baseUrl})`);
  assert.ok(!result.includes("!["));
  assert.equal(adfToMarkdown(mediaDoc), "screen.png (media unavailable)");
});

test("direct media links resolve relative URLs and reject unsafe schemes", () => {
  const media = (url) => doc({ type: "media", attrs: { alt: "Download", url } });
  assert.equal(adfToMarkdown(media("/file (1)?a=1&b=2"), { baseUrl }), "[Download](https://example.atlassian.net/file%20%281%29?a=1&b=2)");
  assert.equal(adfToMarkdown(media("javascript:alert(1)"), { baseUrl }), `[Download — view in Jira](${baseUrl})`);
  assert.equal(adfToMarkdown(media("javascript:alert(1)")), "Download (media unavailable)");
});

const issue = {
  key: "DEMO-12", title: "Markdown export", url: baseUrl,
  fields: [{ name: "Status", value: "In progress" }, { name: "Project", value: "Demo project" }],
  description: { adf: doc(paragraph(text("ADF description"))), html: "<p>HTML fallback</p>", text: "Text fallback" },
  customFields: [{ name: "Team", value: ["One", "Two"] }],
  sections: [{ name: "Related issues", body: { text: "DEMO-11" } }],
  comments: [{ id: "1", author: "Test Person", created: "2026-11-05T10:00:00Z", body: { text: "A comment" } }],
  attachments: [{ id: "1", name: "spec.pdf", url: "/attachment/1?download=true", size: 1024 }],
  commits: [{ id: "abc123456789", displayId: "abc1234", message: "Export development details\n\nKeep the full commit message.", url: "https://git.example.test/team/repo/commits/abc123456789", author: "Alex", date: "2026-11-05T09:00:00Z", repository: "team/repo" }],
  pullRequests: [{ id: "42", title: "Add development export", url: "https://git.example.test/team/repo/pull-requests/42", status: "MERGED", author: "Alex", repository: "team/repo", sourceBranch: "feature/export", destinationBranch: "main" }],
};

test("issue defaults link the heading and include ordinary sections while omitting opt-in custom fields", () => {
  const result = renderIssue(issue);
  for (const expected of [`# [DEMO-12](${baseUrl}) — Markdown export`, "**In progress**", "## Details", "| Project | Demo project |", "## Description", "ADF description", "## Related issues", "## Attachments", "## Commits", "## Pull requests", "## Comments", "A comment"]) {
    assert.ok(result.includes(expected), `Missing: ${expected}`);
  }
  assert.ok(!result.includes("Source:"), "The linked key already identifies the source");
  assert.ok(!result.includes("| Status | In progress |"), "Summary fields should not be repeated");
  assert.ok(!result.includes("Additional fields"));
  assert.ok(!result.includes("HTML fallback"));
  assert.ok(!result.includes("Text fallback"));
  assert.ok(result.endsWith("\n"));
});

test("options independently disable sections while keeping the linked title", () => {
  const result = renderIssue(issue, { description: false, comments: false, metadata: false, attachments: false, sections: false, commits: false, pullRequests: false, fields: true });
  assert.ok(result.startsWith(`# [DEMO-12](${baseUrl}) — Markdown export\n\n`));
  assert.ok(!result.includes("**In progress**"));
  assert.ok(result.includes("## Additional fields\n\n| Field | Value |\n| --- | --- |\n| Team | One, Two |"));
  for (const omitted of ["## Details", "## Description", "## Comments", "## Attachments", "## Related issues", "## Commits", "## Pull requests"]) assert.ok(!result.includes(omitted));
});

test("development sections retain links, metadata, full commit messages and PR branches", () => {
  const result = renderIssue(issue, { sections: false });
  assert.ok(result.includes("| Commit | Subject | Date (UTC) | Repositories |"));
  assert.ok(result.includes("| `abc1234` | Export development details | 5 Nov 2026, 09:00:00 UTC | [team/repo](https://git.example.test/team/repo/commits/abc123456789) |"));
  assert.ok(result.includes("**Author:** Alex"));
  assert.ok(result.includes("<summary>Full commit messages (1)</summary>\n\n### abc1234\n\n```text\nExport development details\n\nKeep the full commit message.\n```"));
  assert.ok(result.includes("| PR | Title | Status | Repository |"));
  assert.ok(result.includes("| [\\#42](https://git.example.test/team/repo/pull-requests/42) | Add development export | Merged | [team/repo](https://git.example.test/team/repo) |"));
  assert.ok(result.includes("**Branches:** `feature/export` → `main`"));
  assert.ok(result.indexOf("## Pull requests") < result.indexOf("## Commits"));
  assert.ok(!result.includes("## Related issues"));
});

test("commits and pull requests can each be disabled independently", () => {
  const noCommits = renderIssue(issue, { commits: false });
  assert.ok(!noCommits.includes("## Commits"));
  assert.ok(noCommits.includes("## Pull requests"));
  const noRequests = renderIssue(issue, { pullRequests: false });
  assert.ok(noRequests.includes("## Commits"));
  assert.ok(!noRequests.includes("## Pull requests"));
});

test("development data escapes literal Markdown and rejects unsafe links", () => {
  const result = renderIssue({ url: baseUrl,
    commits: [{ id: "abc", message: "# Heading\n\n*Literal* [message]\n- details", url: "/commit/abc (1)?a=1&b=2", author: "[Alex]", repository: "*repo*" }],
    pullRequests: [{ id: "#7", title: "Fix [export]\nwithout a new heading", url: "javascript:alert(1)", sourceBranch: "feature/*", destinationBranch: "<main>" }],
  });
  assert.ok(result.includes("[\\*repo\\*](https://example.atlassian.net/commit/abc%20%281%29?a=1&b=2)"));
  assert.ok(result.includes("**Author:** \\[Alex\\]"));
  assert.ok(result.includes("| `abc` | \\# Heading |"));
  assert.ok(result.includes("```text\n# Heading\n\n*Literal* [message]\n- details\n```"));
  assert.ok(result.includes("| \\#7 | Fix \\[export\\] without a new heading |"));
  assert.ok(result.includes("**Branches:** `feature/*` → `<main>`"));
  assert.ok(!result.includes("javascript:"));
});

test("empty rich text falls back to text and absent normalized arrays are safe", () => {
  const result = renderIssue({ key: "DEMO-1", url: baseUrl, description: { adf: doc(), text: "Fallback" } });
  assert.ok(result.includes("## Description\n\nFallback"));
  assert.ok(!result.includes("undefined"));
  assert.ok(!result.includes("## Commits"));
  assert.ok(!result.includes("## Pull requests"));
  assert.equal(adfToMarkdown(null), "");
  assert.equal(adfToMarkdown({}), "");
});

test("compact metadata combines summary fields and matching reporter and creator without mutating the issue", () => {
  const fields = [
    { name: "Type", value: "Change request" }, { name: "Status", value: "Closed" },
    { name: "Priority", value: "Minor" }, { name: "Resolution", value: "Done" },
    { name: "Reporter", value: "Studerus, Gina" }, { name: "Creator", value: "Studerus, Gina" },
    { name: "Assignee", value: "Lorena Rodriguez" },
  ];
  const result = renderIssue({ key: "DEMO-12", title: "Summary", url: baseUrl, fields });
  assert.ok(result.includes("**Closed · Done · Change request · Minor**"));
  assert.ok(result.includes("| Reporter / Creator | Studerus, Gina |"));
  assert.ok(result.includes("| Assignee | Lorena Rodriguez |"));
  assert.ok(!result.includes("| Status |"));
  assert.ok(!result.includes("| Creator |"));
  assert.equal(fields[4].name, "Reporter");
  const different = renderIssue({ fields: [{ name: "Reporter", value: "Gina" }, { name: "Creator", value: "Lorena" }] });
  assert.ok(different.includes("| Reporter | Gina |"));
  assert.ok(different.includes("| Creator | Lorena |"));
});

test("dates stay readable with explicit source offsets and uncertain dates retain their meaning", () => {
  const result = renderIssue({ fields: [
    { name: "Created", value: "2026-06-25T15:55:04.360+0200" },
    { name: "Updated", value: "2026-11-04T08:51:48.262+0100" },
    { name: "Due date", value: "2026-11-30" },
    { name: "Invalid date", value: "2026-02-30T10:00:00Z" },
    { name: "Unknown zone", value: "2026-11-04T08:51:48" },
  ], comments: [{ author: "Michi", created: "2026-10-22T10:00:24.530+0200", body: "A comment" }],
  sections: [{ name: "[CHART] Date of First Response", field: true, body: { text: "22/Oct/26 10:00 AM" } }],
  });
  assert.ok(result.includes("| Created | 25 Jun 2026, 15:55 UTC+02:00 |"));
  assert.ok(result.includes("| Updated | 4 Nov 2026, 08:51 UTC+01:00 |"));
  assert.ok(result.includes("| Due date | 30 Nov 2026 |"));
  assert.ok(result.includes("| Invalid date | 2026-02-30T10:00:00Z |"));
  assert.ok(result.includes("| Unknown zone | 2026-11-04T08:51:48 |"));
  assert.ok(result.includes("22 Oct 2026, 10:00 AM — time zone unspecified"));
  assert.ok(result.includes("### Michi — 22 Oct 2026, 10:00 UTC+02:00"));
});

test("issue references become linked keys in metadata and relation lists", () => {
  const result = renderIssue({ key: "DEMO-12", url: baseUrl,
    fields: [{ name: "Parent", value: { key: "DEMO-1", title: "Parent | issue", url: "/browse/DEMO-1" } }],
    sections: [{ name: "Linked issues", items: [
      { key: "DEMO-2", title: "Dependency", relation: "blocks", url: "/browse/DEMO-2" },
      { key: "DEMO-3", title: "Related work", relation: "follows", url: "/browse/DEMO-3" },
    ] }],
  });
  assert.ok(result.includes("| Parent | [DEMO-1](https://example.atlassian.net/browse/DEMO-1) — Parent \\| issue |"));
  assert.ok(result.includes("- **blocks:** [DEMO-2](https://example.atlassian.net/browse/DEMO-2) — Dependency\n- **follows:** [DEMO-3](https://example.atlassian.net/browse/DEMO-3) — Related work"));
});

test("bare Jira issue URLs use short labels while custom labels and external URLs survive", () => {
  const local = "https://example.atlassian.net/browse/DEMO-2#icft=DEMO-2";
  const external = "https://external.atlassian.net/browse/DEMO-3";
  const result = adfToMarkdown(doc(paragraph(
    text(local, [{ type: "link", attrs: { href: local } }]), text(" "),
    text("Important dependency", [{ type: "link", attrs: { href: local } }]), text(" "),
    { type: "inlineCard", attrs: { url: "/browse/DEMO-4" } }, text(" "),
    text(external, [{ type: "link", attrs: { href: external } }]),
  )), { baseUrl });
  assert.ok(result.includes(`[DEMO-2](${local})`));
  assert.ok(result.includes(`[Important dependency](${local})`));
  assert.ok(result.includes("[DEMO-4](https://example.atlassian.net/browse/DEMO-4)"));
  assert.ok(result.includes(`[${external}](${external})`));
});

test("only scalar custom-field sections join Additional fields and section options remain independent", () => {
  const source = { customFields: [{ name: "Team", value: "Exporters" }], sections: [
    { name: "Estimate", field: true, body: { text: "10" } },
    { name: "Single paragraph", field: true, body: { adf: doc(paragraph(text("A scalar field"))) } },
    { name: "Environment", body: { text: "Production" } },
    { name: "Long custom text", field: true, body: { adf: doc(paragraph(text("First paragraph")), paragraph(text("Second paragraph"))) } },
    { name: "Definition of Done", field: true, body: { adf: doc({ type: "taskList", content: [
      { type: "taskItem", attrs: { state: "TODO" }, content: [text("Tests complete")] },
    ] }) } },
  ] };
  const result = renderIssue(source);
  assert.ok(result.includes("## Additional fields"));
  assert.ok(result.includes("| Estimate | 10 |"));
  assert.ok(result.includes("| Single paragraph | A scalar field |"));
  assert.ok(result.includes("## Environment\n\nProduction"));
  assert.ok(result.includes("## Long custom text\n\nFirst paragraph\n\nSecond paragraph"));
  assert.ok(result.includes("## Definition of Done\n\n- [ ] Tests complete"));
  assert.ok(!result.includes("| Team |"));
  assert.ok(!result.includes("## Estimate"));
  assert.ok(!result.includes("## Single paragraph"));
  const withoutSections = renderIssue(source, { sections: false, fields: true });
  assert.ok(withoutSections.includes("| Team | Exporters |"));
  for (const omitted of ["Estimate", "Single paragraph", "Environment", "Tests complete"]) assert.ok(!withoutSections.includes(omitted));
  const withoutFields = renderIssue(source, { sections: true, fields: false });
  assert.ok(withoutFields.includes("| Estimate | 10 |"));
  assert.ok(!withoutFields.includes("| Team |"));
});

test("single-item lists, headings and struck text retain their custom-field structure", () => {
  const result = renderIssue({ sections: [
    { name: "Bullet requirement", field: true, body: { adf: doc({
      type: "bulletList", content: [item(paragraph(text("One requirement")))],
    }) } },
    { name: "Ordered requirement", field: true, body: { adf: doc({
      type: "orderedList", content: [item(paragraph(text("First requirement")))],
    }) } },
    { name: "Source heading", field: true, body: { adf: doc({
      type: "heading", attrs: { level: 1 }, content: [text("Important source heading")],
    }) } },
    { name: "Removed requirement", field: true, body: { adf: doc(paragraph(
      text("Removed rule", [{ type: "strike" }]),
    )) } },
  ] });
  assert.ok(result.includes("## Bullet requirement\n\n- One requirement"));
  assert.ok(result.includes("## Ordered requirement\n\n1. First requirement"));
  assert.ok(result.includes("## Source heading\n\n### Important source heading"));
  assert.ok(result.includes("## Removed requirement\n\n~~Removed rule~~"));
  assert.ok(!result.includes("## Additional fields"));
});

test("acceptance criteria become labelled bullets with wording, emphasis and multiline content intact", () => {
  const row = (label, ...values) => ({ type: "tableRow", content: [
    { type: "tableCell", content: [paragraph(text(label))] },
    { type: "tableCell", content: values.map(value => paragraph(typeof value === "string" ? text(value) : value)) },
  ] });
  const result = renderIssue({ description: { adf: doc(
    { type: "heading", attrs: { level: 2 }, content: [text("Akzeptanzkriterien")] },
    paragraph(text("AK1: Anzeige Vertragsbeginn", [{ type: "strong" }])),
    { type: "table", content: [row("", ""), row("Gegeben", "ein Bestandskunde mit aktivem Vertrag,"),
      row("Wenn", "das Modal geöffnet wird,"), row("Dann", text("nicht editierbar", [{ type: "strong" }])),
      row("Und", "Datum aus Vertragsportfolio", "nicht aus CRM")] },
  ) } });
  assert.ok(result.includes("## Description\n\n### Akzeptanzkriterien\n\n#### AK1: Anzeige Vertragsbeginn"));
  assert.ok(result.includes("- **Gegeben:** ein Bestandskunde mit aktivem Vertrag,\n- **Wenn:** das Modal geöffnet wird,\n- **Dann:** **nicht editierbar**\n- **Und:** Datum aus Vertragsportfolio\n\n  nicht aus CRM"));
  assert.ok(!result.includes("| --- |"));
});

test("ordinary headerless and real-header tables retain their original structure", () => {
  const rows = ["Given", "When", "Other"].map((label) => ({ type: "tableRow", content: [label, "Value"].map(value => ({ type: "tableCell", content: [paragraph(text(value))] })) }));
  const ordinary = adfToMarkdown(doc({ type: "table", content: rows }));
  assert.ok(ordinary.startsWith("|  |  |\n| --- | --- |"));
  assert.ok(ordinary.includes("| Other | Value |"));
  rows[2].content[0].content[0].content[0].text = "Then";
  rows[0].content[0].type = "tableHeader";
  const withHeader = adfToMarkdown(doc({ type: "table", content: rows }));
  assert.ok(withHeader.startsWith("| Given | Value |\n| --- | --- |"));
  assert.ok(withHeader.includes("| Then | Value |"));
});

test("embedded heading levels stay beneath export sections without changing standalone conversion", () => {
  const content = doc(
    { type: "heading", attrs: { level: 1 }, content: [text("Top source heading")] },
    { type: "heading", attrs: { level: 2 }, content: [text("Nested source heading")] },
    paragraph(text("AC2: Follow-up criterion")),
    paragraph(text(" "), { type: "hardBreak" }, text(" ")),
  );
  const embedded = renderIssue({ description: { adf: content } });
  assert.ok(embedded.includes("## Description\n\n### Top source heading\n\n#### Nested source heading\n\n#### AC2: Follow-up criterion"));
  assert.ok(!embedded.includes("\n# Top source heading"));
  const standalone = adfToMarkdown(content);
  assert.ok(standalone.startsWith("# Top source heading\n\n## Nested source heading"));
  assert.ok(standalone.includes("\n\nAC2: Follow-up criterion"));
});

test("attachment sizes are readable while exact bytes and URLs remain available", () => {
  const result = renderIssue({ attachments: [
    { name: "image.png", size: 38180, url: "/attachment/1?token=a%2Bb" },
    { name: "tiny.txt", size: 42, url: "/attachment/2" },
    { name: "unknown.txt", size: -1, url: "/attachment/3" },
  ], url: baseUrl });
  assert.ok(result.includes("[image.png](https://example.atlassian.net/attachment/1?token=a%2Bb) — 38.2 kB (38,180 bytes)"));
  assert.ok(result.includes("[tiny.txt](https://example.atlassian.net/attachment/2) — 42 bytes"));
  assert.ok(!result.includes("-1 bytes"));
});
