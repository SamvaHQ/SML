import { getPropertyName } from "../utils.js";

const message =
  'Do not treat `typeof x === "object" && x !== null` as validation. ' +
  "Decode unknown or external data with the boundary's validation library (JSON Schema or Effect Schema). " +
  "Hand-roll a shallow object check only when it is the actual contract, with an inline suppression.";

// A stable key for the guarded reference so operands must name the same thing.
// Computed access is bracketed so `obj[key]` never collides with `obj.key`.
function refKey(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "MemberExpression") {
    const object = refKey(node.object);
    const property = node.computed ? refKey(node.property) : getPropertyName(node.property);
    if (!object || !property) return undefined;
    return node.computed ? `${object}[${property}]` : `${object}.${property}`;
  }
  return undefined;
}

// `typeof X === "object"` (either operand order) → returns X's key.
function typeofObjectRef(node) {
  if (node?.type !== "BinaryExpression" || (node.operator !== "===" && node.operator !== "==")) {
    return undefined;
  }
  const [typeofSide, literalSide] =
    node.left?.type === "UnaryExpression" ? [node.left, node.right] : [node.right, node.left];
  if (typeofSide?.type !== "UnaryExpression" || typeofSide.operator !== "typeof") return undefined;
  if (literalSide?.value !== "object") return undefined;
  return refKey(typeofSide.argument);
}

// `typeof X !== "object"` (either operand order) → returns X's key.
function typeofNotObjectRef(node) {
  if (node?.type !== "BinaryExpression" || (node.operator !== "!==" && node.operator !== "!=")) {
    return undefined;
  }
  const [typeofSide, literalSide] =
    node.left?.type === "UnaryExpression" ? [node.left, node.right] : [node.right, node.left];
  if (typeofSide?.type !== "UnaryExpression" || typeofSide.operator !== "typeof") return undefined;
  if (literalSide?.value !== "object") return undefined;
  return refKey(typeofSide.argument);
}

// `X !== null` (either operand order) → returns X's key.
function notNullRef(node) {
  if (node?.type !== "BinaryExpression" || (node.operator !== "!==" && node.operator !== "!=")) {
    return undefined;
  }
  const [nullSide, refSide] =
    node.left?.value === null ? [node.left, node.right] : [node.right, node.left];
  if (nullSide?.type !== "Literal" || nullSide.value !== null) return undefined;
  return refKey(refSide);
}

// `X === null` (either operand order) → returns X's key.
function isNullRef(node) {
  if (node?.type !== "BinaryExpression" || (node.operator !== "===" && node.operator !== "==")) {
    return undefined;
  }
  const [nullSide, refSide] =
    node.left?.value === null ? [node.left, node.right] : [node.right, node.left];
  if (nullSide?.type !== "Literal" || nullSide.value !== null) return undefined;
  return refKey(refSide);
}

// `!X` → returns X's key. The falsy check is the `||`-chain dual of a bare
// truthy operand in an `&&` chain (`!x || typeof x !== "object"`).
function negatedRef(node) {
  if (node?.type !== "UnaryExpression" || node.operator !== "!") return undefined;
  return refKey(node.argument);
}

function flattenLogical(node, operator, out) {
  if (node.type === "LogicalExpression" && node.operator === operator) {
    flattenLogical(node.left, operator, out);
    flattenLogical(node.right, operator, out);
  } else {
    out.push(node);
  }
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require schema validation instead of treating a shallow object-shape check as validation.",
    },
  },
  create(context) {
    return {
      LogicalExpression(node) {
        if (node.operator !== "&&" && node.operator !== "||") return;
        // Only inspect the outermost chain so one guard produces one diagnostic.
        if (node.parent?.type === "LogicalExpression" && node.parent.operator === node.operator) {
          return;
        }

        const operands = [];
        flattenLogical(node, node.operator, operands);
        const objectCheckRefs = new Set();
        const nullCheckRefs = new Set();
        for (const operand of operands) {
          const typeofRef =
            node.operator === "&&" ? typeofObjectRef(operand) : typeofNotObjectRef(operand);
          if (typeofRef !== undefined) {
            objectCheckRefs.add(typeofRef);
            continue;
          }
          const nullRef = node.operator === "&&" ? notNullRef(operand) : isNullRef(operand);
          if (nullRef !== undefined) {
            nullCheckRefs.add(nullRef);
            continue;
          }
          if (node.operator === "&&") {
            const truthyRef = refKey(operand);
            if (truthyRef !== undefined) nullCheckRefs.add(truthyRef);
          } else {
            const falsyRef = negatedRef(operand);
            if (falsyRef !== undefined) nullCheckRefs.add(falsyRef);
          }
        }
        for (const ref of objectCheckRefs) {
          if (nullCheckRefs.has(ref)) {
            context.report({ node, message });
            return;
          }
        }
      },
    };
  },
};
