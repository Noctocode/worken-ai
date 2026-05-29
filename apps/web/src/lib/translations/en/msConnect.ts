// Shared Microsoft connect/disconnect confirm dialog (used by both
// SharePoint and OneDrive sections). Strings use {primary} / {other}
// placeholders that the component fills via .replace() with the
// concrete product label ("SharePoint" or "OneDrive").
export const msConnect = {
  'msConnect.connectTitle': 'Connect {primary}',
  'msConnect.connectInitialDesc':
    'Signing in with Microsoft also covers {other} — they use the same account. You can enable just {primary}, or both at once. Either way you only sign in once.',
  'msConnect.cancel': 'Cancel',
  'msConnect.justPrimary': 'Just {primary}',
  'msConnect.bothProducts': 'Both products',
  'msConnect.enableTitle': 'Enable {primary}',
  'msConnect.connectAddonDesc':
    "You're already signed in with Microsoft for {other}. {primary} uses the same account — no re-sign-in needed. Enable it now?",
  'msConnect.enable': 'Enable {primary}',
  'msConnect.disconnectTitle': 'Disconnect from {primary}?',
  'msConnect.disconnectDesc':
    'Stop using {primary} on this Microsoft connection. If {other} is also enabled, you can keep it connected or disconnect from both at once.',
} as const;
