import { Marked } from "marked";

// Renders Claude's chat replies. Raw HTML is dropped rather than rendered, and
// links open in a new tab so they don't navigate away from the doc.
const marked = new Marked({ gfm: true, breaks: true });
marked.use({
  renderer: {
    html: () => "",
    link(token) {
      const html = marked.Renderer.prototype.link.call(this, token);
      return html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
    },
  },
});

export function renderChatMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string;
}
