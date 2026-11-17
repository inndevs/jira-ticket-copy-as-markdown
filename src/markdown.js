import { array, string, blocks, escapeText, oneLine, resolveUrl, link, wrap, codeSpan, codeBlock, table, formatDate } from "./format.js";
import { renderCommits, renderPullRequests } from "./development.js";

const DEFAULT_OPTIONS = {
  description: true, comments: true, metadata: true,
  attachments: true, fields: false, sections: true,
  commits: true, pullRequests: true,
};

function applyMarks(value, marks, context, rawText) {
  const supported = array(marks);
  let result = supported.some((mark) => mark.type === "code") ? codeSpan(rawText ?? value) : value;
  for (const type of ["strong", "em", "strike", "subsup", "underline", "link"]) {
    const mark = supported.find((candidate) => candidate.type === type);
    if (!mark) continue;
    if (type === "strong") result = wrap(result, "**");
    if (type === "em") result = wrap(result, "*");
    if (type === "strike") result = wrap(result, "~~");
    if (type === "underline") result = `<u>${result}</u>`;
    if (type === "subsup" && ["sub", "sup"].includes(mark.attrs?.type)) {
      result = `<${mark.attrs.type}>${result}</${mark.attrs.type}>`;
    }
    if (type === "link") result = link(result, mark.attrs?.href, context);
  }
  return result;
}

function quote(value) {
  return value.split("\n").map((line) => line ? `> ${line}` : ">").join("\n");
}

function listItem(value, marker) {
  const lines = value.trim().split("\n");
  return lines.map((line, index) => index === 0 ? `${marker}${line}` :
    line ? `${" ".repeat(marker.length)}${line}` : "").join("\n");
}

function contentTable(rows) {
  const data = rows.filter(row => row.some(cell => cell.text.trim()));
  const labels = data.map(row => row[0]?.text.replace(/\*\*/g, "").replace(/:\s*$/, "").trim());
  const criteria = data.length >= 3 && data.every(row => row.length === 2 && row.every(cell =>
    !cell.header && !(cell.colspan > 1) && !(cell.rowspan > 1))) &&
    /^(given|gegeben)$/i.test(labels[0]) && labels.some(label => /^(when|wenn)$/i.test(label)) &&
    labels.some(label => /^(then|dann)$/i.test(label)) &&
    labels.every(label => /^(given|when|then|and|but|gegeben|wenn|dann|und|aber)$/i.test(label));
  return criteria ? data.map((row, index) => listItem(`**${labels[index]}:** ${row[1].text.trim()}`, "- ")).join("\n") : table(rows);
}

function headingLevel(level, context) {
  return Math.min(6, Math.max(1, Number(level) || 1) + (context.headingOffset || 0));
}

function criterionHeading(value, context) {
  return context.sectionBody && /^(?:\*\*)?(?:AK|AC)\s*\d+\s*:/i.test(value) ?
    `#### ${value.replace(/\*\*/g, "")}` : value;
}

