#!/usr/bin/env node
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
  version: "0.1.1"
});

// Define input Zod schemas
export const SearchRentalPropertiesInputSchema = z.object({
  location: z.string().describe("Location (e.g., Dublin, Cork, specific address)"),
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
      console.error("[index.ts] search_rental_properties: Invalid parameters received by tool registration:", parseResult.error.flatten());
      return {
        content: [{ type: "text", text: "Invalid parameters: " + JSON.stringify(parseResult.error.flatten().fieldErrors) }],
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
      console.error("[index.ts] get_rental_property_details: Invalid parameters received by tool registration:", parseResult.error.flatten());
      return {
        content: [{ type: "text", text: "Invalid parameters: " + JSON.stringify(parseResult.error.flatten().fieldErrors) }],
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