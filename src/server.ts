import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { SearchRentalPropertiesInputSchema, GetRentalPropertyDetailsInputSchema } from './types.js';
import { handleSearchRentalPropertiesScraping } from './services/daftScraper.service.js';
import { handleGetRentalPropertyDetailsApi } from './services/daftApi.service.js';
import logger from './logger.js';

export async function startServer() {
  const server = new McpServer({
    name: 'dafty-mcp',
    version: '0.2.2',
  });

  // Tool for searching rental properties (uses scraper)
  server.tool(
    'search_rental_properties',
    SearchRentalPropertiesInputSchema.shape as Record<string, unknown>, // Use .shape for MCP SDK
    async (extra: Record<string, unknown>): Promise<{ content: TextContent[]; isError?: boolean }> => {
      const parseResult = SearchRentalPropertiesInputSchema.safeParse(extra);
      if (!parseResult.success) {
        const errorPayload = {
          errorType: 'InputValidationError',
          toolName: 'search_rental_properties',
          message: 'Invalid parameters received.',
          details: parseResult.error.flatten().fieldErrors,
          receivedParams: extra,
        };
        logger.error(`[server.ts] search_rental_properties: ${errorPayload.message}`, errorPayload.details);
        return {
          content: [{ type: 'text', text: JSON.stringify(errorPayload, null, 2) }],
          isError: true,
        };
      }
      return handleSearchRentalPropertiesScraping(parseResult.data);
    }
  );

  // Tool for getting rental property details (uses API - likely non-functional)
  server.tool(
    'get_rental_property_details',
    GetRentalPropertyDetailsInputSchema.shape as Record<string, unknown>, // Use .shape for MCP SDK
    async (extra: Record<string, unknown>): Promise<{ content: TextContent[]; isError?: boolean }> => {
      const parseResult = GetRentalPropertyDetailsInputSchema.safeParse(extra);
      if (!parseResult.success) {
        const errorPayload = {
          errorType: 'InputValidationError',
          toolName: 'get_rental_property_details',
          message: 'Invalid parameters received.',
          details: parseResult.error.flatten().fieldErrors,
          receivedParams: extra,
        };
        logger.error(`[server.ts] get_rental_property_details: ${errorPayload.message}`, errorPayload.details);
        return {
          content: [{ type: 'text', text: JSON.stringify(errorPayload, null, 2) }],
          isError: true,
        };
      }
      logger.info(
        '[server.ts] get_rental_property_details tool called. Note: This uses the Daft.ie API which likely requires an unobtainable API key and may not function.'
      );
      return handleGetRentalPropertyDetailsApi(parseResult.data);
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(
    'Dafty MCP server (refactored) running on stdio. Search uses scraping. Details uses API (likely non-functional).'
  );
}