function media(node, context) {
  const attrs = node.attrs || {};
  const attachments = array(context.attachments);
  const id = string(attrs.id);
  let attachment = id ? attachments.find((item) =>
    string(item.mediaId) === id || string(item.id) === id) : undefined;
  if (!attachment && attrs.alt) {
    const matches = attachments.filter((item) => item.name === attrs.alt);
    if (matches.length === 1) attachment = matches[0];
  }
  const name = attachment?.name || attrs.alt || attrs.name || "Attachment";
  const attachmentUrl = resolveUrl(attachment?.url, context.baseUrl);
  if (attachmentUrl) {
    const image = /^image\//i.test(attachment.mimeType || "") ||
      /\.(?:png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(attachment.name || "");
    return `${image ? "!" : ""}[${oneLine(name)}](${attachmentUrl})`;
  }
  const directUrl = resolveUrl(attrs.url || attrs.src || array(node.marks).find((mark) => mark.type === "link")?.attrs?.href, context.baseUrl);
  if (directUrl) return `[${oneLine(name)}](${directUrl})`;
  const sourceUrl = resolveUrl(context.baseUrl);
  return sourceUrl ? `[${oneLine(name)} — view in Jira](${sourceUrl})` :
    `${oneLine(name)} (media unavailable)`;
}

function adfChildren(node, context, inline = false) {
  const children = array(node?.content).map((child) => adfNode(child, context));
  return inline ? children.join("") : blocks(children);
}

function adfNode(node, context) {
  if (!node || typeof node !== "object") return "";
  const attrs = node.attrs || {};
  switch (node.type) {
    case "text": return applyMarks(escapeText(node.text), node.marks, context, node.text);
    case "doc":
    case "listItem":
    case "mediaSingle":
    case "mediaGroup": return adfChildren(node, context);
    case "paragraph": return criterionHeading(adfChildren(node, context, true), context);
    case "heading": return `${"#".repeat(headingLevel(attrs.level, context))} ${adfChildren(node, context, true)}`;
    case "hardBreak": return "  \n";
    case "rule": return "---";
    case "codeBlock": return codeBlock(array(node.content).map((child) => child.text || "").join(""), attrs.language);
    case "blockquote":
    case "panel": return quote(adfChildren(node, context));
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const start = Number.isInteger(attrs.order) && attrs.order >= 0 ? attrs.order : 1;
      return array(node.content).map((item, index) => {
        let value = node.type === "taskList" ? adfChildren(item, context, true) : "";
        for (const child of node.type === "taskList" ? [] : array(item.content)) {
          const rendered = adfNode(child, context);
          if (!rendered) continue;
          value += (value ? /^(?:bullet|ordered|task)List$/.test(child.type) ? "\n" : "\n\n" : "") + rendered;
        }
        const marker = node.type === "orderedList" ? `${start + index}. ` : node.type === "taskList" ?
          `- [${item.attrs?.state === "DONE" ? "x" : " "}] ` : "- ";
        return listItem(value, marker);
      }).join("\n");
    }
    case "table": return contentTable(array(node.content).map((row) => array(row.content).map((cell) => ({
      text: adfChildren(cell, context), header: cell.type === "tableHeader",
      colspan: cell.attrs?.colspan, rowspan: cell.attrs?.rowspan,
    }))));
    case "mention": return escapeText(attrs.text || `@${attrs.id || "user"}`);
    case "emoji": return escapeText(attrs.text || attrs.shortName || ":emoji:");
    case "status": return wrap(escapeText(attrs.text || "Status"), "**");
    case "date": {
      const date = new Date(Number(attrs.timestamp));
      return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : escapeText(attrs.timestamp);
    }
    case "inlineCard":
    case "blockCard": return link(escapeText(attrs.text || attrs.url || "Link"), attrs.url, context);
    case "media":
    case "mediaInline": return media(node, context);
    case "expand":
    case "nestedExpand": return blocks([attrs.title ? wrap(oneLine(attrs.title), "**") : "", adfChildren(node, context)]);
    default: return array(node.content).length ? adfChildren(node, context, !array(node.content).some((child) =>
      ["paragraph", "heading", "bulletList", "orderedList", "codeBlock", "table"].includes(child.type))) :
      escapeText(node.text || attrs.text || "");
  }
}

export function adfToMarkdown(doc, { baseUrl = "", attachments = [], sectionBody = false } = {}) {
  const levels = [];
  const visit = node => {
    if (node?.type === "heading") levels.push(Math.max(1, Number(node.attrs?.level) || 1));
    array(node?.content).forEach(visit);
  };
  visit(doc);
  const headingOffset = sectionBody && levels.length ? Math.max(0, 3 - Math.min(...levels)) : 0;
  return adfNode(doc, { baseUrl, attachments, sectionBody, headingOffset }).trim();
}

const HTML_BLOCKS = new Set(["P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE", "NAV", "ADDRESS", "FIGURE", "FIGCAPTION", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "TABLE", "HR", "DL", "DT", "DD"]);
const HTML_IGNORE = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

function htmlChildren(node, context, inline = false) {
  if (inline) return Array.from(node.childNodes).map((child) => htmlNode(child, context)).join("");
  const result = [];
  let pending = "";
  const flush = () => { if (pending.trim()) result.push(pending.trim()); pending = ""; };
  for (const child of node.childNodes) {
    if (HTML_BLOCKS.has(child.nodeName)) {
      flush();
      result.push(htmlNode(child, context));
    } else pending += htmlNode(child, context);
  }
  flush();
  return blocks(result);
}

