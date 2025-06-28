const { CacheKeys } = require('librechat-data-provider');
const getLogStores = require('~/cache/getLogStores');

/**
 * Cache key generators for MCP server access patterns
 */
const MCPCacheKeys = {
  /** MCP servers for a specific user */
  USER: (userId) => `${userId}:mcp_servers`,
};

/**
 * Retrieves MCP servers from cache for a specific user
 * @function getCachedMCPs
 * @param {Object} options - Options for retrieving MCP servers
 * @param {string} options.userId - User ID for user-specific MCP servers
 * @returns {Promise<Array|null>} The available MCP servers array or null if not cached
 */
async function getCachedMCPs(options = {}) {
  const cache = getLogStores(CacheKeys.MCP_SERVERS);
  const { userId } = options;

  if (!userId) {
    throw new Error('User ID is required to retrieve MCP servers');
  }

  const userServers = await cache.get(MCPCacheKeys.USER(userId));
  return userServers || [];
}

/**
 * Sets MCP servers in cache for a specific user
 * @function setCachedMCPs
 * @param {Array} mcpServers - The MCP servers array to cache
 * @param {Object} options - Options for caching MCP servers
 * @param {string} options.userId - User ID for user-specific MCP servers
 * @param {number} [options.ttl] - Time to live in milliseconds
 * @returns {Promise<boolean>} Whether the operation was successful
 */
async function setCachedMCPs(mcpServers, options = {}) {
  const cache = getLogStores(CacheKeys.MCP_SERVERS);
  const { userId, ttl } = options;

  if (!userId) {
    throw new Error('User ID is required to cache MCP servers');
  }

  return await cache.set(MCPCacheKeys.USER(userId), mcpServers, ttl);
}

/**
 * Adds a single MCP server to the user's cache
 * @function addCachedMCP
 * @param {Object} mcpServer - The MCP server to add
 * @param {Object} options - Options for caching
 * @param {string} options.userId - User ID for user-specific MCP servers
 * @param {number} [options.ttl] - Time to live in milliseconds
 * @returns {Promise<boolean>} Whether the operation was successful
 */
async function addCachedMCP(mcpServer, options = {}) {
  const { userId, ttl } = options;

  if (!userId) {
    throw new Error('User ID is required to add MCP server');
  }

  const existingServers = await getCachedMCPs({ userId });
  const updatedServers = [...existingServers, mcpServer];

  return await setCachedMCPs(updatedServers, { userId, ttl });
}

/**
 * Updates a single MCP server in the user's cache
 * @function updateCachedMCP
 * @param {string} mcpId - The ID of the MCP server to update
 * @param {Object} updatedMCP - The updated MCP server data
 * @param {Object} options - Options for caching
 * @param {string} options.userId - User ID for user-specific MCP servers
 * @param {number} [options.ttl] - Time to live in milliseconds
 * @returns {Promise<boolean>} Whether the operation was successful
 */
async function updateCachedMCP(mcpId, updatedMCP, options = {}) {
  const { userId, ttl } = options;

  if (!userId) {
    throw new Error('User ID is required to update MCP server');
  }

  const existingServers = await getCachedMCPs({ userId });
  const serverIndex = existingServers.findIndex((server) => server.mcp_id === mcpId);

  if (serverIndex === -1) {
    throw new Error(`MCP server with ID ${mcpId} not found for user ${userId}`);
  }

  const updatedServers = [...existingServers];
  updatedServers[serverIndex] = updatedMCP;

  return await setCachedMCPs(updatedServers, { userId, ttl });
}

/**
 * Removes a single MCP server from the user's cache
 * @function removeCachedMCP
 * @param {string} mcpId - The ID of the MCP server to remove
 * @param {Object} options - Options for caching
 * @param {string} options.userId - User ID for user-specific MCP servers
 * @param {number} [options.ttl] - Time to live in milliseconds
 * @returns {Promise<boolean>} Whether the operation was successful
 */
async function removeCachedMCP(mcpId, options = {}) {
  const { userId, ttl } = options;

  if (!userId) {
    throw new Error('User ID is required to remove MCP server');
  }

  const existingServers = await getCachedMCPs({ userId });
  const updatedServers = existingServers.filter((server) => server.mcp_id !== mcpId);

  return await setCachedMCPs(updatedServers, { userId, ttl });
}

/**
 * Invalidates cached MCP servers for a user
 * @function invalidateCachedMCPs
 * @param {Object} options - Options for invalidating MCP servers
 * @param {string} options.userId - User ID to invalidate
 * @returns {Promise<void>}
 */
async function invalidateCachedMCPs(options = {}) {
  const cache = getLogStores(CacheKeys.MCP_SERVERS);
  const { userId } = options;

  if (!userId) {
    throw new Error('User ID is required to invalidate MCP servers');
  }

  await cache.delete(MCPCacheKeys.USER(userId));
}

/**
 * Gets MCP servers for a request (convenience function)
 * @function getMCPsForRequest
 * @param {Object} req - Express request object
 * @returns {Promise<Array>} The available MCP servers for the user
 */
async function getMCPsForRequest(req) {
  const userId = req.user?.id;
  if (!userId) {
    return [];
  }

  return await getCachedMCPs({ userId });
}

module.exports = {
  getCachedMCPs,
  setCachedMCPs,
  addCachedMCP,
  updateCachedMCP,
  removeCachedMCP,
  invalidateCachedMCPs,
  getMCPsForRequest,
};
