/** @jsxImportSource @samva/markup/email */
import { Section } from "@samva/markup/email";

/**
 * The product's mark and name above the message, on the page color. Swap both for your logo (an
 * `<Image>`, or `BrandLogo` from your brand import) when you have one.
 */
export const Header = ({ product, mark }: { product: string; mark: string }) => (
  <Section width={560} className="px-1 pt-8 pb-5">
    <table role="presentation" cellpadding={0} cellspacing={0}>
      <tbody>
        <tr>
          <td
            width={30}
            height={30}
            align="center"
            className="bg-primary font-heading text-primary-foreground rounded-md text-[18px] leading-[30px]"
          >
            {mark}
          </td>
          <td className="font-heading text-foreground pl-3 text-[21px] leading-[30px]">
            {product}
          </td>
        </tr>
      </tbody>
    </table>
  </Section>
);
