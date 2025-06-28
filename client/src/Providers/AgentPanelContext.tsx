import React, { createContext, useContext, useState, useMemo } from 'react';
import { Constants, EModelEndpoint } from 'librechat-data-provider';
import type { TPlugin, AgentToolType, Action, MCP } from 'librechat-data-provider';
import type { AgentPanelContextType } from '~/common';
import { useAvailableToolsQuery, useGetActionsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { Panel } from '~/common';
import { useAvailableMCPsQuery } from '~/data-provider/queries';

const AgentPanelContext = createContext<AgentPanelContextType | undefined>(undefined);

export function useAgentPanelContext() {
  const context = useContext(AgentPanelContext);
  if (context === undefined) {
    throw new Error('useAgentPanelContext must be used within an AgentPanelProvider');
  }
  return context;
}

/** Houses relevant state for the Agent Form Panels (formerly 'commonProps') */
export function AgentPanelProvider({ children }: { children: React.ReactNode }) {
  const localize = useLocalize();
  const [mcp, setMcp] = useState<MCP | undefined>(undefined);
  const [mcps, setMcps] = useState<MCP[] | undefined>(undefined);
  const [action, setAction] = useState<Action | undefined>(undefined);
  const [activePanel, setActivePanel] = useState<Panel>(Panel.builder);
  const [agent_id, setCurrentAgentId] = useState<string | undefined>(undefined);

  const { data: actions } = useGetActionsQuery(EModelEndpoint.agents, {
    enabled: !!agent_id,
  });

  const { data: pluginTools } = useAvailableToolsQuery(EModelEndpoint.agents, {
    enabled: !!agent_id,
  });

  const { data: availableMCPs } = useAvailableMCPsQuery();

  const tools =
    pluginTools?.map((tool) => ({
      tool_id: tool.pluginKey,
      metadata: tool as TPlugin,
      agent_id: agent_id || '',
    })) || [];

  // Add new MCP servers to the tools array
  const newMCPTools =
    availableMCPs?.map((mcp) => ({
      tool_id: `${mcp.metadata.name}${Constants.mcp_delimiter}${mcp.metadata.name}`,
      metadata: {
        name: mcp.metadata.name,
        description: mcp.metadata.description || '',
        icon: mcp.metadata.icon || '',
        pluginKey: `${mcp.metadata.name}${Constants.mcp_delimiter}${mcp.metadata.name}`,
      } as TPlugin,
      agent_id: agent_id || '',
    })) || [];

  const allTools = [...tools, ...newMCPTools];

  const groupedTools = useMemo(() => {
    const acc: Record<string, AgentToolType & { tools?: AgentToolType[] }> = {};
    const serverGroups: Record<string, AgentToolType[]> = {};

    // First pass: collect all tools by server
    allTools.forEach((tool) => {
      if (tool.tool_id.includes(Constants.mcp_delimiter)) {
        const [_toolName, serverName] = tool.tool_id.split(Constants.mcp_delimiter);
        const groupKey = `${serverName.toLowerCase()}`;
        if (!serverGroups[groupKey]) {
          serverGroups[groupKey] = [];
        }
        serverGroups[groupKey].push({
          tool_id: tool.tool_id,
          metadata: tool.metadata,
          agent_id: agent_id || '',
        });
      } else {
        acc[tool.tool_id] = {
          tool_id: tool.tool_id,
          metadata: tool.metadata,
          agent_id: agent_id || '',
        };
      }
    });

    // Second pass: create groups only for servers with multiple tools
    Object.entries(serverGroups).forEach(([groupKey, tools]) => {
      if (tools.length === 1) {
        // Single tool: add as individual tool, not as group
        const tool = tools[0];
        acc[tool.tool_id] = {
          tool_id: tool.tool_id,
          metadata: tool.metadata,
          agent_id: agent_id || '',
        };
      } else {
        // Multiple tools: create group
        const serverName = tools[0].tool_id.split(Constants.mcp_delimiter)[1];
        acc[groupKey] = {
          tool_id: groupKey,
          metadata: {
            name: `${serverName}`,
            pluginKey: groupKey,
            description: `${localize('com_ui_tool_collection_prefix')} ${serverName}`,
            icon: tools[0].metadata.icon || '',
          } as TPlugin,
          agent_id: agent_id || '',
          tools: tools,
        };
      }
    });

    return acc;
  }, [allTools, agent_id, localize]);

  const value = {
    action,
    setAction,
    mcp,
    setMcp,
    mcps,
    setMcps,
    activePanel,
    setActivePanel,
    setCurrentAgentId,
    agent_id,
    groupedTools,
    /** Query data for actions and tools */
    actions,
    tools,
    availableMCPs,
  };

  return <AgentPanelContext.Provider value={value}>{children}</AgentPanelContext.Provider>;
}
