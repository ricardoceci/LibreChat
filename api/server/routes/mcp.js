const { Router } = require('express');
const { MCPOAuthHandler } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { CacheKeys } = require('librechat-data-provider');
const {
  getCachedMCPs,
  addCachedMCP,
  updateCachedMCP,
  removeCachedMCP,
} = require('~/server/services/Config');
const { requireJwtAuth } = require('~/server/middleware');
const { getFlowStateManager } = require('~/config');
const { getLogStores } = require('~/cache');
// const { getMCPManager } = require('~/server/services/MCP');

const router = Router();

/**
 * Initiate OAuth flow
 * This endpoint is called when the user clicks the auth link in the UI
 */
router.get('/:serverName/oauth/initiate', requireJwtAuth, async (req, res) => {
  try {
    const { serverName } = req.params;
    const { userId, flowId } = req.query;
    const user = req.user;

    // Verify the userId matches the authenticated user
    if (userId !== user.id) {
      return res.status(403).json({ error: 'User mismatch' });
    }

    logger.debug('[MCP OAuth] Initiate request', { serverName, userId, flowId });

    const flowsCache = getLogStores(CacheKeys.FLOWS);
    const flowManager = getFlowStateManager(flowsCache);

    /** Flow state to retrieve OAuth config */
    const flowState = await flowManager.getFlowState(flowId, 'mcp_oauth');
    if (!flowState) {
      logger.error('[MCP OAuth] Flow state not found', { flowId });
      return res.status(404).json({ error: 'Flow not found' });
    }

    const { serverUrl, oauth: oauthConfig } = flowState.metadata || {};
    if (!serverUrl || !oauthConfig) {
      logger.error('[MCP OAuth] Missing server URL or OAuth config in flow state');
      return res.status(400).json({ error: 'Invalid flow state' });
    }

    const { authorizationUrl, flowId: oauthFlowId } = await MCPOAuthHandler.initiateOAuthFlow(
      serverName,
      serverUrl,
      userId,
      oauthConfig,
    );

    logger.debug('[MCP OAuth] OAuth flow initiated', { oauthFlowId, authorizationUrl });

    // Redirect user to the authorization URL
    res.redirect(authorizationUrl);
  } catch (error) {
    logger.error('[MCP OAuth] Failed to initiate OAuth', error);
    res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
});

/**
 * OAuth callback handler
 * This handles the OAuth callback after the user has authorized the application
 */
router.get('/:serverName/oauth/callback', async (req, res) => {
  try {
    const { serverName } = req.params;
    const { code, state, error: oauthError } = req.query;

    logger.debug('[MCP OAuth] Callback received', {
      serverName,
      code: code ? 'present' : 'missing',
      state,
      error: oauthError,
    });

    if (oauthError) {
      logger.error('[MCP OAuth] OAuth error received', { error: oauthError });
      return res.redirect(`/oauth/error?error=${encodeURIComponent(String(oauthError))}`);
    }

    if (!code || typeof code !== 'string') {
      logger.error('[MCP OAuth] Missing or invalid code');
      return res.redirect('/oauth/error?error=missing_code');
    }

    if (!state || typeof state !== 'string') {
      logger.error('[MCP OAuth] Missing or invalid state');
      return res.redirect('/oauth/error?error=missing_state');
    }

    // Extract flow ID from state
    const flowId = state;
    logger.debug('[MCP OAuth] Using flow ID from state', { flowId });

    const flowsCache = getLogStores(CacheKeys.FLOWS);
    const flowManager = getFlowStateManager(flowsCache);

    logger.debug('[MCP OAuth] Getting flow state for flowId: ' + flowId);
    const flowState = await MCPOAuthHandler.getFlowState(flowId, flowManager);

    if (!flowState) {
      logger.error('[MCP OAuth] Flow state not found for flowId:', flowId);
      return res.redirect('/oauth/error?error=invalid_state');
    }

    logger.debug('[MCP OAuth] Flow state details', {
      serverName: flowState.serverName,
      userId: flowState.userId,
      hasMetadata: !!flowState.metadata,
      hasClientInfo: !!flowState.clientInfo,
      hasCodeVerifier: !!flowState.codeVerifier,
    });

    // Complete the OAuth flow
    logger.debug('[MCP OAuth] Completing OAuth flow');
    const tokens = await MCPOAuthHandler.completeOAuthFlow(flowId, code, flowManager);
    logger.info('[MCP OAuth] OAuth flow completed, tokens received in callback route');

    // For system-level OAuth, we need to store the tokens and retry the connection
    if (flowState.userId === 'system') {
      logger.debug(`[MCP OAuth] System-level OAuth completed for ${serverName}`);
    }

    /** ID of the flow that the tool/connection is waiting for */
    const toolFlowId = flowState.metadata?.toolFlowId;
    if (toolFlowId) {
      logger.debug('[MCP OAuth] Completing tool flow', { toolFlowId });
      await flowManager.completeFlow(toolFlowId, 'mcp_oauth', tokens);
    }

    /** Redirect to success page with flowId and serverName */
    const redirectUrl = `/oauth/success?serverName=${encodeURIComponent(serverName)}`;
    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('[MCP OAuth] OAuth callback error', error);
    res.redirect('/oauth/error?error=callback_failed');
  }
});

/**
 * Get OAuth tokens for a completed flow
 * This is primarily for user-level OAuth flows
 */
router.get('/oauth/tokens/:flowId', requireJwtAuth, async (req, res) => {
  try {
    const { flowId } = req.params;
    const user = req.user;

    if (!user?.id) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Allow system flows or user-owned flows
    if (!flowId.startsWith(`${user.id}:`) && !flowId.startsWith('system:')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const flowsCache = getLogStores(CacheKeys.FLOWS);
    const flowManager = getFlowStateManager(flowsCache);

    const flowState = await flowManager.getFlowState(flowId, 'mcp_oauth');
    if (!flowState) {
      return res.status(404).json({ error: 'Flow not found' });
    }

    if (flowState.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Flow not completed' });
    }

    res.json({ tokens: flowState.result });
  } catch (error) {
    logger.error('[MCP OAuth] Failed to get tokens', error);
    res.status(500).json({ error: 'Failed to get tokens' });
  }
});

/**
 * Check OAuth flow status
 * This endpoint can be used to poll the status of an OAuth flow
 */
router.get('/oauth/status/:flowId', async (req, res) => {
  try {
    const { flowId } = req.params;
    const flowsCache = getLogStores(CacheKeys.FLOWS);
    const flowManager = getFlowStateManager(flowsCache);

    const flowState = await flowManager.getFlowState(flowId, 'mcp_oauth');
    if (!flowState) {
      return res.status(404).json({ error: 'Flow not found' });
    }

    res.json({
      status: flowState.status,
      completed: flowState.status === 'COMPLETED',
      failed: flowState.status === 'FAILED',
      error: flowState.error,
    });
  } catch (error) {
    logger.error('[MCP OAuth] Failed to get flow status', error);
    res.status(500).json({ error: 'Failed to get flow status' });
  }
});

/**
 * Get all MCP servers for the authenticated user
 * @route GET /api/mcp
 * @returns {Array} Array of MCP servers
 */
router.get('/', requireJwtAuth, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      logger.warn('MCP servers fetch without user ID');
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Get user-specific MCP servers using the utility function
    const userServers = await getCachedMCPs({ userId });

    res.json(userServers);
  } catch (error) {
    logger.error('Error fetching MCP servers:', error);
    res.status(500).json({ message: 'Failed to fetch MCP servers' });
  }
});

