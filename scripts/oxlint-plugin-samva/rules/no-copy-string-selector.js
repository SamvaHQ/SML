import { getCallName, isTestLike, unwrapExpression } from "../utils.js";

// Testing-Library / Playwright query families whose first positional argument is
// the human-visible copy: get/query/find (optionally All) By Text | Label(Text) |
// Placeholder(Text). A string or regex literal arg pins UI/marketing copy into the test.
const TEXT_ARG_QUERY = /^(get|query|find)(All)?By(Text|Label(Text)?|Placeholder(Text)?)$/;

// Role queries take the accessible name via an options object; a string or regex
// `name` pins copy just the same. Imported identifier `name` stays legal.
const ROLE_QUERY = /^(get|query|find)(All)?ByRole$/;

const textArgMessage = (name) =>
  `${name} with a copy string or regex couples the test to UI copy — add a component data-testid where possible, or assert content against an imported copy constant. Same-file literals, including hoisted constants, are not a bypass.`;

const roleNameMessage = (name) =>
  `${name} with a copy-string or regex \`name\` couples the test to UI copy — add a component data-testid where possible, or pass an imported constant. Same-file literals, including hoisted constants, are not a bypass.`;

function isStringLiteral(node) {
  if (!node) return false;
  if (node.type === "StringLiteral") return true;
  if (node.type === "TemplateLiteral") return node.expressions.length === 0;
  return node.type === "Literal" && typeof node.value === "string";
}

function isRegExpLiteral(node) {
  if (!node) return false;
  if (node.type === "RegExpLiteral") return true;
  if (node.type === "Literal") {
    if (node.regex !== undefined && node.regex !== null) return true;
    return Object.prototype.toString.call(node.value) === "[object RegExp]";
  }
  return false;
}

function isCopyLiteral(node) {
  return isStringLiteral(node) || isRegExpLiteral(node);
}

function resolveBinding(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return undefined;
}

// Direct string/regex literals, plus identifiers whose only bindings are local
// `const name = "…" | /…/` declarators. Imported, parameter, and unbound names
// stay legal so fixture catalogs and host-owned copy remain the documented path.
function isBannedCopySelector(sourceCode, node) {
  const expression = unwrapExpression(node);
  if (isCopyLiteral(expression)) return true;
  if (expression?.type !== "Identifier") return false;
  const binding = resolveBinding(sourceCode, expression);
  if (!binding) return false;
  return binding.defs.some((def) => {
    if (def.type !== "Variable") return false;
    const declarator = def.node;
    if (declarator?.type !== "VariableDeclarator") return false;
    if (declarator.id?.type !== "Identifier") return false;
    return isCopyLiteral(unwrapExpression(declarator.init));
  });
}

function copyNameProperty(sourceCode, optionsNode) {
  const options = unwrapExpression(optionsNode);
  if (options?.type !== "ObjectExpression") return undefined;
  return options.properties.find((property) => {
    if (property.type !== "Property") return false;
    const key = property.key;
    const keyName =
      key?.type === "Identifier" ? key.name : isStringLiteral(key) ? key.value : undefined;
    return keyName === "name" && isBannedCopySelector(sourceCode, property.value);
  });
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require stable test selectors instead of selectors coupled to literal product copy.",
    },
  },
  create(context) {
    if (!isTestLike(context.filename)) return {};
    const pending = [];
    return {
      CallExpression(node) {
        const name = getCallName(node.callee);
        if (name === undefined) return;
        if (TEXT_ARG_QUERY.test(name)) {
          pending.push({ kind: "text", name, arg: node.arguments[0] });
          return;
        }
        if (ROLE_QUERY.test(name)) {
          pending.push({ kind: "role", name, options: node.arguments[1] });
        }
      },
      "Program:exit"() {
        const { sourceCode } = context;
        for (const item of pending) {
          if (
            item.kind === "text" &&
            item.arg !== undefined &&
            isBannedCopySelector(sourceCode, item.arg)
          ) {
            context.report({
              node: item.arg,
              message: textArgMessage(item.name),
            });
            continue;
          }
          if (item.kind === "role") {
            const nameProperty = copyNameProperty(sourceCode, item.options);
            if (nameProperty !== undefined) {
              context.report({
                node: nameProperty.value,
                message: roleNameMessage(item.name),
              });
            }
          }
        }
      },
    };
  },
};
