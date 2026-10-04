const message =
  "Do not assert through `never` or `unknown`: the double cast turns off the type check it passes through. Parse at the boundary (entity-id schemas, Schema.decodeUnknown*), fix the source type, or populate the test double.";

const isAssertion = (node) => node?.type === "TSAsExpression" || node?.type === "TSTypeAssertion";

// `x as never` asserts anything into any slot; `x as unknown as T` launders
// an unrelated type through the top type. Both are reported at the outer cast.
const isUnsafe = (node) =>
  node.typeAnnotation.type === "TSNeverKeyword" ||
  (isAssertion(node.expression) && node.expression.typeAnnotation.type === "TSUnknownKeyword");

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow `as never` and `as unknown as T` type assertions.",
    },
  },
  create(context) {
    const check = (node) => {
      if (isUnsafe(node)) context.report({ node, message });
    };
    return {
      TSAsExpression: check,
      TSTypeAssertion: check,
    };
  },
};
