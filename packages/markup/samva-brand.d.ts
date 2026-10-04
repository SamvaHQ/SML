// The `samva:brand` module a template imports its brand components from. The
// compiler resolves the specifier to a generated module bound to the build's
// brand; this declaration is what a project's own `tsc` sees. Add
// `"types": ["@samva/markup/samva-brand"]` to the project's tsconfig.

declare module "samva:brand" {
  export const BrandLogo: import("@samva/markup/brand").BrandComponents["BrandLogo"];
  export const BrandFooter: import("@samva/markup/brand").BrandComponents["BrandFooter"];
}

declare module "samva:brand/*" {
  export const BrandLogo: import("@samva/markup/brand").BrandComponents["BrandLogo"];
  export const BrandFooter: import("@samva/markup/brand").BrandComponents["BrandFooter"];
}
