import axios, { AxiosInstance, AxiosError } from 'axios'; // AxiosInstance is not used here, can be removed if daftApi is not exported/used elsewhere
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
// Import the Zod-inferred type from index.ts (or a future shared types.ts)
import type { GetRentalPropertyDetailsParams } from "./index.js";

// Create axios instance for Daft.ie API
// IMPORTANT: The Daft.ie v3 API likely requires an API key for most (if not all) operations.
// Without a valid key (set via DAFT_API_KEY environment variable), requests will likely fail (e.g., 403 Forbidden).
// This functionality is likely disabled for general use as API keys are typically restricted.
export const daftApi = axios.create({
  baseURL: process.env.DAFT_API_BASE_URL || 'https://api.daft.ie/v3',
  headers: {
    'Content-Type': 'application/json',
    // Authorization header will be added dynamically if DAFT_API_KEY is present
  },
});

// Add Authorization header if API key is provided
if (process.env.DAFT_API_KEY) {
  daftApi.defaults.headers.common['Authorization'] = `Bearer ${process.env.DAFT_API_KEY}`;
  console.error('[daftApi] DAFT_API_KEY found, Authorization header will be used for API calls.');
} else {
  console.error('[daftApi] DAFT_API_KEY not found. API calls may be unauthorized and fail.');
}

export async function handleGetRentalPropertyDetailsApi(
  { property_id }: GetRentalPropertyDetailsParams
): Promise<{ content: TextContent[]; isError?: boolean }> {
  console.error(`--- daftApi: handleGetRentalPropertyDetailsApi CALLED for ID: ${property_id} ---`);
  try {
    // This endpoint is a placeholder from the original code.
    // Consult Daft.ie API docs for the actual details endpoint if using the API.
    const response = await daftApi.get(`/listings/${property_id}`);
    console.error(`[daftApi] API call for property ID ${property_id} successful. Status: ${response.status}`);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  } catch (error) {
    let errorMessage = `Error fetching details for property ID "${property_id}" from Daft.ie API`;
    if (axios.isAxiosError(error)) {
      errorMessage = `Daft.ie API error for property ID "${property_id}": ${error.response?.data?.message || error.message}. Status: ${error.response?.status}`;
    } else if (error instanceof Error) {
      errorMessage = `Generic error for property ID "${property_id}" using Daft.ie API: ${error.message}`;
    }
    console.error(`[daftApi] ${errorMessage}`);
    return {
      content: [
        {
          type: "text",
          text: errorMessage,
        },
      ],
      isError: true,
    };
  }
}