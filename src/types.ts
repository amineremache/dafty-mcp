import { z } from 'zod';

// Schema for the search_rental_properties tool
export const SearchRentalPropertiesInputSchema = z.object({
  location: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('Location or locations (e.g., Dublin, Cork, specific address) - Defaults to all Ireland if omitted'),
  min_price: z.number().optional().describe('Minimum price per month'),
  max_price: z.number().optional().describe('Maximum price per month'),
  num_beds: z.number().optional().describe('Number of bedrooms (for scraping, 1 means 1-2 beds)'),
  property_type: z.string().optional().describe('Type of property (e.g., apartment, house)'),
});

// Inferred type from the schema
export type SearchRentalPropertiesParams = z.infer<typeof SearchRentalPropertiesInputSchema>;

// Schema for the get_rental_property_details tool
export const GetRentalPropertyDetailsInputSchema = z.object({
  property_id: z.string().describe('Unique ID of the rental property'),
});

// Inferred type from the schema
export type GetRentalPropertyDetailsParams = z.infer<typeof GetRentalPropertyDetailsInputSchema>;

// Generic interfaces for parsed data
export interface ParsedPriceResult {
  value: number | null;
  type: 'numeric' | 'on_application' | 'unknown';
}

export interface ParsedBedsResult {
  min: number;
  max: number;
  isStudio?: boolean;
}
