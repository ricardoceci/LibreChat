import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useRecoilState } from 'recoil';
import { Constants, LocalStorageKeys, EModelEndpoint } from 'librechat-data-provider';
import type { TPlugin, MCP } from 'librechat-data-provider';
import { useAvailableToolsQuery } from '~/data-provider';
import { useAvailableMCPsQuery } from '~/data-provider/queries';
import useLocalStorage from '~/hooks/useLocalStorageAlt';
import { ephemeralAgentByConvoId } from '~/store';

const storageCondition = (value: unknown, rawCurrentValue?: string | null) => {
  if (rawCurrentValue) {
    try {
      const currentValue = rawCurrentValue?.trim() ?? '';
      if (currentValue.length > 2) {
        return true;
      }
    } catch (e) {
      console.error(e);
    }
  }
  return Array.isArray(value) && value.length > 0;
};

interface UseMCPSelectOptions {
  conversationId?: string | null;
}

export function useMCPSelect({ conversationId }: UseMCPSelectOptions) {
  const key = conversationId ?? Constants.NEW_CONVO;
  const hasSetFetched = useRef<string | null>(null);
  const [ephemeralAgent, setEphemeralAgent] = useRecoilState(ephemeralAgentByConvoId(key));

  // Get old TPlugin-based MCPs
  const { data: mcpToolDetails, isFetched: toolsFetched } = useAvailableToolsQuery(
    EModelEndpoint.agents,
    {
      select: (data: TPlugin[]) => {
        const mcpToolsMap = new Map<string, TPlugin>();
        data.forEach((tool) => {
          const isMCP = tool.pluginKey.includes(Constants.mcp_delimiter);
          if (isMCP && tool.chatMenu !== false) {
            const parts = tool.pluginKey.split(Constants.mcp_delimiter);
            const serverName = parts[parts.length - 1];
            if (!mcpToolsMap.has(serverName)) {
              mcpToolsMap.set(serverName, {
                name: serverName,
                pluginKey: tool.pluginKey,
                authConfig: tool.authConfig,
                authenticated: tool.authenticated,
              });
            }
          }
        });

        const result = Array.from(mcpToolsMap.values());
        return result;
      },
    },
  );

  // Get new MCP servers from the dedicated cache
  const { data: mcpServers, isFetched: serversFetched } = useAvailableMCPsQuery({
    select: (data: MCP[]) => {
      const result = data.map((mcp) => ({
        name: mcp.metadata.name,
        pluginKey: `${mcp.metadata.name}${Constants.mcp_delimiter}${mcp.metadata.name}`,
        authConfig:
          mcp.metadata.customHeaders?.map((header) => ({
            authField: header.name,
            label: header.name,
            description: '', // customHeaders don't have description field
          })) || [],
        authenticated: false,
      }));
      return result;
    },
  });

  // Combine both sources, prioritizing new MCP servers over old ones
  const combinedMCPTools = useMemo(() => {
    const newMCPMap = new Map<string, any>();
    const oldMCPMap = new Map<string, any>();

    // Add new MCP servers first
    (mcpServers || []).forEach((server) => {
      if (server.name) {
        newMCPMap.set(server.name, server);
      }
    });

    // Add old TPlugin MCPs (only if not already present from new MCPs)
    (mcpToolDetails || []).forEach((tool) => {
      if (tool.name && !newMCPMap.has(tool.name)) {
        oldMCPMap.set(tool.name, tool);
      }
    });

    // Combine both maps
    const combined = [...newMCPMap.values(), ...oldMCPMap.values()];
    return combined;
  }, [mcpServers, mcpToolDetails]);

  const isFetched = toolsFetched && serversFetched;

  const mcpState = useMemo(() => {
    return ephemeralAgent?.mcp ?? [];
  }, [ephemeralAgent?.mcp]);

  const setSelectedValues = useCallback(
    (values: string[] | null | undefined) => {
      if (!values) {
        return;
      }
      if (!Array.isArray(values)) {
        return;
      }
      setEphemeralAgent((prev) => ({
        ...prev,
        mcp: values,
      }));
    },
    [setEphemeralAgent],
  );

  const [mcpValues, setMCPValues] = useLocalStorage<string[]>(
    `${LocalStorageKeys.LAST_MCP_}${key}`,
    mcpState,
    setSelectedValues,
    storageCondition,
  );

  const [isPinned, setIsPinned] = useLocalStorage<boolean>(
    `${LocalStorageKeys.PIN_MCP_}${key}`,
    true,
  );

  useEffect(() => {
    if (hasSetFetched.current === key) {
      return;
    }
    if (!isFetched) {
      return;
    }
    hasSetFetched.current = key;
    if ((combinedMCPTools?.length ?? 0) > 0) {
      setMCPValues(mcpValues.filter((mcp) => combinedMCPTools?.some((tool) => tool.name === mcp)));
      return;
    }
    setMCPValues([]);
  }, [isFetched, setMCPValues, combinedMCPTools, key, mcpValues]);

  const mcpServerNames = useMemo(() => {
    return (combinedMCPTools ?? []).map((tool) => tool.name);
  }, [combinedMCPTools]);

  return {
    isPinned,
    mcpValues,
    setIsPinned,
    setMCPValues,
    mcpServerNames,
    ephemeralAgent,
    mcpToolDetails: combinedMCPTools,
    setEphemeralAgent,
  };
}
