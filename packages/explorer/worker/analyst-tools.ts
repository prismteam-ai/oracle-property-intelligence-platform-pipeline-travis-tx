import { toolSchemas } from "@travis-oracle/query-core";
import type { ToolDefinition } from "./agent-route.js";

export function analystTools(): ToolDefinition[] {
  return toolSchemas().map(({ name, description, inputSchema }) => {
    const { $schema: _dialect, ...parameters } = inputSchema;
    return { type: "function", function: { name, description, parameters } };
  });
}
