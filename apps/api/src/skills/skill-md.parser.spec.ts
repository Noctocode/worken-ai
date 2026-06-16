import { parseSkillMd } from './skill-md.parser.js';

describe('parseSkillMd', () => {
  it('parses name + description from frontmatter and keeps the body', () => {
    const raw = [
      '---',
      'name: Client proposal',
      'description: Use when drafting a client-facing proposal.',
      '---',
      '# How we write proposals',
      '',
      'Always open with the problem statement.',
    ].join('\n');

    const parsed = parseSkillMd(raw);
    expect(parsed.name).toBe('Client proposal');
    expect(parsed.description).toBe(
      'Use when drafting a client-facing proposal.',
    );
    expect(parsed.instructions).toBe(
      '# How we write proposals\n\nAlways open with the problem statement.',
    );
    expect(parsed.extraFrontmatter).toEqual({});
  });

  it('unwraps quoted frontmatter values', () => {
    const parsed = parseSkillMd(
      ['---', 'name: "Quoted"', "description: 'Single quoted'", '---', 'Body'].join(
        '\n',
      ),
    );
    expect(parsed.name).toBe('Quoted');
    expect(parsed.description).toBe('Single quoted');
  });

  it('is CRLF-safe', () => {
    const parsed = parseSkillMd(
      ['---', 'name: CRLF', 'description: d', '---', 'Body line'].join('\r\n'),
    );
    expect(parsed.name).toBe('CRLF');
    expect(parsed.instructions).toBe('Body line');
  });

  it('tolerates leading blank lines before the frontmatter fence', () => {
    const parsed = parseSkillMd(
      ['', '   ', '---', 'name: Leading', 'description: d', '---', 'Body'].join(
        '\n',
      ),
    );
    expect(parsed.name).toBe('Leading');
  });

  it('treats a document with no frontmatter as all instructions', () => {
    const parsed = parseSkillMd('Just instructions, no frontmatter.');
    expect(parsed.name).toBeUndefined();
    expect(parsed.description).toBeUndefined();
    expect(parsed.instructions).toBe('Just instructions, no frontmatter.');
  });

  it('treats unterminated frontmatter as instructions rather than guessing', () => {
    const raw = ['---', 'name: Broken', 'description: no closing fence'].join(
      '\n',
    );
    const parsed = parseSkillMd(raw);
    expect(parsed.name).toBeUndefined();
    expect(parsed.instructions).toBe(raw);
  });

  it('preserves unknown frontmatter keys for forward-compat (Option #3)', () => {
    const parsed = parseSkillMd(
      [
        '---',
        'name: Excel report',
        'description: d',
        'scripts: build_xlsx.py',
        'version: 2',
        '---',
        'Body',
      ].join('\n'),
    );
    // name/description are lifted out; everything else is preserved, not
    // rejected — a future executable-skills parser reads these.
    expect(parsed.extraFrontmatter).toEqual({
      scripts: 'build_xlsx.py',
      version: '2',
    });
    expect(parsed.instructions).toBe('Body');
  });

  it('skips malformed (colon-less) frontmatter lines', () => {
    const parsed = parseSkillMd(
      ['---', 'name: Ok', 'this line has no colon', 'description: d', '---', 'B'].join(
        '\n',
      ),
    );
    expect(parsed.name).toBe('Ok');
    expect(parsed.description).toBe('d');
  });
});
