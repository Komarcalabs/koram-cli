const { expect } = require('chai');
const { ensureRemoteDirectory } = require('../../src/utils/deploy/remote-dir');

describe('ensureRemoteDirectory Utility', () => {
  it('should return true immediately if directory exists and is writable', async () => {
    const mockSsh = {
      execCommand: async (cmd) => {
        if (cmd.includes('[ -d "/var/www/app" ]')) {
          return { stdout: 'OK\n', stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      }
    };

    const logs = [];
    const result = await ensureRemoteDirectory(mockSsh, '/var/www/app', 'ubuntu', null, (msg) => logs.push(msg));
    expect(result).to.be.true;
    expect(logs.some(l => l.includes('Validando directorio'))).to.be.true;
  });

  it('should auto-elevate with sudo when directory is missing and passwordless sudo is available', async () => {
    const executedCommands = [];
    const mockSsh = {
      execCommand: async (cmd) => {
        executedCommands.push(cmd);
        if (cmd.includes('[ -d "/home/deploys/my-app" ]') && executedCommands.length === 1) {
          return { stdout: 'MISSING\n', stderr: '', code: 0 };
        }
        if (cmd === 'sudo -n true 2>/dev/null') {
          return { stdout: '', stderr: '', code: 0 };
        }
        if (cmd.includes('sudo mkdir -p "/home/deploys/my-app"')) {
          return { stdout: '', stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      }
    };

    const logs = [];
    const result = await ensureRemoteDirectory(mockSsh, '/home/deploys/my-app', 'ubuntu', null, (msg) => logs.push(msg));
    expect(result).to.be.true;
    expect(executedCommands.some(c => c.includes('sudo mkdir -p "/home/deploys/my-app"'))).to.be.true;
    expect(logs.some(l => l.includes('mediante sudo'))).to.be.true;
  });

  it('should fix ownership with sudo when directory exists but is not writable', async () => {
    const executedCommands = [];
    const mockSsh = {
      execCommand: async (cmd) => {
        executedCommands.push(cmd);
        if (cmd.includes('[ -d "/home/deploys/my-app" ]') && executedCommands.length === 1) {
          return { stdout: 'EXISTS_NO_WRITE\n', stderr: '', code: 0 };
        }
        if (cmd === 'sudo -n true 2>/dev/null') {
          return { stdout: '', stderr: '', code: 0 };
        }
        if (cmd.includes('sudo chown -R')) {
          return { stdout: '', stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      }
    };

    const logs = [];
    const result = await ensureRemoteDirectory(mockSsh, '/home/deploys/my-app', 'ubuntu', null, (msg) => logs.push(msg));
    expect(result).to.be.true;
    expect(executedCommands.some(c => c.includes('sudo chown -R'))).to.be.true;
    // Should NOT call mkdir since it already exists
    expect(executedCommands.some(c => c.includes('sudo mkdir -p'))).to.be.false;
  });

  it('should use sudo -S with password when passwordless sudo fails but vaultPassword exists', async () => {
    const executedCommands = [];
    const mockSsh = {
      execCommand: async (cmd) => {
        executedCommands.push(cmd);
        if (cmd.includes('[ -d "/opt/app" ]') && executedCommands.length === 1) {
          return { stdout: 'MISSING\n', stderr: '', code: 0 };
        }
        if (cmd === 'sudo -n true 2>/dev/null') {
          return { stdout: '', stderr: 'password required', code: 1 };
        }
        if (cmd.includes('echo "secret123" | sudo -S')) {
          return { stdout: '', stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      }
    };

    const logs = [];
    const result = await ensureRemoteDirectory(mockSsh, '/opt/app', 'deployuser', 'secret123', (msg) => logs.push(msg));
    expect(result).to.be.true;
    expect(executedCommands.some(c => c.includes('echo "secret123" | sudo -S'))).to.be.true;
  });

  it('should throw an error with helpful instructions when all permission elevations fail', async () => {
    const mockSsh = {
      execCommand: async (cmd) => {
        if (cmd.includes('[ -d "/root/app" ]')) {
          return { stdout: 'MISSING\n', stderr: '', code: 0 };
        }
        if (cmd === 'sudo -n true 2>/dev/null') {
          return { stdout: '', stderr: 'sudo not allowed', code: 1 };
        }
        if (cmd === 'mkdir -p "/root/app"') {
          return { stdout: '', stderr: 'Permission denied', code: 1 };
        }
        // Final check fails
        return { stdout: 'FAIL\n', stderr: '', code: 1 };
      }
    };

    try {
      await ensureRemoteDirectory(mockSsh, '/root/app', 'ubuntu', null, () => {});
      expect.fail('Should have thrown an error');
    } catch (err) {
      expect(err.message).to.contain('Permisos insuficientes en el servidor remoto');
      expect(err.message).to.contain('koram ssh .');
    }
  });
});