function htmlNode(node, context) {
  if (node.nodeType === 3) return escapeText(node.nodeValue.replace(/\s+/g, " "));
  if (node.nodeType !== 1 || HTML_IGNORE.has(node.nodeName) || node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") return "";
  const tag = node.nodeName;
  const inline = () => htmlChildren(node, context, true);
  if (/^H[1-6]$/.test(tag)) return `${"#".repeat(headingLevel(tag[1], context))} ${inline().trim()}`;
  switch (tag) {
    case "BR": return "  \n";
    case "HR": return "---";
    case "P": return criterionHeading(inline().trim(), context);
    case "STRONG":
    case "B": return wrap(inline(), "**");
    case "EM":
    case "I": return wrap(inline(), "*");
    case "S":
    case "DEL":
    case "STRIKE": return wrap(inline(), "~~");
    case "U": return `<u>${inline()}</u>`;
    case "SUB": return `<sub>${inline()}</sub>`;
    case "SUP": return `<sup>${inline()}</sup>`;
    case "CODE":
    case "KBD":
    case "SAMP": return codeSpan(node.textContent);
    case "PRE": {
      const code = node.querySelector("code");
      const language = (code?.className || node.className || "").match(/(?:language|lang)-([\w+.#-]+)/)?.[1] || node.getAttribute("data-language");
      return codeBlock(node.textContent, language);
    }
    case "A": return link(inline(), node.getAttribute("href"), context);
    case "IMG": {
      const url = resolveUrl(node.getAttribute("src"), context.baseUrl);
      return url ? `![${oneLine(node.getAttribute("alt") || "Image")}](${url})` : oneLine(node.getAttribute("alt") || "Image");
    }
    case "BLOCKQUOTE": return quote(htmlChildren(node, context));
    case "UL":
    case "OL": {
      const start = Number.parseInt(node.getAttribute("start") || "1", 10);
      let number = Number.isFinite(start) ? start : 1;
      return Array.from(node.children).filter((child) => child.nodeName === "LI").map((item) => {
        if (tag === "OL" && item.hasAttribute("value")) {
          const explicit = Number.parseInt(item.getAttribute("value"), 10);
          if (Number.isFinite(explicit)) number = explicit;
        }
        let content = "";
        for (const child of item.childNodes) {
          const rendered = htmlNode(child, context);
          const separator = ["OL", "UL"].includes(child.nodeName) ? "\n" : HTML_BLOCKS.has(child.nodeName) ? "\n\n" : "";
          content += (content.trim() && separator ? separator : "") + rendered;
        }
        return listItem(content, tag === "OL" ? `${number++}. ` : "- ");
      }).join("\n");
    }
    case "TABLE": {
      const rows = Array.from(node.rows || []).filter((row) => row.closest("table") === node);
      return contentTable(rows.map((row) => Array.from(row.cells).map((cell) => ({
        text: htmlChildren(cell, context), header: cell.nodeName === "TH", colspan: cell.colSpan, rowspan: cell.rowSpan,
      }))));
    }
    case "DT": return wrap(inline(), "**");
    case "DD": return htmlChildren(node, context);
    default: return htmlChildren(node, context, !HTML_BLOCKS.has(tag));
  }
}

export function htmlToMarkdown(html, { baseUrl = "", sectionBody = false } = {}) {
  const document = new DOMParser().parseFromString(string(html), "text/html");
  const levels = Array.from(document.body.querySelectorAll("h1,h2,h3,h4,h5,h6"), node => Number(node.nodeName[1]));
  const headingOffset = sectionBody && levels.length ? Math.max(0, 3 - Math.min(...levels)) : 0;
  return htmlChildren(document.body, { baseUrl, sectionBody, headingOffset }).trim();
}

function bodyToMarkdown(body, context) {
  if (typeof body === "string") return escapeText(body).trim();
  if (!body) return "";
  return (body.adf && adfToMarkdown(body.adf, context)) ||
    (body.html && htmlToMarkdown(body.html, context)) || escapeText(body.text).trim();
}

function fieldValue(value, context) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => fieldValue(item, context)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    if (value.key) return issueReference(value, context);
    if (value.type === "doc") return adfToMarkdown(value, context);
    if (value.adf || value.html || value.text != null) return bodyToMarkdown(value, context);
    if (value.displayName != null || value.name != null || value.value != null) return fieldValue(value.displayName ?? value.name ?? value.value, context);
    return escapeText(JSON.stringify(value));
  }
  return escapeText(value);
}

function issueReference(value, context) {
  const key = link(oneLine(value.key), value.url, context);
  return [key, oneLine(value.title)].filter(Boolean).join(" — ");
}

function readableField(field, context) {
  const value = fieldValue(field.value, context);
  const raw = typeof field.value === "object" ? field.value?.text : field.value;
  const date = typeof raw === "string" ? formatDate(raw) : raw;
  return date !== raw ? oneLine(date) : value;
}

function fieldsTable(fields, context) {
  fields = array(fields);
  if (!fields.length) return "";
  return table([
    [{ text: "Field", header: true }, { text: "Value", header: true }],
    ...fields.map((field) => [{ text: oneLine(field.name) }, { text: readableField(field, context) }]),
  ]);
}

function metadata(fields, context) {
  const remaining = array(fields).map(field => ({ ...field }));
  const take = name => {
    const index = remaining.findIndex(field => field.name === name);
    return index < 0 ? null : remaining.splice(index, 1)[0];
  };
  const summary = ["Status", "Resolution", "Type", "Priority"].map(take).filter(Boolean)
    .map(field => readableField(field, context)).filter(Boolean).join(" · ");
  const reporter = remaining.find(field => field.name === "Reporter");
  const creator = remaining.find(field => field.name === "Creator");
  if (reporter && creator && fieldValue(reporter.value, context) === fieldValue(creator.value, context)) {
    reporter.name = "Reporter / Creator";
    take("Creator");
  }
  return { summary: summary ? `**${summary}**` : "", fields: remaining };
}

function attachmentSize(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "";
  const exact = value.toLocaleString("en-US");
  if (value < 1000) return ` — ${exact} bytes`;
  const unit = Math.min(3, Math.floor(Math.log10(value) / 3));
  return ` — ${(value / 1000 ** unit).toFixed(1)} ${["bytes", "kB", "MB", "GB"][unit]} (${exact} bytes)`;
}

function scalarSection(item, context) {
  if (!item.field) return null;
  const body = item.body;
  let value;
  if (body?.adf && adfToMarkdown(body.adf, context)) {
    const nodes = array(body.adf.content);
    const paragraph = nodes[0];
    if (nodes.length !== 1 || paragraph.type !== "paragraph" || array(paragraph.content).some(node =>
      node.type !== "text" || array(node.marks).length)) return null;
    value = array(paragraph.content).map(node => string(node.text)).join("");
  } else if (body?.html && htmlToMarkdown(body.html, context)) {
    const document = new DOMParser().parseFromString(body.html, "text/html");
    const nodes = Array.from(document.body.childNodes).filter(node => node.textContent.trim());
    const node = nodes[0];
    if (nodes.length !== 1 || (node.nodeType !== 3 &&
      (node.nodeName !== "P" || Array.from(node.childNodes).some(child => child.nodeType !== 3)))) return null;
    value = node.textContent;
  } else value = typeof body === "string" ? body : body?.text;
  return typeof value === "string" && value.trim() && !value.includes("\n") ? value : null;
}

export function renderIssue(issue = {}, options = {}) {
  const include = { ...DEFAULT_OPTIONS, ...options };
  const context = { baseUrl: issue.url || "", attachments: array(issue.attachments), sectionBody: true };
  const heading = [issue.key ? link(oneLine(issue.key), issue.url, context) : "", oneLine(issue.title)].filter(Boolean).join(" — ") || "Jira issue";
  const output = [`# ${heading}`];
  if (!issue.key) output.push(`Source: ${link(oneLine(issue.url || "Source unavailable"), issue.url, context)}`);
  const section = (name, value) => { if (value) output.push(`## ${oneLine(name)}\n\n${value}`); };
  if (include.metadata) {
    const details = metadata(issue.fields, context);
    if (details.summary) output.push(details.summary);
    section("Details", fieldsTable(details.fields, context));
  }
  if (include.description) section("Description", bodyToMarkdown(issue.description, context));
  const additional = include.fields ? [...array(issue.customFields)] : [];
  if (include.sections) {
    for (const item of array(issue.sections)) {
      const scalar = scalarSection(item, context);
      if (array(item.items).length) {
        section(item.name || "Section", item.items.map(reference => `- ${reference.relation ? `**${oneLine(reference.relation)}:** ` : ""}${issueReference(reference, context)}`).join("\n"));
      } else if (scalar !== null) {
        additional.push({ name: item.name || "Section", value: scalar });
      } else section(item.name || "Section", bodyToMarkdown(item.body, context));
    }
  }
  section("Additional fields", fieldsTable(additional, context));
  if (include.attachments) {
    section("Attachments", context.attachments.map((attachment) => {
      const name = oneLine(attachment.name || "Attachment");
      return `- ${link(name, attachment.url, context)}${attachmentSize(attachment.size)}`;
    }).join("\n"));
  }
  if (include.pullRequests) section("Pull requests", renderPullRequests(issue.pullRequests, context));
  if (include.commits) section("Commits", renderCommits(issue.commits, context));
  if (include.comments) {
    section("Comments", array(issue.comments).map((comment) => {
      const author = typeof comment.author === "object" ? comment.author?.displayName || comment.author?.name : comment.author;
      const heading = [author || "Unknown author", formatDate(comment.created)].filter(Boolean).map(oneLine).join(" — ");
      return `### ${heading}\n\n${bodyToMarkdown(comment.body, context) || "(Empty comment)"}`;
    }).join("\n\n"));
  }
  return `${blocks(output).trim()}\n`;
}
