# Chrome Web Store

## Name

Jira to Markdown

## Short description

Copy Jira issues as clean Markdown. Keep the description, comments, commits, and pull requests in one paste.

## Description

Copy Jira. Paste Markdown.

Turn the open issue into clean Markdown for notes, docs, pull requests, and AI tools.

- Choose descriptions, comments, metadata, and attachment links.
- Keep commits and PRs in compact tables with repository links.
- Preview your export. Save your preferences.

Works with your Jira session. No API key or extra account. Your data stays in your browser and clipboard.

Open source by inndevs. Not affiliated with Atlassian.

## Links

- Homepage: https://github.com/inndevs/jira-ticket-copy-as-markdown
- Support: https://github.com/inndevs/jira-ticket-copy-as-markdown/issues
- Privacy: https://github.com/inndevs/jira-ticket-copy-as-markdown/blob/main/PRIVACY.md

## Purpose and permissions

Copy the current Jira issue as Markdown.

| Permission | Purpose |
| --- | --- |
| `activeTab` | Access the current tab when invoked. |
| `scripting` | Read the selected Jira issue. |
| `storage` | Save export preferences locally. |
| `clipboardWrite` | Copy Markdown to the clipboard. |

No host permissions, background scripts, or remote executable code.

## Data disclosures

- Website content: issue text, fields, comments, attachment metadata, linked commits and pull requests.
- Personally identifiable information: names and personal information in issue content.
- Personal communications: comments and authors.
- Web history: current issue URL only; no browsing-history access.

Data is used only for the requested export. No sales, unrelated use, or creditworthiness decisions.

## Reviewer instructions

Open an HTTPS Jira issue using a test account. Click the extension, paste the Markdown, change content options, and copy again. Reopen to verify saved preferences. If the REST API fails, visible-page export shows a warning. No separate account, API key, or payment is required.

## Assets

- ZIP: `dist/jira-ticket-copy-as-markdown-VERSION.zip`
- Store icon: `icons/icon128.png`
- Large icon: `icons/icon512.png`
- Screenshot: `store/screenshot-1280x800.png`
- Small promo tile: `store/promo-440x280.png`
