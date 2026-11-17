import { useState } from "react";

import type { ThemeFontToken } from "../host/types";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { PickerList, Spinner, type PickerOption } from "./color-field";
import { ChevronDown } from "./editor-icons";
import { fontFamilyName, fontRoleLabel, matchFont } from "./theme-tokens";

// The theme's font roles by family name, each set in its own stack. The editor document shows a
// face only when it can load it (installed, or loaded by the host page); otherwise the stack's
// fallback stands in, and the family name still says which face the email uses.

export interface FontFieldProps {
  readonly testId: string;
  readonly fonts: ReadonlyArray<ThemeFontToken>;
  /** The role the element's class sets, if any. */
  readonly role: string | undefined;
  /** The font stack the element renders in, when the canvas can tell. */
  readonly rendered: string | null;
  readonly disabled: boolean;
  readonly pending: boolean;
  /** Set the role class, or clear it to inherit. */
  readonly onChoose: (role: string | null) => void;
}

export function FontField({
  testId,
  fonts,
  role,
  rendered,
  disabled,
  pending,
  onChoose,
}: FontFieldProps) {
  const [open, setOpen] = useState(false);
  const set = fonts.find((font) => font.name === role);
  const inheritedFrom = rendered === null ? undefined : matchFont(fonts, rendered);
  const applied = set ?? inheritedFrom;
  const family =
    applied !== undefined
      ? fontFamilyName(applied.family)
      : rendered === null
        ? "Inherited"
        : fontFamilyName(rendered);
  const detail =
    applied === undefined
      ? undefined
      : set === undefined
        ? `${fontRoleLabel(applied.name)} · theme`
        : fontRoleLabel(applied.name);
  const choose = (next: string | null) => {
    setOpen(false);
    onChoose(next);
  };
  const options: PickerOption[] = fonts.map((font) => ({
    key: font.name,
    testId: `${testId}.${font.name}`,
    name: fontFamilyName(font.family),
    nameStyle: { fontFamily: font.family },
    detail: fontRoleLabel(font.name),
    selected: role === font.name,
    onChoose: () => choose(font.name),
  }));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={`Font: ${family}`}
            data-testid={testId}
            data-editor-control=""
            disabled={disabled || fonts.length === 0}
            className="h-8 w-full justify-start gap-2 px-2 font-normal"
          />
        }
      >
        <span
          className="min-w-0 flex-1 truncate text-left text-[13px]"
          style={applied === undefined ? undefined : { fontFamily: applied.family }}
        >
          {family}
        </span>
        {detail !== undefined && (
          <span className="text-muted-foreground shrink-0 text-[11px]">{detail}</span>
        )}
        {pending ? (
          <Spinner />
        ) : (
          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
        )}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        data-testid={`${testId}.list`}
        className="w-(--anchor-width) min-w-64 gap-0 p-1"
      >
        <PickerList
          label="Font"
          groups={[
            { label: "Theme fonts", options },
            {
              label: "Other",
              options: [
                {
                  key: "none",
                  testId: `${testId}.none`,
                  name:
                    inheritedFrom === undefined || role !== undefined
                      ? "Inherited"
                      : `Inherited · ${fontFamilyName(inheritedFrom.family)}`,
                  selected: role === undefined,
                  onChoose: () => choose(null),
                },
              ],
            },
          ]}
        />
      </PopoverContent>
    </Popover>
  );
}
