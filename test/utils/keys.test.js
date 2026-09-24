const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  getKoramKeysDir,
  ensureKoramKeysDir,
  storeKoramKey,
  removeKoramKey
} = require('../../src/utils/keys');

describe('Keys Storage Utility (src/utils/keys.js)', () => {
  const testAlias = 'unit-test-vps';
  const testUser = 'deployer';
  let tempDir;
  let validKeyFile;
  let invalidKeyFile;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koram-test-keys-'));
    validKeyFile = path.join(tempDir, 'valid.pem');
    invalidKeyFile = path.join(tempDir, 'invalid.txt');

    fs.writeFileSync(
      validKeyFile,
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0mockvalidkeydata...\n-----END RSA PRIVATE KEY-----\n'
    );
    fs.writeFileSync(invalidKeyFile, 'This is just a plain text file without private keys');
  });

  after(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync ? fs.rmSync(tempDir, { recursive: true, force: true }) : fs.unlinkSync(tempDir);
      }
    } catch (e) { }

    // Limpiar llave de prueba en ~/.koram/keys si quedó
    const targetKeyPath = path.join(getKoramKeysDir(), `${testAlias}.pem`);
    removeKoramKey(targetKeyPath);
  });

  describe('getKoramKeysDir', () => {
    it('should return a path inside the user home directory ending in .koram/keys', () => {
      const keysDir = getKoramKeysDir();
      expect(keysDir).to.contain('.koram');
      expect(keysDir).to.match(/keys$/);
      expect(path.isAbsolute(keysDir)).to.be.true;
    });
  });

  describe('ensureKoramKeysDir', () => {
    it('should ensure the directory exists and has 0700 permissions on POSIX systems', () => {
      const keysDir = ensureKoramKeysDir();
      expect(fs.existsSync(keysDir)).to.be.true;

      if (process.platform !== 'win32') {
        const stat = fs.statSync(keysDir);
        const mode = stat.mode & 0o777;
        expect(mode).to.equal(0o700);
      }
    });
  });

  describe('storeKoramKey', () => {
    it('should throw an error if sourcePath is missing or invalid', () => {
      expect(() => storeKoramKey('', testAlias, testUser)).to.throw(
        'Debes especificar una ruta válida al archivo de la llave privada'
      );
      expect(() => storeKoramKey(null, testAlias, testUser)).to.throw(
        'Debes especificar una ruta válida al archivo de la llave privada'
      );
    });

    it('should throw an error if the source file does not exist', () => {
      const nonExistent = path.join(tempDir, 'non_existent.pem');
      expect(() => storeKoramKey(nonExistent, testAlias, testUser)).to.throw(
        'El archivo de llave no existe en'
      );
    });

    it('should throw an error if the file is not a valid private key', () => {
      expect(() => storeKoramKey(invalidKeyFile, testAlias, testUser)).to.throw(
        'El archivo no parece ser una llave privada SSH válida'
      );
    });

    it('should copy valid key to ~/.koram/keys/<alias>.pem with 0600 permissions', () => {
      const storedPath = storeKoramKey(validKeyFile, testAlias, testUser);

      expect(fs.existsSync(storedPath)).to.be.true;
      expect(path.basename(storedPath)).to.equal(`${testAlias}.pem`);

      const storedContent = fs.readFileSync(storedPath, 'utf8');
      expect(storedContent).to.contain('-----BEGIN RSA PRIVATE KEY-----');

      if (process.platform !== 'win32') {
        const stat = fs.statSync(storedPath);
        const mode = stat.mode & 0o777;
        expect(mode).to.equal(0o600);
      }
    });

    it('should sanitize special characters in alias for the filename', () => {
      const complexAlias = 'prod/server:test 1';
      const stored = storeKoramKey(validKeyFile, complexAlias, testUser);

      expect(fs.existsSync(stored)).to.be.true;
      expect(path.basename(stored)).to.equal('prod_server_test_1.pem');

      // Limpiar archivo creado
      removeKoramKey(stored);
    });
  });

  describe('removeKoramKey', () => {
    it('should not throw if path is empty or null', () => {
      expect(() => removeKoramKey(null)).to.not.throw();
      expect(() => removeKoramKey('')).to.not.throw();
    });

    it('should not delete files outside ~/.koram/keys for security', () => {
      const safeFile = path.join(tempDir, 'do_not_delete.txt');
      fs.writeFileSync(safeFile, 'Important data');

      removeKoramKey(safeFile);
      expect(fs.existsSync(safeFile)).to.be.true;
    });

    it('should remove the file if it exists inside ~/.koram/keys', () => {
      const storedPath = storeKoramKey(validKeyFile, testAlias, testUser);
      expect(fs.existsSync(storedPath)).to.be.true;

      removeKoramKey(storedPath);
      expect(fs.existsSync(storedPath)).to.be.false;
    });
  });
});
