const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { NodeSSH } = require('node-ssh');
const { selectKoramConfig, getCredentialByKey } = require('../../utils/index');

class RemoteCleanCommand extends Command {
  async run() {
    const { args, flags } = this.parse(RemoteCleanCommand);
    const alias = args.alias || '.';
    const auto = flags.yes || false;
    const projectRoot = process.cwd();

    try {
      let configFile = {};
      let credentials = {};

      if (alias === '.') {
        const rcPath = await selectKoramConfig(projectRoot, flags.env);
        if (rcPath && fs.existsSync(rcPath)) {
          configFile = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
          credentials = await getCredentialByKey(null, configFile.server?.user || configFile.user, configFile.server?.host || configFile.host);
        }
      } else {
        credentials = await getCredentialByKey(alias);
      }

      if (!credentials || !credentials.host) {
        this.log(chalk.red(`❌ No se pudieron resolver credenciales para el servidor "${alias}".`));
        return;
      }

      const { user, host, password, keyPath, authType, passphrase } = credentials;

      console.log(chalk.cyan(`\n🧹 Conectando a ${user}@${host} para el ritual de purificación remota...\n`));

      const ssh = new NodeSSH();
      const connectionOpts = {
        host: host,
        port: parseInt(credentials.port) || 22,
        username: user,
        tryKeyboard: true,
      };

      if (keyPath && fs.existsSync(keyPath)) {
        connectionOpts.privateKey = fs.readFileSync(keyPath, 'utf8');
        if (passphrase) connectionOpts.passphrase = passphrase;
      } else if (password) {
        connectionOpts.password = password;
      }

      await ssh.connect(connectionOpts);
      console.log(chalk.green(`✅ Conexión SSH establecida con el servidor remoto.\n`));

      // 1. Estado inicial del disco
      const dfBefore = await ssh.execCommand('df -h /');
      console.log(chalk.blue('📊 Estado inicial del disco:'));
      console.log(chalk.gray(dfBefore.stdout.trim()) + '\n');

      const steps = [
        {
          name: 'Logs de PM2',
          desc: 'Vaciar todos los logs acumulados en PM2 (pm2 flush)',
          cmd: 'pm2 flush || (bash -l -c "pm2 flush")'
        },
        {
          name: 'Logs del Sistema (journalctl)',
          desc: 'Vaciar journals antiguos del sistema a 100MB',
          cmd: 'sudo journalctl --vacuum-size=100M 2>/dev/null || journalctl --vacuum-size=100M'
        },
        {
          name: 'Caché de Paquetes APT',
          desc: 'Limpiar caché de paquetes descargados (apt-get clean)',
          cmd: 'sudo apt-get clean 2>/dev/null || true'
        },
        {
          name: 'Caché de NPM',
          desc: 'Limpiar caché de npm del usuario (npm cache clean --force)',
          cmd: 'npm cache clean --force 2>/dev/null || true'
        }
      ];

      for (const step of steps) {
        let proceed = auto;
        if (!auto) {
          const answer = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: `¿Deseas purificar: ${step.desc}?`,
            default: true
          }]);
          proceed = answer.proceed;
        }

        if (proceed) {
          console.log(chalk.yellow(`⚡ Purificando ${step.name}...`));
          const res = await ssh.execCommand(step.cmd);
          if (res.stdout) console.log(chalk.gray(res.stdout.trim()));
          console.log(chalk.green(`✔ ${step.name} purificado`));
        } else {
          console.log(chalk.blue(`⏩ ${step.name} omitido`));
        }
      }

      // Estado final del disco
      const dfAfter = await ssh.execCommand('df -h /');
      console.log(chalk.magenta('\n✨ Ritual de purificación remota finalizado. Estado actual del disco:'));
      console.log(chalk.cyan(dfAfter.stdout.trim()) + '\n');

      ssh.dispose();
    } catch (err) {
      console.log(chalk.red(`❌ Error durante la purificación remota: ${err.message}`));
    }
  }
}

RemoteCleanCommand.description = `Purifica y libera espacio en disco en un servidor remoto SSH.
Vacía logs de PM2 (pm2 flush), logs de systemd (journalctl), cachés de apt y npm.
`;

RemoteCleanCommand.args = [
  { name: 'alias', required: false, description: 'Alias del servidor o "." para usar el contexto local', default: '.' }
];

RemoteCleanCommand.flags = {
  env: flags.string({ char: 'e', description: 'Entorno configurado en .koram-rc.<env>.json' }),
  yes: flags.boolean({ char: 'y', description: 'Ejecutar todas las tareas de purificación sin preguntar' }),
};

module.exports = RemoteCleanCommand;
