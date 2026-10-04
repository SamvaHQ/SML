// The diagnostics entry: the shared vocabulary for reporting problems in a template — source spans,
// the diagnostic-code registry with its fixes, and email compile diagnostics. It is light enough for
// a host that only reports (an editor, a Worker's startup path) to import without the compiler.
export * from "./diagnostic-model";
export * from "./diagnostic-codes";
export * from "./email/diagnostics";