/**
 * Create a new MCP server
 * @route POST /api/mcp/add
 * @param {object} req.body - MCP server data
 * @returns {object} Created MCP server with populated tools
 */
router.post('/add', requireJwtAuth, async (req, res) => {
  try {
    const { body: mcp } = req;
    const userId = req.user?.id;

    if (!userId) {
      logger.warn('MCP server creation without user ID');
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Validate required fields
    if (!mcp?.metadata?.name || !mcp?.metadata?.url) {
      logger.warn('MCP server creation with missing required fields');
      return res
        .status(400)
        .json({ message: 'Missing required fields: name and url are required' });
    }

    // Check if server already exists for this user
    const existingServers = await getCachedMCPs({ userId });
    const serverExists = existingServers.some(
      (server) => server.metadata.name === mcp.metadata.name,
    );

    if (serverExists) {
      logger.warn(`MCP server ${mcp.metadata.name} already exists for user ${userId}`);
      return res.status(409).json({ message: 'MCP server already exists' });
    }

    // TODO: Connect to MCP server and discover tools
    // For now, just gonna leave it empty till biz logic can get plumbed in
    const discoveredTools = []; // This should be populated by connecting to the MCP server

    // Create the MCP server entry
    const mcpServer = {
      mcp_id: mcp.mcp_id || `mcp_${Date.now()}`, // date.now fallback shouldnt ever proc, but leaving for now in case missed something
      metadata: {
        ...mcp.metadata,
        tools: discoveredTools, // Populated by MCP server discovery
      },
      agent_id: '',
    };

    // Add the MCP server to the user's cache using the utility function
    await addCachedMCP(mcpServer, { userId });

    // Add the server configuration to the MCPManager
    // Getting a bit too close to the business logic, so leaving this out for now +
    // idk enough about mcpmanager yet to know if im using it correctly

    // const mcpManager = getMCPManager();
    // const serverConfig = {
    //   customUserVars: mcp.metadata.customHeaders?.reduce((acc, header) => {
    //     acc[header.name] = {
    //       title: header.name,
    //       description: header.description || '',
    //     };
    //     return acc;
    //   }, {}) || {},
    // };
    // mcpManager.addServerConfig(serverName, serverConfig);

    res.status(201).json(mcpServer);
  } catch (error) {
    logger.error('Error creating MCP server:', error);
    res.status(500).json({ message: 'Failed to create MCP server' });
  }
});

/**
 * Update an existing MCP server
 * @route PUT /api/mcp/:mcp_id
 * @param {string} mcp_id - The ID of the MCP server to update
 * @param {object} req.body - Updated MCP server data
 * @returns {object} Updated MCP server with populated tools
 */
router.put('/:mcp_id', requireJwtAuth, async (req, res) => {
  try {
    const {
      body: mcp,
      params: { mcp_id },
    } = req;
    const userId = req.user?.id;

    if (!userId) {
      logger.warn('MCP server update without user ID');
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Validate required fields
    if (!mcp?.metadata?.name || !mcp?.metadata?.url) {
      logger.warn('MCP server update with missing required fields');
      return res
        .status(400)
        .json({ message: 'Missing required fields: name and url are required' });
    }

    if (!mcp_id) {
      logger.warn('MCP server update with missing mcp_id');
      return res.status(400).json({ message: 'Missing required parameter: mcp_id' });
    }

    // Check if server exists before updating
    const existingServers = await getCachedMCPs({ userId });
    const existingServer = existingServers.find((server) => server.mcp_id === mcp_id);

    if (!existingServer) {
      logger.warn(`MCP server ${mcp_id} not found for update for user ${userId}`);
      return res.status(404).json({ message: 'MCP server not found' });
    }

    // TODO: Reconnect to MCP server and rediscover tools
    // For now, we'll keep the existing tools
    const discoveredTools = existingServer.metadata?.tools || [];

    // Create the updated MCP server entry
    const updatedMCP = {
      mcp_id,
      metadata: {
        ...mcp.metadata,
        tools: discoveredTools,
      },
      agent_id: '',
    };

    // Update the MCP server in the user's cache using the utility function
    await updateCachedMCP(mcp_id, updatedMCP, { userId });

    // Update the server configuration in the MCPManager
    // commented out for reason stated in add route^^

    // const mcpManager = getMCPManager();
    // const serverConfig = {
    //   customUserVars:
    //     mcp.metadata.customHeaders?.reduce((acc, header) => {
    //       acc[header.name] = {
    //         title: header.name,
    //         description: header.description || '',
    //       };
    //       return acc;
    //     }, {}) || {},
    // };
    // mcpManager.addServerConfig(mcp.metadata.name, serverConfig);

    res.json(updatedMCP);
  } catch (error) {
    logger.error('Error updating MCP server:', error);
    res.status(500).json({ message: 'Failed to update MCP server' });
  }
});

/**
 * Delete an MCP server
 * @route DELETE /api/mcp/:mcp_id
 * @param {string} mcp_id - The ID of the MCP server to delete
 * @returns {object} Deletion confirmation
 */
router.delete('/:mcp_id', requireJwtAuth, async (req, res) => {
  try {
    const {
      params: { mcp_id },
    } = req;
    const userId = req.user?.id;

    if (!userId) {
      logger.warn('MCP server deletion without user ID');
      return res.status(401).json({ message: 'User not authenticated' });
    }

    if (!mcp_id) {
      logger.warn('MCP server deletion with missing mcp_id');
      return res.status(400).json({ message: 'Missing required parameter: mcp_id' });
    }

    // Check if server exists before deleting
    const existingServers = await getCachedMCPs({ userId });
    const serverExists = existingServers.some((server) => server.mcp_id === mcp_id);

    if (!serverExists) {
      logger.warn(`MCP server ${mcp_id} not found for deletion for user ${userId}`);
      return res.status(404).json({ message: 'MCP server not found' });
    }

    // Remove the MCP server from the user's cache using the utility function
    await removeCachedMCP(mcp_id, { userId });

    res.json({ message: 'MCP server deleted successfully' });
  } catch (error) {
    logger.error('Error deleting MCP server:', error);
    res.status(500).json({ message: 'Failed to delete MCP server' });
  }
});

module.exports = router;
