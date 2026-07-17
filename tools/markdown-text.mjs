/**
 * Render untrusted prose as Markdown text without allowing it to create trusted
 * headings, lists, links, or inline HTML in derived operator receipts.
 */
export function escapeMarkdownText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_[\]{}()#+\-.!|])/g, "\\$1");
}

export function markdownBulletList(items, empty = "None") {
  if (!items || items.length === 0) return `- ${escapeMarkdownText(empty)}`;
  return items.map((item) => `- ${escapeMarkdownText(item)}`).join("\n");
}
