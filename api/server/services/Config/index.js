const { config } = require('./EndpointService');
const getCachedTools = require('./getCachedTools');
const getCachedMCPs = require('./getCachedMCPs');
const getCustomConfig = require('./getCustomConfig');
const loadCustomConfig = require('./loadCustomConfig');
const loadConfigModels = require('./loadConfigModels');
const loadDefaultModels = require('./loadDefaultModels');
const getEndpointsConfig = require('./getEndpointsConfig');
const loadOverrideConfig = require('./loadOverrideConfig');
const loadAsyncEndpoints = require('./loadAsyncEndpoints');

module.exports = {
  config,
  loadCustomConfig,
  loadConfigModels,
  loadDefaultModels,
  loadOverrideConfig,
  loadAsyncEndpoints,
  ...getCachedTools,
  ...getCachedMCPs,
  ...getCustomConfig,
  ...getEndpointsConfig,
};
