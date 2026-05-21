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
