import { Injectable } from '@nestjs/common';

interface RegexGuardOptions {
  email?: boolean;
  phone?: boolean;
  creditCard?: boolean;
  privateKey?: boolean;
  socialSecurityNumber?: boolean;
  passportNumber?: boolean;
  driverLicenseNumber?: boolean;
  nationalIdNumber?: boolean;
  taxIdNumber?: boolean;
  bankAccountNumber?: boolean;
  creditCardNumber?: boolean;
}

const REGEX_MAP: Record<keyof RegexGuardOptions, RegExp> = {
  email:
    /(?:[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*|"[^\n"]+")@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}/g,
  phone: /(?:(?:\+?\d{1,4}[ -]?)?(?:\(?\d{3}\)?[ -]?)?\d{3}[ -]?\d{4})/g,
  creditCard: /\b(?:\d[ -]*?){13,16}\b/g,
  privateKey:
    /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  socialSecurityNumber: /\b\d{3}-\d{2}-\d{4}\b/g,
  passportNumber: /\b([A-PR-WYa-pr-wy][1-9]\d\s?\d{4}[1-9])\b/g,
  driverLicenseNumber: /\b([A-Z]{1,2}\d{4,14})\b/g,
  nationalIdNumber: /\b\d{9,14}\b/g,
  taxIdNumber: /\b\d{2}-\d{7}|\d{9}\b/g,
  bankAccountNumber: /\b\d{6,20}\b/g,
  creditCardNumber: /\b(?:\d[ -]*?){13,16}\b/g,
};

@Injectable()
export class GuardrailsService {
  constructor() {}

  async checkContentWithRegex(
    content: string,
    options: RegexGuardOptions,
  ): Promise<string> {
    return content;
  }
}
