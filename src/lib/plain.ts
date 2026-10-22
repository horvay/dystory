// Markdown -> readable plain text, for showing diffs without syntax noise.
export function markdownToPlain(md: string): string {
  return md
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)[-*+] \[ \] /, "$1☐ ")
        .replace(/^(\s*)[-*+] \[[xX]\] /, "$1☑ ")
        .replace(/^(\s*)[-*+] /, "$1• ")
        .replace(/^#{1,6} /, "")
        .replace(/^(> ?)+/, "")
        .replace(/^```.*$/, "")
        .replace(/^(-{3,}|\*{3,})$/, "———"),
    )
    .join("\n")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/==(.+?)==/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!>~=|])/g, "$1");
}

/** First lines of a quoted selection, for the composer chip. */
export function selectionPreview(md: string): string {
  return markdownToPlain(md).replace(/\s+/g, " ").trim();
}
