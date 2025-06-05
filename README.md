# Daft.ie MCP Server

This is an MCP (Model Context Protocol) server designed to interact with the Daft.ie API, specifically focusing on renting functionalities.

## Features

*   **Search Rental Properties:** Search for rental listings based on various criteria like location, price range, number of bedrooms, and property type.
*   **Get Rental Property Details:** Retrieve detailed information about a specific rental property using its unique ID.

## Setup

1.  **Clone the repository:**
    ```bash
    git clone [YOUR_GITHUB_REPO_URL]
    cd daft-ie-mcp
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Build the server:**
    ```bash
    npm run build
    ```
4.  **Configure MCP Settings:**
    Add the following configuration to your MCP settings file (e.g., `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`):

    ```json
    {
      "mcpServers": {
        "daft-ie-mcp": {
          "command": "node",
          "args": ["~/daft-ie-mcp/build/index.js"],
          "env": {},
          "disabled": false,
          "alwaysAllow": []
        }
      }
    }
    ```

## Usage

Once the MCP server is configured and running, you can use the following tools:

*   `use_mcp_tool` with `server_name: "daft-ie-mcp"` and `tool_name: "search_rental_properties"`
*   `use_mcp_tool` with `server_name: "daft-ie-mcp"` and `tool_name: "get_rental_property_details"`

**Example: Searching for rental properties in Dublin**

```xml
<use_mcp_tool>
<server_name>daft-ie-mcp</server_name>
<tool_name>search_rental_properties</tool_name>
<arguments>
{
  "location": "Dublin",
  "min_price": 1000,
  "max_price": 2000,
  "num_beds": 2
}
</arguments>
</use_mcp_tool>
```

**Example: Getting details for a specific property**

```xml
<use_mcp_tool>
<server_name>daft-ie-mcp</server_name>
<tool_name>get_rental_property_details</tool_name>
<arguments>
{
  "property_id": "1234567"
}
</arguments>
</use_mcp_tool>