import { checkEmailCompatibility, type EmailClientTarget } from "../email/compatibility";
import type { EmailDiagnostic } from "../email/diagnostics";
import type { TemplateIr } from "../ir";
import type { EmittedPosition } from "../preview";
import { renderIr } from "../render-ir";

/**
 * Check what each declared fixture delivers against the pinned client matrix. The rules run on the
 * rendered document, because what a client drops is what the compiler produced, and every finding
 * is located at the source of the element that produced it.
 */
export const checkTemplateCompatibility = (
  ir: TemplateIr,
  fixtures: Readonly<Record<string, unknown>>,
  options: { readonly clients?: readonly EmailClientTarget[] | undefined } = {},
): readonly EmailDiagnostic[] => {
  if (ir.email === undefined) return [];
  const sources = ir.sources ?? [];
  const findings: EmailDiagnostic[] = [];
  for (const [fixture, input] of Object.entries(fixtures)) {
    const rendered = renderIr(ir, input, { positions: true });
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
      ...checkEmailCompatibility({
        html: rendered.html,
        fixture,
        positions,
        ...(options.clients === undefined ? {} : { clients: options.clients }),
      }),
    );
  }
  return findings;
};
