/** @jsxImportSource @samva/markup/email */
import { BrandFooter, BrandLogo } from "samva:brand";
import { BrandFooter as NamedFooter } from "samva:brand/acme";

export const Signed = () => (
  <div>
    <BrandLogo width={96} alt="Acme" />
    <p>Thanks for reading.</p>
    <BrandFooter unsubscribeLabel="Stop these emails" />
    <NamedFooter />
  </div>
);
