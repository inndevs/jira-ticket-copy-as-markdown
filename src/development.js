import { array, string, blocks, oneLine, resolveUrl, link, codeSpan, codeBlock, table, formatDate } from "./format.js";

const fullHash = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;
const unique = (values) => [...new Set(values.filter(Boolean))];
const markdownTable = (headers, rows) => table([
  headers.map((text) => ({ text, header: true })),
  ...rows.map((row) => row.map((text) => ({ text }))),
]);
const disclosure = (label, body) => body ? `<details>\n<summary>${label}</summary>\n\n${body}\n\n</details>` : "";

function identity(item, context, index, hashes = false) {
  const id = string(item.id).trim();
  if (hashes && fullHash.test(id)) return `hash:${id.toLowerCase()}`;
  const repository = string(item.repository);
  const url = resolveUrl(item.url, context.baseUrl);
  return url ? `${repository}\n${url}` : id ? `${repository}\n${id}` : `entry:${index}`;
}

function grouped(items, context, hashes = false) {
  const groups = new Map();
  array(items).filter((item) => item && typeof item === "object").forEach((item, index) => {
    const key = identity(item, context, index, hashes);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.values()];
}

function commitLabel(commit) {
  return string(commit.displayId || (fullHash.test(string(commit.id)) ? commit.id.slice(0, 11) : commit.id) || "Commit");
}

function commitMessages(group) {
  return unique(group.map((commit) => string(commit.message).replace(/\r\n?/g, "\n")));
}

function repositoryReferences(group, context) {
  return unique(group.map((item) => link(oneLine(item.repository || "Repository"), item.url, context))).join(" · ");
}

function newest(group) {
  return Math.max(...group.map((commit) => Date.parse(commit.date)).filter(Number.isFinite), -Infinity);
}

export function countCommits(commits, context = {}) {
  return grouped(commits, context, true).length;
}

export function renderCommits(commits, context = {}) {
  const groups = grouped(commits, context, true).sort((a, b) => newest(b) - newest(a));
  if (!groups.length) return "";
  const rows = groups.map((group) => {
    const commit = group[0];
    const messages = commitMessages(group);
    const subject = messages[0]?.split("\n").find((line) => line.trim()) || "(No message)";
    const dates = unique(group.map((item) => formatDate(item.date, { utc: true, seconds: true })));
    // A shortened ID is useful only when its full hash survives in a link.
    const id = string(commit.id);
    const label = fullHash.test(id) && !group.some((item) => resolveUrl(item.url, context.baseUrl).toLowerCase().includes(id.toLowerCase())) ? id : commitLabel(commit);
    return [codeSpan(label), oneLine(subject), dates.map(oneLine).join("<br>"), repositoryReferences(group, context)];
  });
  const authors = unique(groups.flatMap((group) => group.map((commit) => string(commit.author))));
  const attribution = !authors.length ? "" : authors.length === 1 ? `**Author:** ${oneLine(authors[0])}` : disclosure("Commit authors", markdownTable(
    ["Commit", "Author"], groups.map((group) => [codeSpan(commitLabel(group[0])), unique(group.map((commit) => oneLine(commit.author))).join(" · ")]),
  ));
  const fullMessages = groups.flatMap((group) => {
    const messages = commitMessages(group);
    return messages.filter((message) => message.includes("\n") || messages.length > 1)
      .map((message) => blocks([`### ${oneLine(commitLabel(group[0]))}`, codeBlock(message, "text")]));
  });
  const summary = array(commits).length > groups.length ?
    `${groups.length} unique commit${groups.length === 1 ? "" : "s"}; repeated hashes are combined with all repository links retained.` : "";
  return blocks([
    summary,
    markdownTable(["Commit", "Subject", "Date (UTC)", "Repositories"], rows),
    attribution,
    disclosure(`Full commit messages (${fullMessages.length})`, fullMessages.join("\n\n")),
  ]);
}

function shortTitle(value) {
  const title = string(value);
  return title.replace(/^(?:[A-Z][A-Z\d_]*-\d+[\s,]*)+:\s*/, "") || title;
}

function requestLink(request, context) {
  const label = request.id ? `#${string(request.id).replace(/^#/, "")}` : "Pull request";
  return link(oneLine(label), request.url, context);
}

function repositoryUrl(request, context) {
  if (request.repositoryUrl) return request.repositoryUrl;
  const url = resolveUrl(request.url, context.baseUrl);
  if (!url) return "";
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/(?:pull-requests|pull)\/\d+\/?$|\/-\/merge_requests\/\d+\/?$/, "");
  return path !== parsed.pathname ? `${parsed.origin}${path}` : "";
}

function status(value) {
  return new Map([["MERGED", "Merged"], ["OPEN", "Open"], ["DECLINED", "Declined"], ["CLOSED", "Closed"]]).get(value) || string(value);
}

export function renderPullRequests(requests, context = {}) {
  const groups = grouped(requests, context);
  if (!groups.length) return "";
  const rows = groups.map(([request]) => [
    requestLink(request, context), oneLine(shortTitle(request.title)), oneLine(status(request.status)),
    request.repository ? link(oneLine(request.repository), repositoryUrl(request, context), context) : "",
  ]);
  const details = groups.flatMap((group) => group.map((request) => {
    const branches = [request.sourceBranch, request.destinationBranch].filter(Boolean).map(codeSpan).join(" → ");
    const original = shortTitle(request.title) !== string(request.title) || unique(group.map((item) => item.title)).length > 1 ?
      `**Original title:** ${oneLine(request.title)}` : "";
    const originalStatus = unique(group.map((item) => item.status)).length > 1 ? `**Status:** ${oneLine(status(request.status))}` : "";
    const body = blocks([request.author ? `**Author:** ${oneLine(request.author)}` : "", original, originalStatus, branches ? `**Branches:** ${branches}` : ""]);
    return body ? blocks([`### ${requestLink(request, context)}`, body]) : "";
  })).filter(Boolean);
  return blocks([
    markdownTable(["PR", "Title", "Status", "Repository"], rows),
    disclosure("Authors, branches and original titles", unique(details).join("\n\n")),
  ]);
}
