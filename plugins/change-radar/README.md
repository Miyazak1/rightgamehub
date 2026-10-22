# Change Radar Agent plugin

This package connects supported Agents to the hosted Change Radar sidebar through the dedicated Streamable HTTP MCP endpoint at `https://mooyu.fun/mcp/change-radar`.

The plugin contains no provider credentials, user tokens, database, scheduler, or research worker. Long-running monitoring remains a hosted service so work continues after the Agent closes.

The first release exposes one bounded Agent tool: `open_change_radar`. It can open the directory, prepare a public-page watch for user review, or navigate to an authenticated research topic and a bounded read-only analysis.
