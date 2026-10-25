import type { CompiledNode, CompiledTemplate } from "../compiled-template";
import { DIAGNOSTIC_CODES } from "../diagnostic-codes";
import type { BrandPlugin } from "../email/brand-plugin";
import { checkHtmlCompatibility, type EmailClientTarget } from "../email/compatibility";
import type { EmailDiagnostic } from "../email/diagnostics";
import {
  componentDegradation,
  type EmailDegradation,
  type SemanticComponentName,
} from "../ir/degradations";
import { isValueNode } from "../ir/nodes";
import type { EmittedPosition } from "../preview";
import { renderEmail } from "../render-template";

/** One authored component's content fidelity in email, independent of client presentation. */
export interface ComponentEmailDegradation extends EmailDegradation {
  readonly component: SemanticComponentName;
  readonly origins: EmailDiagnostic["origins"];
}

/**
 * The document's declarations, including conditional branches. A declaration describes the
 * component when used; fixture-specific client observations still come from the rendered HTML.
 */
export const templateEmailDegradations = (
  template: CompiledTemplate,
): readonly ComponentEmailDegradation[] => {
  if (template.email === undefined) return [];
  const declarations: ComponentEmailDegradation[] = [];
  const pending: CompiledNode[] = [template.email.body];
  const seen = new Set<CompiledNode>();
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (isValueNode(node) || seen.has(node)) continue;
    seen.add(node);
    if ("type" in node && node.type === "component") {
      const src = node.src;
      declarations.push({
        component: node.name,
        ...componentDegradation(node.name),
        origins:
          src === undefined
            ? []
            : [
                {
                  fileName: template.sources?.[src[2] ?? 0] ?? "",
                  lineNumber: src[0],
                  columnNumber: src[1],
                },
              ],
      });
    }
    if ("if" in node) pending.push(...[...node.then, ...(node.else ?? [])].reverse());
    else if ("children" in node) pending.push(...(node.children ?? []).toReversed());
  }
  return declarations;
};

/** Translate content losses into the same located report as HTML compatibility findings. */
export const degradationFindings = (
  declarations: readonly ComponentEmailDegradation[],
): readonly EmailDiagnostic[] =>
  declarations.flatMap((declaration): EmailDiagnostic[] =>
    declaration.kind === "same"
      ? []
      : [
          {
            code: "email-component-degradation",
            severity: "warning",
            message: `<${declaration.component}>: ${declaration.note}`,
            origins: declaration.origins,
            notes: DIAGNOSTIC_CODES["email-component-degradation"].fix,
            compatibility: { assessment: "degradation", title: declaration.note },
          },
        ],
  );

/**
 * Check what each declared fixture delivers against the pinned client matrix. The rules run on the
 * rendered document, because what a client drops is what the compiler produced, and every finding
 * is located at the source of the element that produced it. A fixture the renderer refuses throws
 * its `RenderError`: validate fixtures before asking what they deliver.
 */
export const checkCompatibility = (
  template: CompiledTemplate,
  fixtures: Readonly<Record<string, unknown>>,
  options: {
    readonly clients?: readonly EmailClientTarget[] | undefined;
    readonly brandPlugin?: BrandPlugin | undefined;
  } = {},
): readonly EmailDiagnostic[] => {
  if (template.email === undefined) return [];
  const sources = template.sources ?? [];
  const findings: EmailDiagnostic[] = [];
  for (const [fixture, input] of Object.entries(fixtures)) {
    const rendered = renderEmail(template, input, {
      positions: true,
      ...(options.brandPlugin === undefined ? {} : { brandPlugin: options.brandPlugin }),
    });
    const positions: EmittedPosition[] = (rendered.positions ?? []).map((position, index) => ({
      start: position.start,
      end: position.end,
      tag: position.tag,
      instancePath: String(index),
      authored: true,
      origins:
        position.src === undefined
          ? []
          : [
              {
                fileName: sources[position.src[2] ?? 0] ?? "",
                lineNumber: position.src[0],
                columnNumber: position.src[1],
              },
            ],
    }));
    findings.push(
      ...checkHtmlCompatibility({
        html: rendered.html,
        fixture,
        positions,
        ...(options.clients === undefined ? {} : { clients: options.clients }),
      }),
    );
  }
  findings.push(...degradationFindings(templateEmailDegradations(template)));
  return findings;
};
