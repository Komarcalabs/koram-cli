// src/commands/deploy-logs.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { NodeSSH } = require('node-ssh');
const ora = require('ora');
const { selectKoramConfig, getCredentialByKey } = require('../../utils/index');

// ------------------------------
// Helpers visuales
// ------------------------------
const log = {
  info: (msg) => console.log(chalk.blue(`ℹ️  ${msg}`)),
  success: (msg) => console.log(chalk.green(`✅ ${msg}`)),
  warn: (msg) => console.log(chalk.yellow(`⚠️  ${msg}`)),
  error: (msg) => console.log(chalk.red(`❌ ${msg}`)),
  action: (msg) => console.log(chalk.magenta(`🚀 ${msg}`)),
};

const section = (title) => {
  console.log(chalk.bold.cyan('\n────────────────────────────'));
  console.log(chalk.bold(title));
  console.log(chalk.bold.cyan('────────────────────────────\n'));
};

// ------------------------------
// Formateador de logs
// ------------------------------
function formatLogLine(line, withTimestamp, isError = false) {
  let formatted = line.trim();
  let icon = '';

  if (/ERROR|Error|error/.test(line)) {
    formatted = chalk.red(line);
    icon = '❌ ';
  } else if (/WARN|Warning|warn/.test(line)) {
    formatted = chalk.yellow(line);
    icon = '⚠️  ';
  } else if (/INFO|Info|info/.test(line)) {
    formatted = chalk.cyan(line);
    icon = 'ℹ️  ';
  } else if (/DEBUG|Debug|debug/.test(line)) {
    formatted = chalk.gray(line);
    icon = '🐛 ';
  } else {
    formatted = isError ? chalk.red(line) : chalk.green(line);
    // formatted = isError ? chalk.red(line) : line
  }

  const ts = withTimestamp ? chalk.gray(`[${new Date().toLocaleTimeString()}] `) : '';
  return ts + icon + formatted //+ '\n';
}

// ------------------------------
// Command
// ------------------------------
class DeployLogsCommand extends Command {
  async run() {
    try {
      let { args, flags } = this.parse(DeployLogsCommand);

      if (!flags.process && args.process) flags.process = args.process;
      if (!flags.lines && args.lines) flags.lines = args.lines;

      const projectRoot = process.cwd();
      let configFile = JSON.parse(
        fs.readFileSync(await selectKoramConfig(projectRoot, flags.env))
      );

      const alias = args.alias;
      if (!alias) {
        return log.error('Debes indicar un alias de servidor');
      }

      let credentials = {
        user: configFile.server.user,
        host: configFile.server.host,
      };

      if (alias === '.') {
        credentials = await getCredentialByKey(null, credentials.user, credentials.host);
      } else {
        credentials = await getCredentialByKey(alias);
      }

      const { password, user, host } = credentials;
      const useSSHKey = flags.sshKey || false;
      let sshKeyPath = null;

      if (useSSHKey) {
        sshKeyPath = configFile.server.sshKey || null;
        if (!sshKeyPath && !process.env.SSH_AUTH_SOCK) {
          return log.error(`No se encontró la SSH key para alias "${alias}"`);
        }
      }

      const spinner = ora(
        `Conectando a ${user}@${host} usando ${useSSHKey ? 'SSH key' : 'password'}...`
      ).start();
      const ssh = new NodeSSH();

      try {
        const sshConfig = { host, username: user };

        if (useSSHKey) {
          if (sshKeyPath) {
            const tempKeyPath = path.join(os.tmpdir(), `koram_temp_key_${Date.now()}`);
            fs.writeFileSync(tempKeyPath, fs.readFileSync(sshKeyPath, 'utf8'), { mode: 0o600 });
            sshConfig.privateKey = tempKeyPath;
          } else if (process.env.SSH_AUTH_SOCK) {
            sshConfig.agent = process.env.SSH_AUTH_SOCK;
          }
        } else if (password) {
          sshConfig.password = password;
        } else {
          spinner.fail('No se proporcionó ni contraseña ni SSH key');
          return;
        }

        await ssh.connect(sshConfig);
        spinner.succeed(`Conectado a ${chalk.cyan(`${user}@${host}`)}`);

        // Obtener procesos PM2
        section(`Procesos PM2 en ${host}`);
        const lsResult = await ssh.execCommand('pm2 jlist');
        if (!lsResult.stdout) {
          return log.error('No se pudo obtener la lista de procesos PM2');
        }

        const processes = JSON.parse(lsResult.stdout);
        let procName = flags.process;
        if (!procName) {
          const choices = processes.map((p) => ({
            name: `${chalk.green(p.name)} ${chalk.gray(`(id: ${p.pm_id})`)}`,
            value: p.name,
          }));
          const answer = await inquirer.prompt([
            {
              type: 'list',
              name: 'selected',
              message: 'Selecciona el proceso para ver logs:',
              choices,
            },
          ]);
          procName = answer.selected;
        }

        if(!flags.lines) flags.follow = true; // SOLO CUANDO SE PASA LINES SE PUEDE CORTAR EL STREAM
        const lines = flags.lines || 50;
        // Si usas -f => sigue escuchando (no se desconecta).
        // Si NO usas -f => usa --nostream para desconectarse después de mostrar N líneas.
        const follow = flags.follow
        ? `--lines ${lines} --raw`
        : `--lines ${lines} --raw --nostream`;


        section(`Logs de ${procName} en ${host}`);
        log.info(
          `Mostrando ${lines} líneas ${flags.follow ? 'y siguiendo en tiempo real' : ''}${
            flags.timestamps ? ' con timestamps' : ''
          }...`
        );

        // Ejecutar logs con timestamps + coloreado
        await ssh.exec(`pm2 logs ${procName} ${follow}`, [], {
          stream: 'stdout',
          onStdout(chunk) {
            process.stdout.write(formatLogLine(chunk.toString(), flags.timestamps));
          },
          onStderr(chunk) {
            process.stderr.write(formatLogLine(chunk.toString(), flags.timestamps, true));
          },
        });

        ssh.dispose();
      } catch (err) {
        spinner.fail('Error en la conexión');
        log.error(err.message);
      }
    } catch (error) {
      log.error(error.message);
    }
  }
}

// ------------------------------
// Configuración Oclif
// ------------------------------
DeployLogsCommand.description = `Obtiene logs de PM2 para un alias de servidor usando credenciales Koram.
Soporta múltiples entornos y selección interactiva de proceso.
Opciones:
  --ssh-key (-k)      Usar SSH key
  --process (-p)      Nombre del proceso
  --lines (-l)        Número de líneas
  --follow (-f)       Seguir logs en tiempo real
  --timestamps (-t)   Mostrar timestamps en cada línea con color e íconos
`;

DeployLogsCommand.args = [
  { name: 'alias', required: true, description: 'Alias del servidor a obtener logs' },
  { name: 'process', required: false },
  { name: 'lines', required: false },
];

DeployLogsCommand.flags = {
  env: flags.string({ char: 'e', description: 'Entorno a usar', default: '' }),
  sshKey: flags.boolean({ char: 'k', description: 'Usar SSH key en lugar de password' }),
  process: flags.string({ char: 'p', description: 'Nombre del proceso PM2 a mostrar' }),
  lines: flags.integer({ char: 'l', description: 'Número de líneas a mostrar'}),
  follow: flags.boolean({ char: 'f', description: 'Seguir logs en tiempo real' }),
  timestamps: flags.boolean({ char: 't', description: 'Mostrar timestamps en cada línea' }),
};

module.exports = DeployLogsCommand;
