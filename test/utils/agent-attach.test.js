const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { syncContentWithMarkers } = require('../../src/commands/agent/attach');

describe('AgentAttach Utility & Rule Synchronization', () => {
  const tmpDir = path.join(__dirname, '..', '..', 'tmp-test-agent');

  beforeEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should create new rule file with full content if target does not exist', () => {
    const targetFile = path.join(tmpDir, 'AGENTS.md');
    const rules = '<!-- KORAM_AGENT_RULES_START -->\n# Reglas Koram\n<!-- KORAM_AGENT_RULES_END -->';

    const result = syncContentWithMarkers(targetFile, rules, rules);
    expect(result.action).to.equal('created');
    expect(fs.existsSync(targetFile)).to.be.true;

    const content = fs.readFileSync(targetFile, 'utf8');
    expect(content).to.equal(rules);
  });

  it('should update existing rule block without touching developer custom rules', () => {
    const targetFile = path.join(tmpDir, 'CLAUDE.md');
    const initialContent = [
      '# My Custom Project Rules',
      '- Always use TypeScript',
      '',
      '<!-- KORAM_AGENT_RULES_START -->',
      'Old Koram Rules v1',
      '<!-- KORAM_AGENT_RULES_END -->',
      '',
      '# Team Guidelines',
      '- Follow conventional commits'
    ].join('\n');

    fs.writeFileSync(targetFile, initialContent, 'utf8');

    const updatedRules = '<!-- KORAM_AGENT_RULES_START -->\nNew Koram Rules v2\n<!-- KORAM_AGENT_RULES_END -->';
    const result = syncContentWithMarkers(targetFile, updatedRules);

    expect(result.action).to.equal('updated');
    const content = fs.readFileSync(targetFile, 'utf8');

    expect(content).to.contain('# My Custom Project Rules');
    expect(content).to.contain('# Team Guidelines');
    expect(content).to.contain('New Koram Rules v2');
    expect(content).to.not.contain('Old Koram Rules v1');
  });

  it('should append rules block cleanly if target exists but has no markers', () => {
    const targetFile = path.join(tmpDir, '.cursorrules');
    const initialContent = 'Always format with Prettier';
    fs.writeFileSync(targetFile, initialContent, 'utf8');

    const rules = '<!-- KORAM_AGENT_RULES_START -->\n# Koram Rules\n<!-- KORAM_AGENT_RULES_END -->';
    const result = syncContentWithMarkers(targetFile, rules);

    expect(result.action).to.equal('appended');
    const content = fs.readFileSync(targetFile, 'utf8');

    expect(content).to.contain('Always format with Prettier');
    expect(content).to.contain('<!-- KORAM_AGENT_RULES_START -->');
    expect(content).to.contain('# Koram Rules');
    expect(content).to.contain('<!-- KORAM_AGENT_RULES_END -->');
  });
});
