export interface TemplateRule {
  name: string;
  type: string;
  severity: 'high' | 'medium' | 'low';
  validatorType: string;
  entities?: string[];
  target: 'input' | 'output' | 'both';
  onFail: 'fix' | 'exception';
}

export interface ComplianceTemplate {
  id: string;
  name: string;
  description: string;
  features: string[];
  rules: TemplateRule[];
}

export const COMPLIANCE_TEMPLATES: ComplianceTemplate[] = [
  {
    id: 'hipaa',
    name: 'Healthcare (HIPAA)',

    description: 'Healthcare-specific compliance for HIPAA requirements',
    features: [
      'PHI detection',
      'Medical record protection',
      'Patient privacy enforcement',
    ],
    rules: [
      {
        name: 'PHI Detection Filter',
        type: 'PII Protection',
        severity: 'high',
        validatorType: 'no_pii',
        entities: [
          'Person',
          'Date Time',
          'Phone Number',
          'Email Address',
          'Location',
        ],
        target: 'both',
        onFail: 'fix',
      },
      {
        name: 'Medical Record Number Guard',
        type: 'PII Protection',
        severity: 'high',
        validatorType: 'regex_match',
        entities: ['NRP'],
        target: 'output',
        onFail: 'exception',
      },
      {
        name: 'Patient Privacy Filter',
        type: 'Content Safety',
        severity: 'high',
        validatorType: 'no_pii',
        entities: ['Person', 'Location', 'Phone Number'],
        target: 'both',
        onFail: 'fix',
      },
    ],
  },
  {
    id: 'sox',
    name: 'Financial Services (SOX)',

    description: 'Compliance standards for Sarbanes-Oxley Act in finance',
    features: [
      'Transaction auditing',
      'Financial data integrity',
      'Fraud detection',
    ],
    rules: [
      {
        name: 'Financial Data Guard',
        type: 'PII Protection',
        severity: 'high',
        validatorType: 'no_pii',
        entities: ['Credit Card', 'IBAN Code', 'NRP'],
        target: 'both',
        onFail: 'exception',
      },
      {
        name: 'Transaction Integrity Check',
        type: 'Content Safety',
        severity: 'medium',
        validatorType: 'regex_match',
        entities: [],
        target: 'output',
        onFail: 'fix',
      },
    ],
  },
  {
    id: 'gdpr',
    name: 'GDPR Data Protection',

    description: 'European Union regulations for data privacy and protection',
    features: [
      'Personal data anonymization',
      'User consent management',
      'Right to access enforcement',
    ],
    rules: [
      {
        name: 'Personal Data Anonymizer',
        type: 'PII Protection',
        severity: 'high',
        validatorType: 'no_pii',
        entities: [
          'Person',
          'Email Address',
          'Phone Number',
          'Location',
          'IP Address',
          'Date Time',
        ],
        target: 'both',
        onFail: 'fix',
      },
      {
        name: 'EU Data Residency Guard',
        type: 'Content Safety',
        severity: 'medium',
        validatorType: 'regex_match',
        entities: ['Location'],
        target: 'output',
        onFail: 'fix',
      },
      {
        name: 'Consent Verification Filter',
        type: 'Content Safety',
        severity: 'medium',
        validatorType: 'detect_jailbreak',
        entities: [],
        target: 'input',
        onFail: 'exception',
      },
    ],
  },
  {
    id: 'pci_dss',
    name: 'PCI DSS Compliance',

    description: 'Payment card industry data security standards',
    features: [
      'Credit card data encryption',
      'Access control measures',
      'Security monitoring',
    ],
    rules: [
      {
        name: 'Credit Card Data Filter',
        type: 'PII Protection',
        severity: 'high',
        validatorType: 'no_pii',
        entities: ['Credit Card', 'Crypto', 'IBAN Code'],
        target: 'both',
        onFail: 'exception',
      },
      {
        name: 'Cardholder Name Guard',
        type: 'PII Protection',
        severity: 'high',
        validatorType: 'no_pii',
        entities: ['Person', 'Phone Number', 'Email Address'],
        target: 'output',
        onFail: 'fix',
      },
    ],
  },
];
