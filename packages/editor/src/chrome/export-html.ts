import { INSTANCE_PATH_ATTRIBUTE } from "@samva/markup/render";

/**
 * The rendered email as a standalone HTML file.
 *
 * The host renders the template and returns the delivered document plus one
 * preview-only attribute per element, which is how a click in the canvas resolves
 * to a rendered instance. Stripping it is the whole difference between what the
 * canvas shows and what a recipient receives, so it is the only transform here.
 */
const INSTANCE_ATTRIBUTE_PATTERN = new RegExp(`\\s${INSTANCE_PATH_ATTRIBUTE}="[^"]*"`, "g");

export const emailHtmlForExport = (html: string): string =>
  html.replace(INSTANCE_ATTRIBUTE_PATTERN, "");

const slugify = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "email" : slug;
};

/** Trigger a browser download of the rendered document. No server round trip. */
export const downloadEmailHtml = (html: string, name: string): void => {
  const blob = new Blob([emailHtmlForExport(html)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugify(name)}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
