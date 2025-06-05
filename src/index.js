#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from 'axios';
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
server.tool("search_rental_properties", {
    location: z.string().describe("Location (e.g., Dublin, Cork, specific address)"),
    min_price: z.number().optional().describe("Minimum price per month"),
    max_price: z.number().optional().describe("Maximum price per month"),
    num_beds: z.number().optional().describe("Number of bedrooms"),
    property_type: z.string().optional().describe("Type of property (e.g., apartment, house)"),
}, async ({ location, min_price, max_price, num_beds, property_type }) => {
    try {
        const params = {
            query: location,
            section: 'rent', // Focus on renting
        };
        if (min_price)
            params.min_price = min_price;
        if (max_price)
            params.max_price = max_price;
        if (num_beds)
            params.num_beds = num_beds;
        if (property_type)
            params.property_type = property_type;
        // This endpoint is a placeholder. You'll need to consult Daft.ie API docs for the actual search endpoint.
        const response = await daftApi.post('/listings', params);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(response.data, null, 2),
                },
            ],
        };
    }
    catch (error) {
        if (axios.isAxiosError(error)) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Daft.ie API error: ${error.response?.data.message ?? error.message}`,
                    },
                ],
                isError: true,
            };
        }
        throw error;
    }
});
// Tool for getting rental property details
server.tool("get_rental_property_details", {
    property_id: z.string().describe("Unique ID of the rental property"),
}, async ({ property_id }) => {
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
    }
    catch (error) {
        if (axios.isAxiosError(error)) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Daft.ie API error: ${error.response?.data.message ?? error.message}`,
                    },
                ],
                isError: true,
            };
        }
        throw error;
    }
});
// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Daft.ie MCP server running on stdio');
