const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getCredentialByKey } = require('../../src/utils/index');
const { storeKoramKey, removeKoramKey } = require('../../src/utils/keys');

describe('Credential Resolution Utility (getCredentialByKey)', () => {
  const credFile = path.join(os.homedir(), '.koram_credentials.json');
  let originalCredContent = null;
  const mockAliasKey = 'mock-key-server';
  const mockAliasPass = 'mock-pass-server';
  const mockAliasS3 = 'mock-s3-service';
  let tempKeyPath;

  before(() => {
    // Respaldar archivo real de credenciales si existe
    if (fs.existsSync(credFile)) {
      originalCredContent = fs.readFileSync(credFile, 'utf8');
    }

    // Crear llave de prueba para mock-key-server
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koram-cred-test-'));
    const tempPem = path.join(tempDir, 'sample.pem');
    fs.writeFileSync(tempPem, '-----BEGIN OPENSSH PRIVATE KEY-----\nmockkeydata\n-----END OPENSSH PRIVATE KEY-----');
    tempKeyPath = storeKoramKey(tempPem, mockAliasKey, 'ubuntu');

    // Cargar o crear objeto de prueba
    let testCreds = {};
    if (originalCredContent) {
      try {
        testCreds = JSON.parse(originalCredContent);
      } catch (e) {
        testCreds = {};
      }
    }

    testCreds[`${mockAliasKey}:ubuntu`] = {
      host: '54.21.32.10',
      type: 'server',
      authType: 'key',
      keyPath: tempKeyPath,
      password: 'mock-passphrase'
    };

    testCreds[`${mockAliasPass}:root`] = {
      host: '192.168.1.50',
      type: 'server',
      authType: 'password',
      password: 'super-secret-password'
    };

    testCreds[`${mockAliasS3}:AKIAIOSFODNN7`] = {
      host: 'us-east-1',
      type: 's3',
      accessKeyId: 'AKIAIOSFODNN7',
      region: 'us-east-1'
    };

    fs.writeFileSync(credFile, JSON.stringify(testCreds, null, 2));
  });

  after(() => {
    // Restaurar archivo original o limpiar
    if (originalCredContent !== null) {
      fs.writeFileSync(credFile, originalCredContent);
    } else if (fs.existsSync(credFile)) {
      try {
        const current = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        delete current[`${mockAliasKey}:ubuntu`];
        delete current[`${mockAliasPass}:root`];
        delete current[`${mockAliasS3}:AKIAIOSFODNN7`];
        fs.writeFileSync(credFile, JSON.stringify(current, null, 2));
      } catch (e) { }
    }

    if (tempKeyPath) {
      removeKoramKey(tempKeyPath);
    }
  });

  it('should resolve key-based server credential by alias', async () => {
    const cred = await getCredentialByKey(mockAliasKey);

    expect(cred).to.be.an('object');
    expect(cred.alias).to.equal(mockAliasKey);
    expect(cred.user).to.equal('ubuntu');
    expect(cred.host).to.equal('54.21.32.10');
    expect(cred.authType).to.equal('key');
    expect(cred.keyPath).to.equal(tempKeyPath);
    expect(cred.privateKey).to.be.instanceOf(Buffer);
    expect(cred.privateKey.toString()).to.contain('-----BEGIN OPENSSH PRIVATE KEY-----');
  });

  it('should resolve password-based server credential by alias', async () => {
    const cred = await getCredentialByKey(mockAliasPass);

    expect(cred).to.be.an('object');
    expect(cred.alias).to.equal(mockAliasPass);
    expect(cred.user).to.equal('root');
    expect(cred.host).to.equal('192.168.1.50');
    expect(cred.authType).to.equal('password');
    expect(cred.keyPath).to.be.null;
    expect(cred.privateKey).to.be.null;
    expect(cred.password).to.equal('super-secret-password');
  });

  it('should resolve credential by user and host when alias is null', async () => {
    const cred = await getCredentialByKey(null, 'ubuntu', '54.21.32.10');

    expect(cred).to.be.an('object');
    expect(cred.alias).to.equal(mockAliasKey);
    expect(cred.authType).to.equal('key');
    expect(cred.host).to.equal('54.21.32.10');
  });

  it('should resolve S3 credential and map region and accessKeyId', async () => {
    const cred = await getCredentialByKey(mockAliasS3);

    expect(cred).to.be.an('object');
    expect(cred.alias).to.equal(mockAliasS3);
    expect(cred.type).to.equal('s3');
    expect(cred.accessKeyId).to.equal('AKIAIOSFODNN7');
    expect(cred.region).to.equal('us-east-1');
  });
});
