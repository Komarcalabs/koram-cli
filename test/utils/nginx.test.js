const { expect } = require('chai');
const { generateNginxConf } = require('../../src/utils/nginx');

describe('Nginx Configuration Utility', () => {
  it('should generate correct static SPA config', () => {
    const config = {
      name: 'spa-test',
      type: 'spa',
      deploy: {
        path: '/var/www/spa-test',
        atomicDeploys: true,
      },
      webserver: {
        configs: [
          {
            serverName: 'spa.example.com',
            listen: 80,
            ssl: { enabled: false }
          }
        ]
      }
    };

    const result = generateNginxConf(config, 'production');
    expect(result).to.contain('server_name spa.example.com;');
    expect(result).to.contain('root /var/www/spa-test/current;');
    expect(result).to.contain('try_files $uri $uri/ /index.html;');
    expect(result).to.not.contain('proxy_pass');
  });

  it('should generate reverse proxy config for nuxt with dynamic port', () => {
    const config = {
      name: 'nuxt-test',
      type: 'nuxt',
      env: {
        PORT: 3500
      },
      webserver: {
        configs: [
          {
            serverName: 'nuxt.example.com',
            listen: 80,
            ssl: { enabled: false },
            locations: [
              {
                path: '/'
              }
            ]
          }
        ]
      }
    };

    const result = generateNginxConf(config, 'production');
    expect(result).to.contain('server_name nuxt.example.com;');
    expect(result).to.contain('proxy_pass http://127.0.0.1:3500;');
    expect(result).to.contain('proxy_set_header Host $host;');
  });

  it('should generate SSL redirect and 443 block when ssl is enabled', () => {
    const config = {
      name: 'ssl-test',
      type: 'nuxt',
      webserver: {
        configs: [
          {
            serverName: 'ssl.example.com',
            listen: 443,
            redirectToSsl: true,
            ssl: {
              enabled: true,
              certPath: '/etc/certs/fullchain.pem',
              keyPath: '/etc/certs/privkey.pem'
            }
          }
        ]
      }
    };

    const result = generateNginxConf(config, 'production');
    expect(result).to.contain('listen 80;');
    expect(result).to.contain('return 301 https://$host$request_uri;');
    expect(result).to.contain('listen 443 ssl;');
    expect(result).to.contain('ssl_certificate /etc/certs/fullchain.pem;');
    expect(result).to.contain('ssl_certificate_key /etc/certs/privkey.pem;');
  });

  it('should generate bootstrap configuration when bootstrapOnly option is true', () => {
    const config = {
      name: 'bootstrap-test',
      type: 'nuxt',
      webserver: {
        configs: [
          {
            serverName: 'bootstrap.example.com',
            listen: 443,
            redirectToSsl: true,
            ssl: {
              enabled: true,
              certPath: '/etc/certs/fullchain.pem',
              keyPath: '/etc/certs/privkey.pem'
            }
          }
        ]
      }
    };

    const result = generateNginxConf(config, 'production', { bootstrapOnly: true });
    // In bootstrap mode, it should only listen on port 80 and not contain any SSL directives
    expect(result).to.contain('listen 80;');
    expect(result).to.not.contain('listen 443 ssl;');
    expect(result).to.not.contain('ssl_certificate');
    expect(result).to.contain('MODO: Bootstrap Temporal');
  });

  describe('readLocalConfig candidate file resolution', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const { readLocalConfig, cleanBrokenNginxSymlinks } = require('../../src/utils/nginx');

    let tempDir;
    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koram-nginx-test-'));
      fs.mkdirSync(path.join(tempDir, '.koram', 'webserver'), { recursive: true });
    });

    afterEach(() => {
      try {
        fs.rmSync ? fs.rmSync(tempDir, { recursive: true, force: true }) : fs.unlinkSync(tempDir);
      } catch (e) {}
    });

    it('should find local template with .kr.conf extension', () => {
      const confPath = path.join(tempDir, '.koram', 'webserver', 'my-app-plan.kr.conf');
      fs.writeFileSync(confPath, '# custom kr conf', 'utf-8');

      const content = readLocalConfig(tempDir, 'my-app', 'plan');
      expect(content).to.equal('# custom kr conf');
    });

    it('should find local template with standard .conf extension as fallback', () => {
      const confPath = path.join(tempDir, '.koram', 'webserver', 'my-app-plan.conf');
      fs.writeFileSync(confPath, '# custom standard conf', 'utf-8');

      const content = readLocalConfig(tempDir, 'my-app', 'plan');
      expect(content).to.equal('# custom standard conf');
    });

    it('should return null when no local template exists', () => {
      const content = readLocalConfig(tempDir, 'my-app', 'plan');
      expect(content).to.be.null;
    });

    it('should execute broken symlink cleanup command without errors', async () => {
      const mockSsh = {
        execCommand: async (cmd) => {
          if (cmd.includes('CLEANED:')) {
            return {
              stdout: 'CLEANED:/etc/nginx/sites-enabled/3202-menstruaventura-cms-production.kr.conf\n',
              stderr: '',
              code: 0
            };
          }
          return { stdout: '', stderr: '', code: 0 };
        }
      };

      const cleaned = [];
      await cleanBrokenNginxSymlinks(mockSsh, (msg) => cleaned.push(msg));
      expect(cleaned.some(l => l.includes('3202-menstruaventura-cms-production.kr.conf'))).to.be.true;
    });
  });
});
