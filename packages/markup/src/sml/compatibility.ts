import type { CompiledTemplate } from "../compiled-template";
import type { BrandPlugin } from "../email/brand-plugin";
import { checkHtmlCompatibility, type EmailClientTarget } from "../email/compatibility";
import type { EmailDiagnostic } from "../email/diagnostics";
import type { EmittedPosition } from "../preview";
import { renderEmail } from "../render-template";

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
  return findings;
};
