import { isTestLike } from "../utils.js";

const tryCatchMessage =
  "Do not use try/catch blocks. Return failures as typed results (better-result) or diagnostics instead. At a true boundary use an inline suppression with a reason.";
const throwMessage =
  "Do not throw. Return failures as typed results (better-result) or diagnostics instead. At a true boundary use an inline suppression with a reason.";

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow try/catch blocks and throw statements.",
    },
  },
  create(context) {
    if (isTestLike(context.filename)) return {};

    return {
      TryStatement(node) {
        context.report({ node, message: tryCatchMessage });
      },
      ThrowStatement(node) {
        context.report({ node, message: throwMessage });
      },
    };
  },
};
