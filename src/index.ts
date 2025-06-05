#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from 'axios';
import * as cheerio from 'cheerio';

// Create an MCP server
const server = new McpServer({
  name: "daft-ie-mcp",
  version: "0.1.0"
});

// Create axios instance for Daft.ie API
const daftApi = axios.create({
  baseURL: 'https://api.daft.ie/v3', // Base URL for Daft.ie API v3
  headers: {
    'Content-Type': 'application/json',
    // Add any necessary API keys or authentication headers here if required by Daft.ie
    // 'Authorization': `Bearer ${process.env.DAFT_API_KEY}`,
  },
});

// Tool for searching rental properties
server.tool(
  "search_rental_properties",
  {
    location: z.string().describe("Location (e.g., Dublin, Cork, specific address)"),
    min_price: z.number().optional().describe("Minimum price per month"),
    max_price: z.number().optional().describe("Maximum price per month"),
    num_beds: z.number().optional().describe("Number of bedrooms"),
    property_type: z.string().optional().describe("Type of property (e.g., apartment, house)"),
  },
  async ({ location, min_price, max_price, num_beds, property_type }) => {
    console.error('--- daft-ie-mcp: search_rental_properties CALLED (using console.error) ---');
    const receivedParams = { location, min_price, max_price, num_beds, property_type };
    console.error('[search_rental_properties] Received parameters (using console.error):', receivedParams);

    try {
      // 1. Construct Search URL
      // Basic slugification: lowercase and replace spaces with hyphens
      const slugify = (str: string) => str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const locationSlug = slugify(location);
      
      let urlPath = `/property-for-rent/${locationSlug}`;

      // Handle property_type in URL path
      if (property_type) {
        const propertyTypeSlug = slugify(property_type);
        // Simple pluralization for common types, might need a more robust solution for edge cases
        urlPath += `/${propertyTypeSlug}s`;
      }

      const queryParams = new URLSearchParams();

      // Add price filters
      if (min_price) {
        queryParams.append('rentalPrice_from', min_price.toString());
      }
      if (max_price) {
        queryParams.append('rentalPrice_to', max_price.toString());
      }

      // Add number of beds filter
      if (num_beds) {
        queryParams.append('numBeds_from', num_beds.toString());
        // Assuming numBeds_to is same as numBeds_from for exact match or minimum
        queryParams.append('numBeds_to', num_beds.toString());
      }

      const queryString = queryParams.toString();
      const searchUrl = `https://www.daft.ie${urlPath}${queryString ? '?' + queryString : ''}`;
      console.error(`[search_rental_properties] Constructed search URL: ${searchUrl}`);

      // 2. Fetch HTML
      console.error(`[search_rental_properties] Fetching HTML from ${searchUrl}`);
      const response = await axios.get(searchUrl, {
        headers: {
          // Mimic a browser to avoid simple bot detection
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/', // Generic referer
        }
      });
      console.error(`[search_rental_properties] HTML fetched successfully. Status: ${response.status}`);

      // 3. Load HTML into Cheerio
      const $ = cheerio.load(response.data);

      // 4. Basic Parsing - Find and count property items
      const resultsList = $('ul[data-testid="results"]');
      if (resultsList.length === 0) {
        console.error('[search_rental_properties] Could not find results list (ul[data-testid="results"]). Page structure might have changed or no results.');
        return {
          content: [{ type: "text", text: `Could not find results list on Daft.ie for ${location}. Page structure might have changed or no results found.` }],
          isError: true,
        };
      }
      
      const propertyItems = resultsList.find('li[data-testid^="result-"]');
      const propertyCount = propertyItems.length;
      console.error(`[search_rental_properties] Found ${propertyCount} property items.`);

      const scrapedProperties: any[] = [];

      propertyItems.each((index, element) => {
        const $element = $(element);
        const property: any = {};

        // URL and Property ID from main link
        const mainLink = $element.find('a.sc-e4e4a161-16.dukjos').first(); // Main link for the whole card
        const relativeUrl = mainLink.attr('href');
        if (relativeUrl) {
          property.url = `https://www.daft.ie${relativeUrl}`;
          const urlParts = relativeUrl.split('/');
          property.id = urlParts[urlParts.length - 1];
        }
        
        // Fallback for property ID from data-testid if link parsing fails
        if (!property.id) {
            const dataTestId = $element.attr('data-testid');
            if (dataTestId) {
                property.id = dataTestId.replace('result-', '');
            }
        }

        // Address
        property.address = $element.find('div[data-tracking="srp_address"] p').first().text().trim();
        
        // Tagline
        property.tagline = $element.find('div[data-tracking="srp_tagline"] p').first().text().trim();

        // Main Image
        property.imageUrl = $element.find('div[data-testid="imageContainer"] img').first().attr('src');

        // --- Try to get unit details if present ---
        // This part targets the structure for individual units if a listing has multiple,
        // or the primary details if it's a single unit presented this way.
        const unitElements = $element.find('a.sc-6482a644-0.kDgRVR'); // Links for individual units

        if (unitElements.length > 0) {
          property.units = [];
          unitElements.each((unitIndex, unitElement) => {
            const $unit = $(unitElement);
            const unitDetails: any = {};
            unitDetails.price = $unit.find('p.sc-4c172e97-0.jmFLnF').first().text().trim(); // Price per month for the unit
            const bedBathType = $unit.find('div.sc-5d364562-1.kzXTWf span');
            if (bedBathType.length >= 1) unitDetails.beds = bedBathType.eq(0).text().trim();
            if (bedBathType.length >= 2) unitDetails.baths = bedBathType.eq(1).text().trim();
            if (bedBathType.length >= 3) unitDetails.propertyType = bedBathType.eq(2).text().trim();
            
            const unitRelativeUrl = $unit.attr('href');
            if (unitRelativeUrl) {
                unitDetails.url = `https://www.daft.ie${unitRelativeUrl}`;
                const unitUrlParts = unitRelativeUrl.split('/');
                unitDetails.id = unitUrlParts[unitUrlParts.length -1];
            }
            property.units.push(unitDetails);
          });
           // If there are units, try to set a primary price/beds/baths from the first unit for the main property
          if (property.units.length > 0) {
            property.price = property.units[0].price;
            property.beds = property.units[0].beds;
            property.baths = property.units[0].baths;
            property.propertyType = property.units[0].propertyType;
          }

        } else {
          // Fallback if no specific "unit" structure is found, try to get general card info
          // This part needs to be adapted based on HTML for single listings without the "units" block
          // For now, we'll leave it sparse if no units are found.
          // Example: A single price might be in a different location on the card.
          // property.price = $element.find('some-selector-for-main-price').text().trim();
        }
        
        if (property.id && property.address) { // Add only if essential info is present
            scrapedProperties.push(property);
        }
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(scrapedProperties, null, 2),
          },
        ],
      };
    } catch (error) {
      let errorMessage = `Error during scraping Daft.ie for "${location}"`;
      if (axios.isAxiosError(error)) {
        errorMessage = `Axios error while scraping Daft.ie for "${location}": ${error.message}. Status: ${error.response?.status}. URL: ${error.config?.url}`;
      } else if (error instanceof Error) {
        errorMessage = `Generic error while scraping Daft.ie for "${location}": ${error.message}`;
      }
      console.error(`[search_rental_properties] ${errorMessage}`);
      return {
        content: [
          {
            type: "text",
            text: `${errorMessage}. Received params: ${JSON.stringify(receivedParams)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool for getting rental property details
server.tool(
  "get_rental_property_details",
  {
    property_id: z.string().describe("Unique ID of the rental property"),
  },
  async ({ property_id }) => {
    try {
      // This endpoint is a placeholder. You'll need to consult Daft.ie API docs for the actual details endpoint.
      const response = await daftApi.get(`/listings/${property_id}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return {
          content: [
            {
              type: "text",
              text: `Daft.ie API error: ${
                error.response?.data.message ?? error.message
              }`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  }
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Daft.ie MCP server running on stdio');