// src/commands/deploy-logs.js
const { Command, flags } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const inquirer = require('inquirer');
const keytar = require('keytar');
const { NodeSSH } = require('node-ssh');

async function selectKoramConfig(projectRoot, envFlag) {
    let configPath;

    if (envFlag) {
        // Si el usuario pasó -e
        configPath = path.join(projectRoot, `.koram-rc.${envFlag}.json`);
        if (!fs.existsSync(configPath)) {
            throw new Error(`❌ No se encontró archivo ${configPath}`);
        }
    } else {
        // Buscar todos los .koram-rc.*.json
        const configs = glob.sync(path.join(projectRoot, `.koram-rc.*.json`));

        if (configs.length === 0) {
            throw new Error(`❌ No se encontró ningún archivo .koram-rc.*.json en ${projectRoot}`);
        }

        if (configs.length === 1) {
            configPath = configs[0]; // Solo uno → usar ese directamente
        } else {
            // Preguntar al usuario
            const { chosen } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'chosen',
                    message: 'Se encontraron múltiples entornos, selecciona uno:',
                    choices: configs.map(c => ({
                        name: path.basename(c).replace('.koram-rc.', '').replace('.json', ''),
                        value: c,
                    })),
                },
            ]);
            configPath = chosen;
        }
    }

    return configPath;
}

class DeployLogsCommand extends Command {
    async run() {
        let { args, flags } = this.parse(DeployLogsCommand);

        // Permitir forma corta: alias proceso lines
        if (!flags.process && args.process) {
            flags.process = args.process;
        }
        if (!flags.lines && args.lines) {
            flags.lines = args.lines;
        }

        const projectRoot = process.cwd();

        let conf = await selectKoramConfig(projectRoot,flags.env)

        console.log(conf,"configuracion")

        const alias = args.alias;
        if (!alias) {
            console.log(chalk.red('❌ Debes indicar un alias de servidor'));
            return;
        }

        // Leer credenciales
        const credFile = path.join(os.homedir(), '.koram_credentials.json');
        if (!fs.existsSync(credFile)) {
            console.log(chalk.red('❌ No se encontraron credenciales guardadas'));
            return;
        }
        const allCreds = JSON.parse(fs.readFileSync(credFile));
        const keys = Object.keys(allCreds).filter(k => k.startsWith(alias + ':'));
        if (!keys.length) {
            console.log(chalk.red(`❌ No se encontró credencial para alias "${alias}"`));
            return;
        }

        // Seleccionar credencial si hay varias
        let keyToUse = keys[0];
        if (keys.length > 1) {
            const choices = keys.map(k => {
                const user = k.split(':')[1];
                const host = allCreds[k].host || '-';
                return { name: `${user}@${alias} | Host: ${host}`, value: k };
            });
            const answer = await inquirer.prompt([{
                type: 'list',
                name: 'selected',
                message: `Se encontraron varias credenciales para alias "${alias}", selecciona cuál usar:`,
                choices
            }]);
            keyToUse = answer.selected;
        }

        const [aliasName, user] = keyToUse.split(':');
        const host = allCreds[keyToUse].host;
        if (!host) {
            console.log(chalk.red(`❌ No se encontró host definido para ${user}@${aliasName}`));
            return;
        }

        const password = await keytar.getPassword('koram', keyToUse);
        const useSSHKey = flags.sshKey || false;

        // Leer .koram-rc para obtener ruta SSH key
        const koramRCFile = path.join(process.cwd(), `.koram-rc.${flags.env || 'production'}`);
        let sshKeyPath = null;
        if (fs.existsSync(koramRCFile)) {
            const rcConfig = JSON.parse(fs.readFileSync(koramRCFile, 'utf8'));
            sshKeyPath = rcConfig[alias]?.sshKey || null;
        }

        if (useSSHKey && !sshKeyPath && !process.env.SSH_AUTH_SOCK) {
            console.log(chalk.red(`❌ No se encontró la SSH key para alias "${alias}" en ${koramRCFile}`));
            return;
        }

        console.log(chalk.green(`🚀 Conectando al servidor ${user}@${host} usando ${useSSHKey ? 'SSH key' : 'password'}...`));

        const ssh = new NodeSSH();
        try {
            const sshConfig = { host, username: user };

            if (useSSHKey) {
                if (sshKeyPath) {
                    // Guardar temporalmente la key
                    const tempKeyPath = path.join(os.tmpdir(), `koram_temp_key_${Date.now()}`);
                    fs.writeFileSync(tempKeyPath, fs.readFileSync(sshKeyPath, 'utf8'), { mode: 0o600 });
                    sshConfig.privateKey = tempKeyPath;
                } else if (process.env.SSH_AUTH_SOCK) {
                    sshConfig.agent = process.env.SSH_AUTH_SOCK;
                }
            } else if (password) {
                sshConfig.password = password;
            } else {
                console.log(chalk.red('❌ No se proporcionó ni contraseña ni SSH key'));
                return;
            }

            await ssh.connect(sshConfig);

            console.log(chalk.blue(`🔹 Obteniendo lista de procesos PM2 en ${host}...`));
            const lsResult = await ssh.execCommand('pm2 jlist');
            if (!lsResult.stdout) {
                console.log(chalk.red('❌ No se pudo obtener la lista de procesos PM2'));
                return;
            }

            const processes = JSON.parse(lsResult.stdout);
            let procName = flags.process;
            if (!procName) {
                const choices = processes.map(p => ({
                    name: `${p.name} (id: ${p.pm_id})`,
                    value: p.name
                }));
                const answer = await inquirer.prompt([{
                    type: 'list',
                    name: 'selected',
                    message: 'Selecciona el proceso para ver logs:',
                    choices
                }]);
                procName = answer.selected;
            }

            const lines = flags.lines || 50;
            const follow = flags.follow ? '--lines 0 --raw' : `--lines ${lines}`;
            console.log(chalk.blue(`🔹 Obteniendo logs de "${procName}" en ${host}...`));

            // Ejecutar pm2 logs en tiempo real
            await ssh.exec(`pm2 logs ${procName} ${follow}`, [], {
                stream: 'stdout',
                onStdout(chunk) { process.stdout.write(chunk); },
                onStderr(chunk) { process.stderr.write(chunk); },
            });

            ssh.dispose();
        } catch (err) {
            console.log(chalk.red('❌ Error al obtener logs:'), err.message);
        }
    }
}

DeployLogsCommand.description = `Obtiene logs de PM2 para un alias de servidor usando tus credenciales Koram.
Si se desea omitir la contraseña y usar la llave SSH definida en .koram-rc o en el agente, usar --ssh-key o -k.
Permite múltiples entornos .koram-rc.* y selección de proceso.
Se puede usar --lines, --process y --follow para logs en tiempo real.`;

DeployLogsCommand.args = [
    { name: 'alias', required: true, description: 'Alias del servidor a obtener logs' },
    { name: 'process', required: false },
    { name: 'lines', required: false },
];

DeployLogsCommand.flags = {
    env: flags.string({ char: 'e', description: 'Entorno a usar', default: 'production' }),
    sshKey: flags.boolean({ char: 'k', description: 'Usar SSH key en lugar de password' }),
    process: flags.string({ char: 'p', description: 'Nombre del proceso PM2 a mostrar' }),
    lines: flags.integer({ char: 'l', description: 'Número de líneas a mostrar', default: 50 }),
    follow: flags.boolean({ char: 'f', description: 'Seguir logs en tiempo real' }),
};

module.exports = DeployLogsCommand;
