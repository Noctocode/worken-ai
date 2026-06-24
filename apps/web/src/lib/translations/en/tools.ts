export const tools = {
  "tools.tab": "Tools",
  "tools.title": "Tools",
  "tools.desc":
    "External APIs the AI can call during chat. Configured once for your whole company.",
  "tools.registryNote":
    "Tools are registered here. Letting the AI call them in chat is rolling out separately.",
  "tools.readOnlyNote": "Only company admins can add or edit tools.",
  "tools.add": "Add tool",
  "tools.empty": "No tools yet.",
  "tools.emptyAdmin": 'Add your first tool with "Add tool".',
  "tools.search": "Search tools...",
  "tools.enabled": "Enabled",
  "tools.disabled": "Disabled",
  "tools.keySet": "Key set",
  "tools.noKey": "No key",
  "tools.edit": "Edit",
  "tools.delete": "Delete",
  "tools.deleting": "Deleting...",
  "tools.confirmDeleteTitle": "Delete tool",
  "tools.confirmDelete": "Delete this tool? This cannot be undone.",

  // Dialog
  "tools.createTitle": "Add tool",
  "tools.editTitle": "Edit tool",
  "tools.dialogDesc":
    "Describe an external API so the AI knows when and how to call it.",
  "tools.create": "Create",
  "tools.creating": "Creating...",
  "tools.save": "Save changes",
  "tools.saving": "Saving...",
  "tools.cancel": "Cancel",

  // Fields
  "tools.field.displayName": "Display name",
  "tools.field.displayNamePh": "Weather",
  "tools.field.name": "Function name",
  "tools.field.namePh": "get_weather",
  "tools.field.nameHint": "What the model calls it — lowercase, a–z 0–9 _.",
  "tools.field.description": "Description",
  "tools.field.descriptionPh":
    "Get the current weather for a city. Use when the user asks about weather.",
  "tools.field.descriptionHint": "Tells the model WHEN to use this tool.",
  "tools.field.method": "HTTP method",
  "tools.field.url": "Request URL",
  "tools.field.urlPh": "https://api.example.com/weather?q={{city}}",
  "tools.field.urlHint": "HTTPS only. Use {{param}} for input values.",
  "tools.field.inputSchema": "Parameters (JSON Schema)",
  "tools.field.headers": "Headers (JSON)",
  "tools.field.query": "Query params (JSON)",
  "tools.field.body": "Body (JSON)",
  "tools.field.responsePath": "Response path (optional)",
  "tools.field.responsePathPh": "$.main",
  "tools.field.auth": "Authentication",
  "tools.field.authParam": "Key name",
  "tools.field.authParamPh": "appid",
  "tools.field.apiKey": "API key",
  "tools.field.apiKeyPh": "Paste the API key",
  "tools.field.apiKeyKept": "Leave blank to keep the saved key.",
  "tools.field.visibility": "Visibility",
  "tools.field.callLimit": "Monthly call limit",
  "tools.field.callLimitPh": "Unlimited",
  "tools.field.timeout": "Timeout (ms)",
  "tools.field.isEnabled": "Enabled",

  // Auth options
  "tools.auth.none": "None",
  "tools.auth.api_key_header": "API key in header",
  "tools.auth.api_key_query": "API key in query",
  "tools.auth.bearer": "Bearer token",

  // Visibility options
  "tools.vis.all": "Everyone",
  "tools.vis.admins": "Admins only",

  // Toasts
  "tools.toast.created": "Tool created.",
  "tools.toast.updated": "Tool updated.",
  "tools.toast.deleted": "Tool deleted.",
  "tools.toast.invalidJson": "Check the JSON fields — one isn't valid JSON.",
} as const;
