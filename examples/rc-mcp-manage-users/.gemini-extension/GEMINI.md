# rc-mcp-manage-users — Rocket.Chat MCP Tools

> Minimal MCP server for Rocket.Chat: manage-users

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

### `users_create`

**Create User**

- **Method:** `POST`
- **Endpoint:** `/api/v1/users.create`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `name` (string, required): The display name of the user.
  - `email` (string, required): The email address for the user.
  - `password` (string, required): The password for the user.
  - `username` (string, required): The username for the user.
  - `active` (boolean, optional): Set the users' active status.  If the user is deactivated, they can not login. By default, the user is active.
  - `nickname` (string, optional): The nickname for the user. 
  - `bio` (string, optional): The bio for the user.
  - `joinDefaultChannels` (boolean, optional): Select whether users should automatically join default channels once they are created. By default, it is set to `true`.
  - `statusText` (string, optional): The status text of the user.
  - `roles` (array, optional): The roles to be assigned to this user. If it is not specified, the `user` role is assigned by default.
**Note:**
* For default roles, the role name and ID are the same. For custom roles, the name and ID are different. 
* If you are setting a custom role for a user, make sure to enter the custom role ID, and not the role name.
Refer to [Roles](https://docs.rocket.chat/use-rocket.chat/workspace-administration/permissions#roles) for more information.
  - `requirePasswordChange` (boolean, optional): Should the user be required to change their password when they login? It is set to `false` by default
  - `setRandomPassword` (boolean, optional): Should the user be assigned a random password once they are created? It is set to `false` by defualt.
  - `sendWelcomeEmail` (boolean, optional): Should the user get a welcome email? It is set to `true` by default.
  - `verified` (boolean, optional): Should the user's email address be verified when created? It is set to `false` by default.
  - `customFields` (object, optional): A valid JSON object of key-value pairs consisting of additional fields to be
added during user registration. By default, the value is `undefined`.
To save custom fields, you must first define them in the [workspace admin settings](https://docs.rocket.chat/use-rocket.chat/workspace-administration/settings/accounts/custom-fields).
For information on how to view the custom fields, see the [Get Users List](https://developer.rocket.chat/reference/api/rest-api/endpoints/user-management/users-endpoints/get-users-list) endpoint.

### `users_update`

**Update User Details**

- **Method:** `POST`
- **Endpoint:** `/api/v1/users.update`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `x-2fa-code` (string, required): Enter the 2FA code. This parameter is required if 2FA is enabled in your workspace. See the <a href="https://developer.rocket.chat/apidocs/introduction-to-two-factor-authentication" target="_blank">Introduction to Two-Factor Authentication</a> document for details.
  - `x-2fa-method` (string, required): Enter the method with which you get the 2FA code. It can be `email`, `totp`, or `password`. This parameter is required if 2FA is enabled in your workspace.
  - `userId` (string, required): The user ID to update. This value must not be empty.
  - `data` (object, required): The object that includes the user information to update with the following parameters. Note: If you provide an empty object, the user details are returned.

### `users_delete`

**Delete User**

- **Method:** `POST`
- **Endpoint:** `/api/v1/users.delete`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `userId` (string, required): The `userId` of the user. Alternatively, you can use the `username` property and value.
  - `confirmRelinquish` (boolean, optional): Deletes the user, even if they are the last owner of a room. By default, it is set to `false`.

### `users_info`

**Get User's Info**

- **Method:** `GET`
- **Endpoint:** `/api/v1/users.info`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `userId` (string, required): The `userId` of the user. Alternatively, you can use the `username` parameter and value.
  - `includeUserRooms` (boolean, optional): Enter whether or not the rooms that the user is a member of are included in the response. To view the list of rooms, you need the `view-other-user-channels` permission.
  - `importId` (string, optional): You can use this parameter to search for users that were imported from external channels, such as Slack. You can also get the value of the import ID using this endpoint if you have the `view-full-other-user-info` permission.

### `users_list`

**Get Users List**

- **Method:** `GET`
- **Endpoint:** `/api/v1/users.list`
- **Auth:** Required (handled automatically)
- **Parameters:**
  - `query` (string, optional): This parameter allows you to use [MongoDB query](https://www.mongodb.com/docs/manual/reference/operator/query/) operators to search for specific data. For example, to query users with a name that contains the letter "g": query=`{ "name": { "$regex": "g" } }`. Refer to the [official documentation](https://developer.rocket.chat/apidocs/query-parameters#query-and-fields) to learn more. 
  - `fields` (string, optional):  This parameter accepts a JSON object with properties that have a value of 1 or 0 to include or exclude them in the response. For example, to only retrieve the usernames of users: fields=`{ "username": 1 }`. Refer to the [official documentation](https://developer.rocket.chat/apidocs/query-parameters#query-and-fields) to learn more.
  - `offset` (integer, optional): Number of items to "skip" in the query, i.e. requests return count items, skipping the first offset items. Refer to the [official documentation](https://developer.rocket.chat/apidocs/query-parameters#pagination) to learn more.
  - `count` (integer, optional): How many items to return. Refer to the [official documentation](https://developer.rocket.chat/apidocs/query-parameters#pagination) to learn more.
  - `sort` (string, optional): Sort the users in ascending (`1`) or descending (`-1`) order. The value must be entered as a JSON string. The options are as follows:
 * `status`: Sort by users' status. For example, `sort={"status":1}` (this maps to the `active` status).
 * `createdAt`: Sort by the time of user creation. For example, `sort={"createdAt":-1}`
 * `sort`: Sort by user name. For example, `sort={"name":1}`

## Usage Guidelines

- Authentication is handled automatically. Do not pass auth headers.
- When sending messages, use the `chat_postMessage` tool with the channel name or ID.
- Channel names should be passed without the `#` prefix.
- The `login` tool is called automatically during server startup — you do not need to call it.
