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
      [
        '---',
        'name: "Quoted"',
        "description: 'Single quoted'",
        '---',
        'Body',
      ].join('\n'),
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
      [
        '---',
        'name: Ok',
        'this line has no colon',
        'description: d',
        '---',
        'B',
      ].join('\n'),
    );
    expect(parsed.name).toBe('Ok');
    expect(parsed.description).toBe('d');
  });
});

describe('parseSkillMd — script extraction (Option #3)', () => {
  it('extracts a named fenced block: language, name, entrypoint, content', () => {
    const raw = [
      '---',
      'name: Excel report',
      'description: Use when building an .xlsx report.',
      '---',
      'Run this to build the workbook:',
      '',
      '```python name=generate_report.py entrypoint',
      'import openpyxl',
      'wb = openpyxl.Workbook()',
      '```',
    ].join('\n');
    const parsed = parseSkillMd(raw);
    expect(parsed.scripts).toHaveLength(1);
    expect(parsed.scripts[0]).toEqual({
      name: 'generate_report.py',
      language: 'python',
      entrypoint: true,
      content: 'import openpyxl\nwb = openpyxl.Workbook()',
    });
    // Non-destructive: the block stays in the instructions body too.
    expect(parsed.instructions).toContain('name=generate_report.py');
  });

  it('ignores ordinary code blocks without name= (instructional skill)', () => {
    const raw = [
      '---',
      'name: Plain',
      'description: d',
      '---',
      'Example:',
      '',
      '```ts',
      'const x = 1;',
      '```',
    ].join('\n');
    const parsed = parseSkillMd(raw);
    expect(parsed.scripts).toEqual([]);
  });

  it('extracts multiple scripts; entrypoint omitted when absent', () => {
    const raw = [
      '```python name=main.py entrypoint',
      'print(1)',
      '```',
      '',
      '```bash name=setup.sh',
      'echo hi',
      '```',
    ].join('\n');
    const parsed = parseSkillMd(raw); // no frontmatter
    expect(parsed.scripts.map((s) => s.name)).toEqual(['main.py', 'setup.sh']);
    expect(parsed.scripts[0].entrypoint).toBe(true);
    expect(parsed.scripts[1].entrypoint).toBeUndefined();
    expect(parsed.scripts[1].language).toBe('bash');
  });

  it('defaults language to "text" when the fence has only name=', () => {
    const parsed = parseSkillMd(
      ['```name=notes.txt', 'hello', '```'].join('\n'),
    );
    expect(parsed.scripts[0]).toMatchObject({
      name: 'notes.txt',
      language: 'text',
    });
  });

  it('does not extract an unterminated named block', () => {
    const parsed = parseSkillMd(
      ['```python name=oops.py', 'x = 1', '(no closing fence)'].join('\n'),
    );
    expect(parsed.scripts).toEqual([]);
  });

  it('de-duplicates scripts by name (first wins)', () => {
    const raw = [
      '```python name=run.py',
      'first',
      '```',
      '',
      '```python name=run.py',
      'second',
      '```',
    ].join('\n');
    const parsed = parseSkillMd(raw);
    expect(parsed.scripts).toHaveLength(1);
    expect(parsed.scripts[0].content).toBe('first');
  });

  it('keeps only the first entrypoint when several are marked', () => {
    const raw = [
      '```python name=a.py entrypoint',
      'a',
      '```',
      '',
      '```python name=b.py entrypoint',
      'b',
      '```',
    ].join('\n');
    const parsed = parseSkillMd(raw);
    expect(parsed.scripts[0].entrypoint).toBe(true);
    expect(parsed.scripts[1].entrypoint).toBeUndefined();
  });
});
