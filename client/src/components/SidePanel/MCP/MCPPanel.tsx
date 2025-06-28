import { ChevronLeft, Trash2 } from 'lucide-react';
import { Constants } from 'librechat-data-provider';
import { useForm, Controller } from 'react-hook-form';
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useUpdateUserPluginsMutation } from 'librechat-data-provider/react-query';
import type { TUpdateUserPlugins } from 'librechat-data-provider';
import type { MCP } from 'librechat-data-provider';
// import { useDeleteMCPMutation } from '~/data-provider';
import { useDeleteMCPMutation } from '~/data-provider/MCPs/mutations';
import { Button, Input, Label, OGDialog, OGDialogTrigger, OGDialogTemplate } from '~/components/ui';
import { useAvailableAgentToolsQuery } from '~/data-provider/Agents/queries';
import { useGetStartupConfig } from '~/data-provider';
import MCPPanelSkeleton from './MCPPanelSkeleton';
import { useToastContext } from '~/Providers';
import MCPFormPanel from './MCPFormPanel';
import { useLocalize } from '~/hooks';
import { useAvailableMCPsQuery } from '~/data-provider/queries';

type MCPWithExtras = MCP & {
  isUserCreated: boolean;
  customUserVars?: Record<string, { title: string; description: string }>;
};

