// Repository lint rules. Each rule documents an invariant the packages hold; an inline
// `oxlint-disable` names the rule and the boundary that justifies the exception.
import noCopyStringSelector from "./oxlint-plugin-samva/rules/no-copy-string-selector.js";
import noErrorConstructor from "./oxlint-plugin-samva/rules/no-error-constructor.js";
import noHandRolledObjectGuard from "./oxlint-plugin-samva/rules/no-hand-rolled-object-guard.js";
import noTryCatchOrThrow from "./oxlint-plugin-samva/rules/no-try-catch-or-throw.js";
import noUnsafeTypeAssertion from "./oxlint-plugin-samva/rules/no-unsafe-type-assertion.js";

export default {
  meta: {
    name: "samva",
  },
  rules: {
    "no-copy-string-selector": noCopyStringSelector,
    "no-error-constructor": noErrorConstructor,
    "no-hand-rolled-object-guard": noHandRolledObjectGuard,
    "no-try-catch-or-throw": noTryCatchOrThrow,
    "no-unsafe-type-assertion": noUnsafeTypeAssertion,
  },
};
