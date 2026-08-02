const { expect } = require('chai');
const { generateMongoDBDumpCmd, generateTarArchiveCmd } = require('../../src/utils/backup');

describe('Backup Command Utilities', () => {
  describe('generateMongoDBDumpCmd', () => {
    it('should generate a simple mongodump command with only database name', () => {
      const dbConfig = {
        name: 'test_db'
      };
      const remoteFile = '/tmp/backup.archive';
      const cmd = generateMongoDBDumpCmd(dbConfig, remoteFile);

      expect(cmd).to.equal("mongodump --db test_db --archive='/tmp/backup.archive' --gzip");
    });

    it('should generate a complex mongodump command with host, port, credentials and authSource', () => {
      const dbConfig = {
        name: 'test_db',
        host: '192.168.1.100',
        port: 27018,
        user: 'admin_user',
        pass: 'securePassword123',
        authSource: 'admin_db'
      };
      const remoteFile = '/tmp/backup.archive';
      const cmd = generateMongoDBDumpCmd(dbConfig, remoteFile);

      expect(cmd).to.contain('mongodump');
      expect(cmd).to.contain('--host 192.168.1.100');
      expect(cmd).to.contain('--port 27018');
      expect(cmd).to.contain('--username admin_user');
      expect(cmd).to.contain("--password 'securePassword123'");
      expect(cmd).to.contain('--db test_db');
      expect(cmd).to.contain('--authenticationDatabase admin_db');
      expect(cmd).to.contain("--archive='/tmp/backup.archive' --gzip");
    });
  });

  describe('generateTarArchiveCmd', () => {
    it('should generate correct tar command for directories without exclusions', () => {
      const pathConfig = {
        path: '/var/www/my-app/uploads'
      };
      const remoteFile = '/var/backups/uploads.tar.gz';
      const cmd = generateTarArchiveCmd(pathConfig, remoteFile);

      expect(cmd).to.equal("tar -czf '/var/backups/uploads.tar.gz'  -C '/var/www/my-app' 'uploads'");
    });

    it('should generate correct tar command for directories with multiple exclusions', () => {
      const pathConfig = {
        path: '/var/www/my-app/uploads/',
        exclude: ['*.tmp', 'cache/*', 'temp/*']
      };
      const remoteFile = '/var/backups/uploads.tar.gz';
      const cmd = generateTarArchiveCmd(pathConfig, remoteFile);

      expect(cmd).to.equal("tar -czf '/var/backups/uploads.tar.gz' --exclude='*.tmp' --exclude='cache/*' --exclude='temp/*' -C '/var/www/my-app' 'uploads'");
    });
  });
});