export default function MCPPanel() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: startupConfig, isLoading: startupConfigLoading } = useGetStartupConfig();
  const { data: availableTools, isLoading: toolsLoading } = useAvailableAgentToolsQuery();
  const { data: availableMCPs, isLoading: availableMCPsLoading } = useAvailableMCPsQuery();
  const [selectedServerNameForEditing, setSelectedServerNameForEditing] = useState<string | null>(
    null,
  );
  const [showMCPForm, setShowMCPForm] = useState(false);
  const [editingMCP, setEditingMCP] = useState<any>(null);

  const mcpServerDefinitions = useMemo(() => {
    if (!startupConfig?.mcpServers) {
      return [];
    }
    return Object.entries(startupConfig.mcpServers)
      .filter(
        ([, serverConfig]) =>
          serverConfig.customUserVars && Object.keys(serverConfig.customUserVars).length > 0,
      )
      .map(([serverName, config]) => ({
        serverName,
        iconPath: null,
        config: {
          ...config,
          customUserVars: config.customUserVars ?? {},
        },
      }));
  }, [startupConfig?.mcpServers]);

  // Filter MCP tools from available tools (user-created MCP servers)
  const mcpTools = useMemo(() => {
    if (!availableTools) return [];

    // Use the same filtering logic as MCPSelect
    const mcpToolsMap = new Map<string, any>();
    availableTools.forEach((tool) => {
      const isMCP = tool.pluginKey.includes(Constants.mcp_delimiter);
      if (isMCP && tool.chatMenu !== false) {
        const parts = tool.pluginKey.split(Constants.mcp_delimiter);
        const serverName = parts[parts.length - 1];
        if (serverName && !mcpToolsMap.has(serverName)) {
          mcpToolsMap.set(serverName, {
            name: serverName,
            pluginKey: tool.pluginKey,
            authConfig: tool.authConfig,
            authenticated: tool.authenticated,
            icon: tool.icon,
          });
        }
      }
    });

    return Array.from(mcpToolsMap.values());
  }, [availableTools]);

  // Process new MCP servers from the dedicated cache
  const newMCPServers = useMemo(() => {
    if (!availableMCPs) return [];

    return availableMCPs
      .filter((mcp) => mcp.metadata.name) // Filter out MCPs without names
      .map((mcp) => ({
        mcp_id: mcp.mcp_id, // Use the actual mcp_id from backend
        name: mcp.metadata.name!,
        pluginKey: `${mcp.metadata.name}${Constants.mcp_delimiter}${mcp.metadata.name}`,
        authConfig:
          mcp.metadata.customHeaders?.map((header) => ({
            authField: header.name,
            label: header.name,
            description: '',
          })) || [],
        authenticated: false, // TODO: Check authentication status
        icon: mcp.metadata.icon || '',
      }));
  }, [availableMCPs]);

  // Combine startup config MCP servers with user-created MCP tools and new MCP servers
  const allMCPServers = useMemo(() => {
    const serverSet = new Set<string>();
    const servers: MCPWithExtras[] = [];

    // Add startup config servers first
    mcpServerDefinitions.forEach((server) => {
      if (!serverSet.has(server.serverName)) {
        serverSet.add(server.serverName);
        servers.push({
          mcp_id: server.serverName,
          agent_id: '',
          metadata: {
            name: server.serverName,
            description: '',
            url: '',
            icon: server.iconPath || '',
            tools: [],
            trust: false,
            customHeaders: [],
            requestTimeout: undefined,
            connectionTimeout: undefined,
          },
          isUserCreated: false,
          customUserVars: server.config.customUserVars || {},
        });
      }
    });

    // Add new MCP servers (prioritize over old ones)
    newMCPServers.forEach((server) => {
      if (!serverSet.has(server.name)) {
        serverSet.add(server.name);

        // Find the actual MCP data from availableMCPs
        const actualMCP = availableMCPs?.find((mcp) => mcp.mcp_id === server.mcp_id);

        servers.push({
          mcp_id: server.mcp_id, // Use the actual mcp_id from backend
          agent_id: actualMCP?.agent_id || '',
          metadata: {
            name: server.name,
            description: actualMCP?.metadata.description || '',
            url: actualMCP?.metadata.url || '',
            icon: actualMCP?.metadata.icon || server.icon || '',
            tools: actualMCP?.metadata.tools || [],
            trust: actualMCP?.metadata.trust || false,
            customHeaders:
              actualMCP?.metadata.customHeaders ||
              server.authConfig.map((auth) => ({
                id: auth.authField,
                name: auth.authField,
                value: '',
              })),
            requestTimeout: actualMCP?.metadata.requestTimeout,
            connectionTimeout: actualMCP?.metadata.connectionTimeout,
          },
          isUserCreated: true,
          customUserVars: server.authConfig.reduce(
            (acc, auth) => {
              acc[auth.authField] = {
                title: auth.label || auth.authField,
                description: auth.description || '',
              };
              return acc;
            },
            {} as Record<string, { title: string; description: string }>,
          ),
        });
      }
    });

    // Add old TPlugin MCPs (only if not already present from new MCPs)
    mcpTools.forEach((tool) => {
      if (!serverSet.has(tool.name)) {
        serverSet.add(tool.name);
        servers.push({
          mcp_id: tool.name, // Use name as mcp_id for now
          agent_id: '', // Empty for general chat use
          metadata: {
            name: tool.name,
            description: '',
            url: '',
            icon: tool.icon || '',
            tools: [],
            trust: false,
            customHeaders: [],
            requestTimeout: undefined,
            connectionTimeout: undefined,
          },
          isUserCreated: true,
          customUserVars:
            tool.authConfig?.reduce(
              (acc, auth) => {
                acc[auth.authField] = {
                  title: auth.label || auth.authField,
                  description: auth.description || '',
                };
                return acc;
              },
              {} as Record<string, { title: string; description: string }>,
            ) || {},
        });
      }
    });

    // console.log('All MCP Servers (combined):', servers);

    return servers;
  }, [mcpServerDefinitions, newMCPServers, mcpTools, availableMCPs]);

  const updateUserPluginsMutation = useUpdateUserPluginsMutation({
    onSuccess: () => {
      showToast({ message: localize('com_nav_mcp_vars_updated'), status: 'success' });
    },
    onError: (error) => {
      console.error('Error updating MCP custom user variables:', error);
      showToast({
        message: localize('com_nav_mcp_vars_update_error'),
        status: 'error',
      });
    },
  });

  const deleteMCP_new = useDeleteMCPMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_delete_mcp_success'),
        status: 'success',
      });
      setShowMCPForm(false);
      setEditingMCP(null);
    },
    onError: (error) => {
      console.error('Error deleting MCP:', error);
      showToast({
        message: localize('com_ui_delete_mcp_error'),
        status: 'error',
      });
    },
  });

  const handleSaveServerVars = useCallback(
    (serverName: string, updatedValues: Record<string, string>) => {
      const payload: TUpdateUserPlugins = {
        pluginKey: `${Constants.mcp_prefix}${serverName}`,
        action: 'install', // 'install' action is used to set/update credentials/variables
        auth: updatedValues,
      };
      updateUserPluginsMutation.mutate(payload);
    },
    [updateUserPluginsMutation],
  );

  const handleRevokeServerVars = useCallback(
    (serverName: string) => {
      const payload: TUpdateUserPlugins = {
        pluginKey: `${Constants.mcp_prefix}${serverName}`,
        action: 'uninstall', // 'uninstall' action clears the variables
        auth: {}, // Empty auth for uninstall
      };
      updateUserPluginsMutation.mutate(payload);
    },
    [updateUserPluginsMutation],
  );

  const handleServerClickToEdit = (serverName: string) => {
    const server = allMCPServers.find((s) => s.mcp_id === serverName);
    if (!server) return;

    if (server.isUserCreated) {
      // For user-created servers, open the MCP form in edit mode
      setEditingMCP(server);
      setShowMCPForm(true);
    } else {
      // For startup config servers, open the variable editor
      setSelectedServerNameForEditing(serverName);
    }
  };

  const handleGoBackToList = () => {
    setSelectedServerNameForEditing(null);
  };

  const handleAddMCP = () => {
    setShowMCPForm(true);
  };

  const handleBackFromForm = () => {
    setShowMCPForm(false);
    setEditingMCP(null);
  };

  if (showMCPForm) {
    return (
      <MCPFormPanel
        mcp={editingMCP}
        onBack={handleBackFromForm}
        title={editingMCP ? localize('com_ui_edit_mcp_server') : localize('com_ui_add_mcp_server')}
        subtitle={
          editingMCP
            ? localize('com_ui_edit_mcp_description')
            : localize('com_agents_mcp_info_chat')
        }
      />
    );
  }

  if (startupConfigLoading || toolsLoading || availableMCPsLoading) {
    return <MCPPanelSkeleton />;
  }

  if (allMCPServers.length === 0) {
    return (
      <div className="h-auto max-w-full overflow-x-hidden p-3">
        <div className="p-4 text-center text-sm text-gray-500">
          {localize('com_sidepanel_mcp_no_servers_with_vars')}
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={handleAddMCP}
            className="btn btn-neutral border-token-border-light relative h-9 w-full rounded-lg font-medium"
            aria-haspopup="dialog"
          >
            <div className="flex w-full items-center justify-center gap-2">
              {localize('com_ui_add_mcp')}
            </div>
          </button>
        </div>
      </div>
    );
  }

  if (selectedServerNameForEditing) {
    // Editing View
    const serverBeingEdited = allMCPServers.find((s) => s.mcp_id === selectedServerNameForEditing);

    if (!serverBeingEdited) {
      // Fallback to list view if server not found
      setSelectedServerNameForEditing(null);
      return (
        <div className="p-4 text-center text-sm text-gray-500">
          {localize('com_ui_error')}: {localize('com_ui_mcp_server_not_found')}
        </div>
      );
    }

    return (
      <div className="h-auto max-w-full overflow-x-hidden p-3">
        <Button
          variant="outline"
          onClick={handleGoBackToList}
          className="mb-3 flex items-center px-3 py-2 text-sm"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          {localize('com_ui_back')}
        </Button>
        <h3 className="mb-3 text-lg font-medium">
          {localize('com_sidepanel_mcp_variables_for', { '0': serverBeingEdited.mcp_id })}
        </h3>
        <MCPVariableEditor
          server={serverBeingEdited}
          onSave={handleSaveServerVars}
          onRevoke={handleRevokeServerVars}
          isSubmitting={updateUserPluginsMutation.isLoading}
        />
      </div>
    );
  } else {
    // Server List View
    return (
      <div className="h-auto max-w-full overflow-x-hidden p-3">
        <div className="space-y-2">
          {allMCPServers.map((server) => (
            <div
              key={server.mcp_id}
              className="flex w-full items-center justify-between rounded-lg border border-border-medium bg-transparent p-3 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <button
                type="button"
                className="flex grow items-center justify-start text-left focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                onClick={() => handleServerClickToEdit(server.mcp_id)}
                aria-label={`${server.isUserCreated ? 'Edit' : 'Configure'} MCP server ${server.metadata.name}`}
              >
                <span>{server.metadata.name}</span>
              </button>
              <div className="ml-4 flex h-7 w-7 items-center justify-center">
                {server.isUserCreated && (
                  <OGDialog>
                    <OGDialogTrigger asChild>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded p-1 text-white hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        aria-label={`Delete MCP server ${server.mcp_id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </OGDialogTrigger>
                    <OGDialogTemplate
                      showCloseButton={false}
                      title={localize('com_ui_delete_mcp')}
                      className="max-w-[450px]"
                      main={
                        <Label className="text-left text-sm font-medium">
                          {localize('com_ui_delete_mcp_confirm')}
                        </Label>
                      }
                      selection={{
                        selectHandler: () => {
                          deleteMCP_new.mutate({ mcp_id: server.mcp_id });
                        },
                        selectClasses:
                          'bg-red-700 dark:bg-red-600 hover:bg-red-800 dark:hover:bg-red-800 transition-color duration-200 text-white',
                        selectText: localize('com_ui_delete'),
                      }}
                    />
                  </OGDialog>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={handleAddMCP}
            className="btn btn-neutral border-token-border-light relative h-9 w-full rounded-lg font-medium"
            aria-haspopup="dialog"
          >
            <div className="flex w-full items-center justify-center gap-2">
              {localize('com_ui_add_mcp')}
            </div>
          </button>
        </div>
      </div>
    );
  }
}

// Inner component for the form - remains the same
interface MCPVariableEditorProps {
  server: MCPWithExtras;
  onSave: (serverName: string, updatedValues: Record<string, string>) => void;
  onRevoke: (serverName: string) => void;
  isSubmitting: boolean;
}

function MCPVariableEditor({ server, onSave, onRevoke, isSubmitting }: MCPVariableEditorProps) {
  const localize = useLocalize();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<Record<string, string>>({
    defaultValues: {}, // Initialize empty, will be reset by useEffect
  });

  useEffect(() => {
    // Always initialize with empty strings based on the schema
    const initialFormValues = Object.keys(server.customUserVars || {}).reduce(
      (acc, key) => {
        acc[key] = '';
        return acc;
      },
      {} as Record<string, string>,
    );
    reset(initialFormValues);
  }, [reset, server.customUserVars]);

  const onFormSubmit = (data: Record<string, string>) => {
    onSave(server.mcp_id, data);
  };

  const handleRevokeClick = () => {
    onRevoke(server.mcp_id);
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="mb-4 mt-2 space-y-4">
      {Object.entries(server.customUserVars || {}).map(([key, details]) => (
        <div key={key} className="space-y-2">
          <Label htmlFor={`${server.mcp_id}-${key}`} className="text-sm font-medium">
            {details.title}
          </Label>
          <Controller
            name={key}
            control={control}
            defaultValue={''}
            render={({ field }) => (
              <Input
                id={`${server.mcp_id}-${key}`}
                type="text"
                {...field}
                placeholder={localize('com_sidepanel_mcp_enter_value', { '0': details.title })}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white sm:text-sm"
              />
            )}
          />
          {details.description && (
            <p
              className="text-xs text-text-secondary [&_a]:text-blue-500 [&_a]:hover:text-blue-600 dark:[&_a]:text-blue-400 dark:[&_a]:hover:text-blue-300"
              dangerouslySetInnerHTML={{ __html: details.description }}
            />
          )}
          {errors[key] && <p className="text-xs text-red-500">{errors[key]?.message}</p>}
        </div>
      ))}
      <div className="flex justify-end gap-2 pt-2">
        {Object.keys(server.customUserVars || {}).length > 0 && (
          <Button
            type="button"
            onClick={handleRevokeClick}
            className="bg-red-600 text-white hover:bg-red-700 dark:hover:bg-red-800"
            disabled={isSubmitting}
          >
            {localize('com_ui_revoke')}
          </Button>
        )}
        <Button
          type="submit"
          className="bg-green-500 text-white hover:bg-green-600"
          disabled={isSubmitting || !isDirty}
        >
          {isSubmitting ? localize('com_ui_saving') : localize('com_ui_save')}
        </Button>
      </div>
    </form>
  );
}
