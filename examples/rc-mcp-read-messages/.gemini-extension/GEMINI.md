# rc-mcp-read-messages — Rocket.Chat MCP Tools

> Minimal MCP server for Rocket.Chat: read-messages

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

### `channels_history`

**Get Channel History**

- **Method:** `GET`
- **Endpoint:** `/api/v1/channels.history`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `roomId` (string, optional): The room ID. It is required if the `roomName` is not provided.
  - `roomName` (string, optional): The room name.  It is required if the `roomId` is not provided.
  - `sort` (string, optional): List of fields to order by, and in which direction. This is a JSON object, with properties listed in desired order, with values of 1 for ascending, or -1 for descending. For example, {"value": -1, "_id": 1}. Refer to the [official documentation](https://developer.rocket.chat/apidocs/query-parameters#pagination) to learn more.
  - `count` (integer, optional): The number of items to return. Refer to the [official documentation](https://developer.rocket.chat/apidocs/query-parameters#pagination) to learn more.
  - `offset` (integer, optional): Number of items to "skip" in the query, i.e. requests return count items, skipping the first offset items. Refer to the [official documentation](https://developer.rocket.chat/apidocs/query-parameters#pagination) to learn more.
  - `latest` (string, optional): The end of time range of messages to retrieve. The default value is the current date and time.
  - `oldest` (string, optional): The start of the time range of messages to retrieve
  - `inclusive` (boolean, optional): Whether messages which land on the latest and oldest dates should be included. The default value is false.
  - `showThreadMessages` (boolean, optional): Whether thread messages should be included in the response
  - `unreads` (boolean, optional): Whether the number of unread messages should be included. The default value is false.

### `chat_search`

**Search Message**

- **Method:** `GET`
- **Endpoint:** `/api/v1/chat.search`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `count` (integer, optional): The number of items to return.  Refer to the [official documentation](https://developer.rocket.chat/apidocs/query-parameters#pagination) to learn more.
  - `offset` (integer, optional): Number of items to "skip" in the query, i.e. requests return count items, skipping the first offset items. Refer to the [official documentation](https://developer.rocket.chat/apidocs/query-parameters#pagination) to learn more.
  - `roomId` (string, required): The room ID.
  - `searchText` (string, required): The text to search for in messages.

### `chat_getMessage`

**Get Message**

- **Method:** `GET`
- **Endpoint:** `/api/v1/chat.getMessage`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `msgId` (string, required): The message ID.

## Usage Guidelines

- Authentication is handled automatically. Do not pass auth headers.
- When sending messages, use the `chat_postMessage` tool with the channel name or ID.
- Channel names should be passed without the `#` prefix.
- The `login` tool is called automatically during server startup — you do not need to call it.
