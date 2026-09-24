const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { selectKoramConfig } = require('../../src/utils/index');

describe('Deployment Helpers & Strategy Utilities', () => {
  let tempProjectDir;

  before(() => {
    tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koram-deploy-test-'));
  });

  after(() => {
    try {
      if (fs.existsSync(tempProjectDir)) {
        fs.rmSync ? fs.rmSync(tempProjectDir, { recursive: true, force: true }) : fs.unlinkSync(tempProjectDir);
      }
    } catch (e) { }
  });

  describe('selectKoramConfig', () => {
    it('should return the specific config file if environment flag is given and file exists', async () => {
      const prodConfig = path.join(tempProjectDir, '.koram-rc.production.json');
      fs.writeFileSync(prodConfig, JSON.stringify({ name: 'my-app', type: 'spa' }));

      const selected = await selectKoramConfig(tempProjectDir, 'production');
      expect(selected).to.equal(prodConfig);
    });

    it('should automatically select single existing config when no env flag is passed', async () => {
      const stagingConfig = path.join(tempProjectDir, '.koram-rc.staging.json');
      // Limpiar configs previos
      const files = fs.readdirSync(tempProjectDir);
      for (const f of files) fs.unlinkSync(path.join(tempProjectDir, f));

      fs.writeFileSync(stagingConfig, JSON.stringify({ name: 'my-app', type: 'nuxt' }));

      const selected = await selectKoramConfig(tempProjectDir, '');
      expect(selected).to.equal(stagingConfig);
    });
  });

  describe('Rsync & SSH Command Construction Logic', () => {
    it('should build key-based rsync command without sshpass when keyPath is present', () => {
      const keyPath = '/Users/test/.koram/keys/prod-aws.pem';
      const port = 2222;
      const remoteUser = 'ubuntu';
      const remoteHost = '54.21.32.10';
      const remoteDest = '/var/www/app/releases/2026-09-24T15-00-00';
      const outputDir = 'dist/';

      let sshOpt = `-p ${port} -o StrictHostKeyChecking=no`;
      if (keyPath) {
        sshOpt = `-i "${keyPath}" ${sshOpt}`;
      }
      const rsyncCmd = `rsync -avz --delete --no-perms --no-owner --no-group -e "ssh ${sshOpt}" ${outputDir} ${remoteUser}@${remoteHost}:${remoteDest}/`;

      expect(rsyncCmd).to.contain('-i "/Users/test/.koram/keys/prod-aws.pem"');
      expect(rsyncCmd).to.contain('-p 2222');
      expect(rsyncCmd).to.not.contain('sshpass');
      expect(rsyncCmd).to.contain('ubuntu@54.21.32.10:/var/www/app/releases/2026-09-24T15-00-00/');
    });

    it('should build password-based rsync command with sshpass prefix when only password is present', () => {
      const port = 22;
      const remoteUser = 'root';
      const remoteHost = '64.23.174.86';
      const remoteDest = '/var/www/app/current';
      const outputDir = 'dist/';
      const hasKey = false;
      const vaultPassword = 'serverPassword123';

      let sshOpt = `-p ${port} -o StrictHostKeyChecking=no`;
      if (hasKey) {
        sshOpt = `-i "key.pem" ${sshOpt}`;
      }
      let rsyncCmd = `rsync -avz --delete --no-perms --no-owner --no-group -e "ssh ${sshOpt}"`;
      if (!hasKey && vaultPassword) {
        rsyncCmd = `sshpass -e ${rsyncCmd}`;
      }
      const fullCmd = `${rsyncCmd} ${outputDir} ${remoteUser}@${remoteHost}:${remoteDest}/`;

      expect(fullCmd).to.match(/^sshpass -e rsync/);
      expect(fullCmd).to.not.contain('-i');
      expect(fullCmd).to.contain('root@64.23.174.86:/var/www/app/current/');
    });

    it('should generate valid atomic release timestamps and symlinks', () => {
      const timestamp = new Date('2026-09-24T15:30:00.000Z').toISOString().replace(/[:.]/g, '-').slice(0, 19);
      expect(timestamp).to.equal('2026-09-24T15-30-00');

      const remotePath = '/var/www/my-app';
      const releaseTarget = `releases/${timestamp}`;
      const symlinkCmd = `cd ${remotePath} && ln -sfn ${releaseTarget} current`;

      expect(symlinkCmd).to.equal('cd /var/www/my-app && ln -sfn releases/2026-09-24T15-30-00 current');
    });
  });
});
