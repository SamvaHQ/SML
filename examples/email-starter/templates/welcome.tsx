/** @jsxImportSource @samva/markup/email */
import { defineTemplate } from "@samva/markup";
import { Column, Columns, Email, Link, Section, Spacer } from "@samva/markup/email";
import { fmt } from "@samva/markup/fmt";
import { jsonSchema } from "@samva/markup/input-schema";

import { PrimaryButton } from "./blocks/button";
import { Callout } from "./blocks/callout";
import { Footer } from "./blocks/footer";
import { Header } from "./blocks/header";
import { Hero } from "./blocks/hero";
import { KeyValue, KeyValueRow } from "./blocks/key-value";

/** The canonical one-email starter entry, composed from the blocks in ./blocks. */
export default defineTemplate({
  id: "welcome",
  schema: jsonSchema<{
    firstName: string;
    workspace: string;
    workspaceUrl: string;
    plan: string;
    trialEndsAt: string;
    ctaUrl: string;
  }>({
    type: "object",
    properties: {
      firstName: { type: "string" },
      workspace: { type: "string" },
      workspaceUrl: { type: "string" },
      plan: { type: "string" },
      trialEndsAt: { type: "string" },
      ctaUrl: { type: "string" },
    },
    required: ["firstName", "workspace", "workspaceUrl", "plan", "trialEndsAt", "ctaUrl"],
    additionalProperties: false,
  }),
  fixtures: {
    default: {
      firstName: "Maya",
      workspace: "Northwind",
      workspaceUrl: "northwind.example.app",
      plan: "Team trial",
      trialEndsAt: "2026-11-02",
      ctaUrl: "https://app.example.com",
    },
    team: {
      firstName: "Sam",
      workspace: "Design team",
      workspaceUrl: "design-team.example.app",
      plan: "Team trial",
      trialEndsAt: "2026-11-16",
      ctaUrl: "https://app.example.com/team",
    },
  },
  email: {
    subject: (input) => `Your ${input.workspace} workspace is ready`,
    preheader: (input) =>
      `Welcome aboard, ${input.firstName}. Here is everything you need to start.`,
    body: (input) => (
      <Email lang="en">
        <Header product="Acme" mark="A" />
        <Section width={560} className="bg-card rounded-xl px-6 py-8 sm:px-10 sm:py-10">
          <Hero title={`Welcome, ${input.firstName}`}>
            Your workspace <strong>{input.workspace}</strong> is set up and waiting. Everything you
            add from here on lives in one place your whole team can reach.
          </Hero>
          <Spacer height={28} />
          <PrimaryButton href={input.ctaUrl} label="Open your workspace" />
          <Spacer height={36} />
          <KeyValue>
            <KeyValueRow label="Workspace">{input.workspace}</KeyValueRow>
            <KeyValueRow label="Address">{input.workspaceUrl}</KeyValueRow>
            <KeyValueRow label="Plan">{input.plan}</KeyValueRow>
            <KeyValueRow label="Trial ends">{fmt.date(input.trialEndsAt, "long")}</KeyValueRow>
          </KeyValue>
          <Spacer height={32} />
          <Columns>
            <Column valign="top" width="50%" className="pr-6 pb-6">
              <p className="font-heading text-card-foreground m-0 text-[18px] leading-[24px]">
                Invite your team
              </p>
              <p className="text-muted-foreground mt-2 mb-2 text-[14px] leading-[22px]">
                A workspace works best with everyone in it. Add people by email and choose what each
                of them can change.
              </p>
              <Link href={`${input.ctaUrl}/settings/members`} className="text-[14px] font-semibold">
                Invite teammates
              </Link>
            </Column>
            <Column valign="top" width="50%" className="pb-6">
              <p className="font-heading text-card-foreground m-0 text-[18px] leading-[24px]">
                Learn the basics
              </p>
              <p className="text-muted-foreground mt-2 mb-2 text-[14px] leading-[22px]">
                A ten-minute tour of the parts you will use every day, with examples you can copy.
              </p>
              <Link href="https://docs.example.com/start" className="text-[14px] font-semibold">
                Read the guide
              </Link>
            </Column>
          </Columns>
          <Callout title="Stuck on something?">
            Reply to this email. It reaches a person on our team, usually within a working day.
          </Callout>
        </Section>
        <Footer sender="Acme, 100 Example Street, Springfield">
          You are receiving this because you created the {input.workspace} workspace.
        </Footer>
      </Email>
    ),
  },
});
