import { isMap, isScalar, parseDocument, type YAMLMap } from "yaml";

import { checkAttribute } from "../email/html";
import { TEMPLATE_ID_PATTERN } from "../template";
import type { IssueFrontmatter } from "./types";

type Report = (message: string, offset: number) => void;

/** The YAML AST keeps duplicate keys, tags and aliases visible instead of coercing them. */
export const readFrontmatter = (
  source: string,
  report: Report,
): { readonly markdown: string; readonly frontmatter: IssueFrontmatter | undefined } => {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)/.exec(source);
  if (opening === null) {
    report("An issue requires YAML frontmatter with title, slug and topic.", 0);
    return { markdown: source, frontmatter: undefined };
  }
  const bodyStart = opening[0].length;
  const closing = /^---[ \t]*(?:\r?$)/m.exec(source.slice(bodyStart));
  if (closing === null) {
    report("Close the YAML frontmatter with a line containing ---.", 0);
    return { markdown: "", frontmatter: undefined };
  }
  const bodyEnd = bodyStart + closing.index;
  const end = bodyEnd + closing[0].length;
  const markdown = source.slice(0, end).replace(/[^\r\n]/g, " ") + source.slice(end);
  const document = parseDocument(source.slice(bodyStart, bodyEnd), { uniqueKeys: true });
  let invalid = false;
  const fail = (message: string, offset = 0): void => {
    invalid = true;
    report(message, bodyStart + offset);
  };
  for (const error of document.errors) fail(error.message, error.pos[0]);
  for (const warning of document.warnings) fail(warning.message, warning.pos[0]);
  if (!isMap(document.contents)) {
    fail("Frontmatter must be a YAML mapping with title, slug and topic.");
    return { markdown, frontmatter: undefined };
  }
  const keys = (map: YAMLMap, allowed: readonly string[]): void => {
    if (map.tag !== undefined || map.anchor !== undefined)
      fail("YAML tags and anchors are not supported.", map.range?.[0]);
    for (const pair of map.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
        fail("Frontmatter field names must be strings.");
        continue;
      }
      if (!allowed.includes(pair.key.value))
        fail(`Unknown frontmatter field ${JSON.stringify(pair.key.value)}.`, pair.key.range?.[0]);
    }
  };
  const string = (map: YAMLMap, name: string, required = false): string | undefined => {
    const value = map.get(name, true);
    if (value === undefined && !required) return undefined;
    if (
      !isScalar(value) ||
      typeof value.value !== "string" ||
      (required && value.value.trim() === "") ||
      value.tag !== undefined ||
      value.anchor !== undefined
    ) {
      fail(`${name} must be ${required ? "a nonempty" : "a"} string.`);
      return undefined;
    }
    return value.value;
  };
  const root = document.contents;
  keys(root, ["title", "date", "slug", "topic", "preheader", "seo", "gate"]);
  const title = string(root, "title", true);
  const dateNode = root.get("date", true);
  let date: string | undefined;
  if (dateNode !== undefined) {
    const value = isScalar(dateNode) ? dateNode.value : undefined;
    if (
      !isScalar(dateNode) ||
      typeof value !== "string" ||
      dateNode.tag !== undefined ||
      dateNode.anchor !== undefined ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
    )
      fail("date must be a valid ISO calendar date (YYYY-MM-DD).", dateNode.range?.[0]);
    else date = value;
  }
  const slug = string(root, "slug", true);
  const topic = string(root, "topic", true);
  const preheader = string(root, "preheader");
  if (slug !== undefined && !TEMPLATE_ID_PATTERN.test(slug))
    fail("slug must be a lowercase kebab-case identifier of at most 100 characters.");
  let seo: IssueFrontmatter["seo"];
  const seoNode = root.get("seo", true);
  if (seoNode !== undefined) {
    if (!isMap(seoNode)) fail("seo must be a mapping of title, description and image.");
    else {
      keys(seoNode, ["title", "description", "image"]);
      const seoTitle = string(seoNode, "title");
      const description = string(seoNode, "description");
      const image = string(seoNode, "image");
      if (
        image !== undefined &&
        (!URL.canParse(image) ||
          !/^https:\/\//i.test(image) ||
          checkAttribute("img", "src", image, []).diagnostics.length > 0 ||
          (URL.canParse(image) &&
            (new URL(image).username !== "" || new URL(image).password !== "")))
      )
        fail("seo.image must be a safe absolute https URL without credentials.");
      seo = {
        ...(seoTitle === undefined ? {} : { title: seoTitle }),
        ...(description === undefined ? {} : { description }),
        ...(image === undefined ? {} : { image }),
      };
    }
  }
  let gate: IssueFrontmatter["gate"];
  const gateNode = root.get("gate", true);
  if (gateNode !== undefined) {
    if (!isMap(gateNode)) fail("gate must be a mapping with leadIn.");
    else {
      keys(gateNode, ["leadIn"]);
      const leadIn = gateNode.get("leadIn", true);
      if (
        !isScalar(leadIn) ||
        typeof leadIn.value !== "number" ||
        !Number.isSafeInteger(leadIn.value) ||
        leadIn.value < 0 ||
        leadIn.tag !== undefined ||
        leadIn.anchor !== undefined
      )
        fail("gate.leadIn must be a nonnegative integer counting leading top-level blocks.");
      else gate = { leadIn: leadIn.value };
    }
  }
  return {
    markdown,
    frontmatter:
      invalid || title === undefined || slug === undefined || topic === undefined
        ? undefined
        : {
            title,
            ...(date === undefined ? {} : { date }),
            slug,
            topic,
            ...(preheader === undefined ? {} : { preheader }),
            ...(seo === undefined ? {} : { seo }),
            ...(gate === undefined ? {} : { gate }),
          },
  };
};
