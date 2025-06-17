#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';

// --- BEGIN DEBUG LOGGING SETUP ---
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
const timestampStr = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
const logFileName = `${timestampStr}_daft_mcp_debug.log`;
const logFilePath = path.join(logsDir, logFileName);
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
const originalConsoleError = console.error;
const originalConsoleLog = console.log; // Also capture console.log for completeness

console.error = (...args: any[]) => {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
  logStream.write(`[${timestamp}] [INFO] ${message}\n`);
  originalConsoleError.apply(console, args); // Also log to original stderr
};

console.log = (...args: any[]) => {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
  logStream.write(`[${timestamp}] [LOG] ${message}\n`);
  originalConsoleLog.apply(console, args); // Also log to original stdout
};

console.error(`[index.ts] Logging initialized. Output will be written to: ${logFilePath}`);
// --- END DEBUG LOGGING SETUP ---

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";

// Note: Adjust SearchRentalPropertiesParams import in daftScraper.ts to use this exported type
import { handleSearchRentalPropertiesScraping } from "./daftScraper.js";
import { handleGetRentalPropertyDetailsApi } from "./daftApi.js";

// Create an MCP server
const server = new McpServer({
  name: "daft-ie-mcp",
  version: "0.2.2"
});

// Define input Zod schemas
export const SearchRentalPropertiesInputSchema = z.object({
  location: z.string().optional().describe("Location (e.g., Dublin, Cork, specific address) - Defaults to all Ireland if omitted"),
  min_price: z.number().optional().describe("Minimum price per month"),
  max_price: z.number().optional().describe("Maximum price per month"),
  num_beds: z.number().optional().describe("Number of bedrooms (for scraping, 1 means 1-2 beds)"),
  property_type: z.string().optional().describe("Type of property (e.g., apartment, house)"),
});

export type SearchRentalPropertiesParams = z.infer<typeof SearchRentalPropertiesInputSchema>;


export const GetRentalPropertyDetailsInputSchema = z.object({
  property_id: z.string().describe("Unique ID of the rental property"),
});

export type GetRentalPropertyDetailsParams = z.infer<typeof GetRentalPropertyDetailsInputSchema>;


// Tool for searching rental properties (uses scraper)
server.tool(
  "search_rental_properties",
  SearchRentalPropertiesInputSchema.shape as any, // Use .shape for MCP SDK
  async (extra: any): Promise<{ content: TextContent[]; isError?: boolean }> => {
    const parseResult = SearchRentalPropertiesInputSchema.safeParse(extra);
    if (!parseResult.success) {
      const errorPayload = {
        errorType: "InputValidationError",
        toolName: "search_rental_properties",
        message: "Invalid parameters received.",
        details: parseResult.error.flatten().fieldErrors,
        receivedParams: extra
      };
      console.error(`[index.ts] search_rental_properties: ${errorPayload.message}`, errorPayload.details);
      return {
        content: [{ type: "text", text: JSON.stringify(errorPayload, null, 2) }],
        isError: true,
      };
    }
    return handleSearchRentalPropertiesScraping(parseResult.data);
  }
);

// Tool for getting rental property details (uses API - likely non-functional)
server.tool(
  "get_rental_property_details",
  GetRentalPropertyDetailsInputSchema.shape as any, // Use .shape for MCP SDK
  async (extra: any): Promise<{ content: TextContent[]; isError?: boolean }> => {
    const parseResult = GetRentalPropertyDetailsInputSchema.safeParse(extra);
    if (!parseResult.success) {
      const errorPayload = {
        errorType: "InputValidationError",
        toolName: "get_rental_property_details",
        message: "Invalid parameters received.",
        details: parseResult.error.flatten().fieldErrors,
        receivedParams: extra
      };
      console.error(`[index.ts] get_rental_property_details: ${errorPayload.message}`, errorPayload.details);
      return {
        content: [{ type: "text", text: JSON.stringify(errorPayload, null, 2) }],
        isError: true,
      };
    }
    console.error("[index.ts] get_rental_property_details tool called. Note: This uses the Daft.ie API which likely requires an unobtainable API key and may not function.");
    return handleGetRentalPropertyDetailsApi(parseResult.data);
  }
);

// Start receiving messages on stdin and sending messages on stdout
async function start() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Daft.ie MCP server (refactored) running on stdio. Search uses scraping. Details uses API (likely non-functional).');
}

start().catch(error => {
  console.error('Failed to start refactored Daft.ie MCP server:', error);
  process.exit(1);
});