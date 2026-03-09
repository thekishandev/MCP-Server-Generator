# rc-mcp-send-message — Rocket.Chat MCP Tools

> Minimal MCP server for Rocket.Chat: send-message

This project has a connected Rocket.Chat MCP server providing the following tools.
Use these tools to interact with the Rocket.Chat workspace.

## Available Tools

### `login`

**Login with Username and Password**

- **Method:** `POST`
- **Endpoint:** `/api/v1/login`
- **Parameters:**
  - `user` (string, optional): Your user name or email.
  - `password` (string, optional): Your pasword.
  - `resume` (string, optional): Your previously issued `authToken`.
  - `code` (string, optional): The 2FA code. It is required if your account has two-factor authentication enabled .

### `chat_postMessage`

**Post Message**

- **Method:** `POST`
- **Endpoint:** `/api/v1/chat.postMessage`
- **Auth:** Required (handled automatically)

## Usage Guidelines

- Authentication is handled automatically. Do not pass auth headers.
- When sending messages, use the `chat_postMessage` tool with the channel name or ID.
- Channel names should be passed without the `#` prefix.
- The `login` tool is called automatically during server startup — you do not need to call it.
