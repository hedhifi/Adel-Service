import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: path.join(root, ".env") });

const server = new McpServer({ name: "adel-service", version: "0.1.0" });
registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
