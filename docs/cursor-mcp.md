# Model Context Protocol (MCP)

## What is MCP?

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) enables Cursor to connect to external tools and data sources.

### Why use MCP?

MCP connects Cursor to external systems and data. Instead of explaining your project structure repeatedly, integrate directly with your tools.

Write MCP servers in any language that can print to `stdout` or serve an HTTP endpoint - Python, JavaScript, Go, etc.

Browse official plugins in the [Cursor Marketplace](/marketplace). For community plugins and MCP servers, browse [cursor.directory](https://cursor.directory).

### How it works

MCP servers expose capabilities through the protocol, connecting Cursor to external tools or data sources.

Cursor supports three transport methods:

| Transport | Execution environment | Deployment | Users | Input | Auth |
|-----------|----------------------|------------|-------|-------|------|
| **`stdio`** | Local | Cursor manages | Single user | Shell command | Manual |
| **`SSE`** | Local/Remote | Deploy as server | Multiple users | URL to an SSE endpoint | OAuth |
| **`Streamable HTTP`** | Local/Remote | Deploy as server | Multiple users | URL to an HTTP endpoint | OAuth |

### Protocol and extension support

Cursor supports these MCP protocol capabilities and extensions:

FeatureSupportDescription**Tools**SupportedFunctions for the AI model to execute**Prompts**SupportedTemplated messages and workflows for users**Resources**SupportedStructured data sources that can be read and referenced**Roots**SupportedServer-initiated inquiries into URI or filesystem boundaries**Elicitation**SupportedServer-initiated requests for additional information from users**Apps (extension)**SupportedInteractive UI views returned by MCP tools

### MCP apps

Cursor supports the [MCP Apps extension](https://modelcontextprotocol.io/extensions/apps/overview). MCP tools can return interactive UI along with standard tool output.

MCP Apps follow progressive enhancement. If a host cannot render app UI, the same tool still works through normal MCP responses.

## Installing MCP servers

### One-click installation

Browse the [Cursor Marketplace](/marketplace) for official plugins with one-click install. For community plugins and MCP servers, browse [cursor.directory](https://cursor.directory). Click "Add to Cursor" on a marketplace entry to install it and authenticate with OAuth.

### Using mcp.json

Configure custom MCP servers with a JSON file:

CLI Server - Node.js```
{
"mcpServers": {
"server-name": {
"command": "npx",
"args": ["-y", "mcp-server"],
"env": {
"API_KEY": "value"
}
}
}
}

````

CLI Server - Python```
{
  "mcpServers": {
    "server-name": {
      "command": "python",
      "args": ["mcp-server.py"],
      "env": {
        "API_KEY": "value"
      }
    }
  }
}
````

Remote Server```
// MCP server using HTTP or SSE - runs on a server
{
"mcpServers": {
"server-name": {
"url": "http://localhost:3000/mcp",
"headers": {
"API_KEY": "value"
}
}
}
}

````

### Static OAuth for remote servers

For MCP servers that use OAuth, you can provide **static OAuth client credentials** in `mcp.json` instead of dynamic client registration. Use this when:

- The MCP provider gives you a fixed **Client ID** (and optionally **Client Secret**)
- The provider requires **whitelisting a redirect URL** (e.g. Figma, Linear)
- The provider does not support OAuth 2.0 Dynamic Client Registration

Add an `auth` object to remote server entries that use `url`:

Remote Server with Static OAuth```
{
  "mcpServers": {
    "oauth-server": {
      "url": "https://api.example.com/mcp",
      "auth": {
        "CLIENT_ID": "your-oauth-client-id",
        "CLIENT_SECRET": "your-client-secret",
        "scopes": ["read", "write"]
      }
    }
  }
}
````

FieldRequiredDescription**CLIENT_ID**YesOAuth 2.0 Client ID from the MCP provider**CLIENT_SECRET**NoOAuth 2.0 Client Secret (if the provider uses confidential clients)**scopes**NoOAuth scopes to request. If omitted, Cursor will use `/.well-known/oauth-authorization-server` to discover `scopes_supported`

#### Static redirect URL

Cursor uses a **fixed OAuth redirect URL** for all MCP servers:

```
cursor://anysphere.cursor-mcp/oauth/callback
```

When configuring the MCP provider's OAuth app, register this URL as an allowed redirect URI. The server is identified via the OAuth `state` parameter, so one redirect URL works for all MCP servers.

#### Combining with config interpolation

`auth` values support the same interpolation as other fields:

```
{
  "mcpServers": {
    "oauth-server": {
      "url": "https://api.example.com/mcp",
      "auth": {
        "CLIENT_ID": "${env:MCP_CLIENT_ID}",
        "CLIENT_SECRET": "${env:MCP_CLIENT_SECRET}"
      }
    }
  }
}
```

Use environment variables for Client ID and Client Secret instead of hardcoding them.

### STDIO server configuration

For STDIO servers (local command-line servers), configure these fields in your `mcp.json`:

FieldRequiredDescriptionExamples**type**YesServer connection type`"stdio"`**command**YesCommand to start the server executable. Must be available on your system path or contain its full path.`"npx"`, `"node"`, `"python"`, `"docker"`**args**NoArray of arguments passed to the command`["server.py", "--port", "3000"]`**env**NoEnvironment variables for the server`{"API_KEY": "${env:api-key}"}`**envFile**NoPath to an environment file to load more variables`".env"`, `"${workspaceFolder}/.env"`
The `envFile` option is only available for STDIO servers. Remote servers (HTTP/SSE) do not support `envFile`. For remote servers, use [config interpolation](#config-interpolation) with environment variables set in your shell profile or system environment instead.

### Using the Extension API

For programmatic MCP server registration, Cursor provides an extension API that allows dynamic configuration without modifying `mcp.json` files. This is particularly useful for enterprise environments and automated setup workflows.

[MCP Extension API Reference

Learn how to register MCP servers programmatically using
`vscode.cursor.mcp.registerServer()`](/docs/context/mcp-extension-api)

### Configuration locations

- [Project Configuration](): Create .cursor/mcp.json in your project for project-specific tools.
- [Global Configuration](): Create ~/.cursor/mcp.json in your home directory for tools available everywhere.

### Config interpolation

Use variables in `mcp.json` values. Cursor resolves variables in these fields: `command`, `args`, `env`, `url`, and `headers`.

Supported syntax:

- `${env:NAME}` environment variables
- `${userHome}` path to your home folder
- `${workspaceFolder}` project root (the folder that contains `.cursor/mcp.json`)
- `${workspaceFolderBasename}` name of the project root
- `${pathSeparator}` and `${/}` OS path separator

Examples

```
{
  "mcpServers": {
    "local-server": {
      "command": "python",
      "args": ["${workspaceFolder}/tools/mcp_server.py"],
      "env": {
        "API_KEY": "${env:API_KEY}"
      }
    }
  }
}
```

```
{
  "mcpServers": {
    "remote-server": {
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${env:MY_SERVICE_TOKEN}"
      }
    }
  }
}
```

### Authentication

MCP servers use environment variables for authentication. Pass API keys and tokens through the config.

Cursor supports OAuth for servers that require it.

## Using MCP in chat

Agent automatically uses MCP tools listed under `Available Tools` when relevant. This includes [Plan Mode](/docs/agent/plan-mode#plan). Ask for a specific tool by name or describe what you need. Enable or disable tools from settings.

### Tool approval

Agent asks for approval before using MCP tools by default. Click the arrow next to the tool name to see arguments.

#### Auto-run

Enable auto-run for Agent to use MCP tools without asking. Works like terminal commands. Read more about Auto-run settings [here](/docs/agent/overview#auto-run).

To pre-configure which MCP tools can auto-run without using the settings UI, add them to [`~/.cursor/permissions.json`](/docs/reference/permissions).

### Tool response

Cursor shows the response in chat with expandable views of arguments and responses:

### Images as context

MCP servers can return images - screenshots, diagrams, etc. Return them as base64 encoded strings:

```
const RED_CIRCLE_BASE64 = "/9j/4AAQSkZJRgABAgEASABIAAD/2w...";
// ^ full base64 clipped for readability

server.tool("generate_image", async (params) => {
  return {
    content: [
      {
        type: "image",
        data: RED_CIRCLE_BASE64,
        mimeType: "image/jpeg",
      },
    ],
  };
});
```

See this [example server](https://github.com/msfeldstein/mcp-test-servers/blob/main/src/image-server.js) for implementation details. Cursor attaches returned images to the chat. If the model supports images, it analyzes them.

## Security considerations

When installing MCP servers, consider these security practices:

- **Verify the source**: Only install MCP servers from trusted developers and repositories
- **Review permissions**: Check what data and APIs the server will access
- **Limit API keys**: Use restricted API keys with minimal required permissions
- **Audit code**: For critical integrations, review the server's source code

Remember that MCP servers can access external services and execute code on your behalf. Always understand what a server does before installation.

## Real-world examples

For practical examples of MCP in action:

- **[Xcode integration](/docs/integrations/xcode)** — Connect Cursor to Xcode 26.3+ for builds, tests, SwiftUI previews, and Apple documentation search
- **[Web Development guide](/for/web-development)** — Integrate Linear, Figma, and browser tools into your development workflow

## FAQ

**What's the point of MCP servers?**

MCP servers connect Cursor to external tools like Google Drive, Notion, and
other services to bring docs and requirements into your coding workflow.

**How do I debug MCP server issues?**

View MCP logs by:

1. Open the Output panel in Cursor (Cmd+Shift+UCtrl+Shift+U)
2. Select "MCP Logs" from the dropdown
3. Check for connection errors, authentication issues, or server crashes

The logs show server initialization, tool calls, and error messages.

**Can I temporarily disable an MCP server?**

Yes! Toggle servers on/off without removing them:

1. Open Settings (Cmd+Shift+JCtrl+Shift+J)
2. Go to Features → Model Context Protocol
3. Click the toggle next to any server to enable/disable

Disabled servers won't load or appear in chat. This is useful for troubleshooting or reducing tool clutter.

**What happens if an MCP server crashes or times out?**

If an MCP server fails:

- Cursor shows an error message in chat
- The tool call is marked as failed
- You can retry the operation or check logs for details
- Other MCP servers continue working normally

Cursor isolates server failures to prevent one server from affecting others.

**How do I update an MCP server?**

For npm-based servers:

1. Remove the server from settings
2. Clear npm cache: `npm cache clean --force`
3. Re-add the server to get the latest version

For custom servers, update your local files and restart Cursor.

**Can I use MCP servers with sensitive data?**

Yes, but follow security best practices:

- Use environment variables for secrets, never hardcode them
- Run sensitive servers locally with `stdio` transport
- Limit API key permissions to minimum required
- Review server code before connecting to sensitive systems
- Consider running servers in isolated environments
