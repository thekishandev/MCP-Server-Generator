# rc-mcp-manage-channels-send-message — Rocket.Chat MCP Tools

> Minimal MCP server for Rocket.Chat: manage-channels, send-message

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

### `channels_create`

**Create Channel**

- **Method:** `POST`
- **Endpoint:** `/api/v1/channels.create`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `name` (string, required): The name of the channel.
  - `members` (array, optional): An array of the users to be added to the channel when it is created.
  - `readOnly` (boolean, optional): Set if the channel is read only or not. It is `false` by default.
  - `excludeSelf` (boolean, optional): If set to true, the user calling the endpoint is not automatically added as a member of the channel. The default `value` is false.
  - `customFields` (object, optional): If you have defined custom fields for your workspace, you can provide them in this object parameter. For details, see the <a href='https://docs.rocket.chat/docs/custom-fields' target='_blank'>Custom Fields</a> document.
  - `extraData` (object, optional): Enter the following details for the object:
- `broadcast`: Whether the channel should be a broadcast room.
- `encrypted`: Whether the channel should be encrypted.
- `teamId`: Enter an existing team ID for this channel. You need the `create-team-channel` permission to add a team to a channel.

For more information, see <a href='https://docs.rocket.chat/use-rocket.chat/user-guides/rooms/channels#channel-privacy-and-encryption' target='_blank'>Channels</a>

### `channels_archive`

**Archive Channel**

- **Method:** `POST`
- **Endpoint:** `/api/v1/channels.archive`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `roomId` (string, required): The channel ID that you want to archive.

### `channels_unarchive`

**Unarchive a Channel**

- **Method:** `POST`
- **Endpoint:** `/api/v1/channels.unarchive`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `roomId` (string, optional): The channel ID that you want to unarchive.

### `channels_rename`

**Rename a Channel**

- **Method:** `POST`
- **Endpoint:** `/api/v1/channels.rename`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `roomId` (string, required): The channel's ID.
  - `name` (string, required): The new name of the channel. It can not be the same as the current name.

### `channels_setDescription`

**Set Channel Description**

- **Method:** `POST`
- **Endpoint:** `/api/v1/channels.setDescription`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `roomId` (string, required): The channel ID.
  - `description` (string, required): The description to set for the channel.

### `channels_info`

**Get Channel Information**

- **Method:** `GET`
- **Endpoint:** `/api/v1/channels.info`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `roomId` (string, optional): The room ID. It is required if the `roomName` is not provided.
  - `roomName` (string, optional): The room name.  It is required if the `roomId` is not provided.

### `channels_list`

**Get Channel List**

- **Method:** `GET`
- **Endpoint:** `/api/v1/channels.list`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `offset` (integer, optional): Number of items to "skip" in the query, i.e. requests return count items, skipping the first offset items. Refer to the [official documentation](https://developer.rocket.chat/apidocs/query-parameters#pagination) to learn more.
  - `count` (integer, optional): The number of items to return. Refer to the [official documentation](https://developer.rocket.chat/apidocs/query-parameters#pagination) to learn more.
  - `query` (string, optional): This parameter allows you to use MongoDB query operators to search for specific data. For example, to query users with a name that contains the letter "g": `query={ "name": { "$regex": "g" } }`. Refer to the [official documentation](https://developer.rocket.chat/apidocs/query-parameters#query-and-fields) to learn more.
  - `fields` (string, optional): This parameter accepts a JSON object with properties that have a value of 1 or 0 to include or exclude them in the response. For example, to only retrieve the usernames of users: `fields={ "username": 1 }`. Refer to the [official documentation](https://developer.rocket.chat/apidocs/query-parameters#query-and-fields) to learn more.
  - `sort` (string, optional): Sort the channels in ascending (`1`) or descending (`-1`) order. The value must be entered as a JSON object. The options are as follows:
 * `name`: Sort by the channel name. For example, `sort={"name":1}` (this is the default sorting mechanism).
 * `ts`: Sort by channel creation timestamp. For example, `sort={"ts":-1}`
 * `usersCount`: Sort by the number of users in the channel. For example, `sort={"usersCount":1}`

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
