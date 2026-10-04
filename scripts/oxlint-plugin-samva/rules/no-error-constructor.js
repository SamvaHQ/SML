import { nodeName } from "../utils.js";

const errorConstructors = new Set([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

const message =
  "Do not construct built-in Error objects. Return a typed error value or diagnostic instead; at a true boundary use an inline suppression with a reason.";

const isErrorConstructor = (node) => errorConstructors.has(nodeName(node));

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow built-in Error constructors.",
    },
  },
  create(context) {
    return {
      NewExpression(node) {
        if (isErrorConstructor(node.callee)) {
          context.report({ node, message });
        }
      },
      CallExpression(node) {
        if (isErrorConstructor(node.callee)) {
          context.report({ node, message });
        }
      },
    };
  },
};
