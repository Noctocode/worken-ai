import type { msConnect as msConnectEn } from "../en/msConnect";

export const msConnect: Record<keyof typeof msConnectEn, string> = {
  'msConnect.connectTitle': 'Poveži {primary}',
  'msConnect.connectInitialDesc':
    'Vpis z Microsoftom pokrije tudi {other} — uporabljata isti račun. Lahko omogočiš samo {primary} ali oba naenkrat. Tako ali drugače se vpišeš samo enkrat.',
  'msConnect.cancel': 'Prekliči',
  'msConnect.justPrimary': 'Samo {primary}',
  'msConnect.bothProducts': 'Oba produkta',
  'msConnect.enableTitle': 'Omogoči {primary}',
  'msConnect.connectAddonDesc':
    'Že ste prijavljeni z Microsoftom za {other}. {primary} uporablja isti račun — ponovna prijava ni potrebna. Omogoči zdaj?',
  'msConnect.enable': 'Omogoči {primary}',
  'msConnect.disconnectTitle': 'Odklopi {primary}?',
  'msConnect.disconnectDesc':
    'Prenehaj uporabljati {primary} na tej Microsoft povezavi. Če je omogočen tudi {other}, ga lahko ohraniš povezanega ali odklopiš oba naenkrat.',
};
