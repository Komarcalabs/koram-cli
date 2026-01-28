const { Command, flags } = require('@oclif/command');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { NodeSSH } = require('node-ssh');
const { getCredentialByKey } = require('../../utils/index');
const ora = require('ora');

class SetupCommand extends Command {
    async run() {
        const { args } = this.parse(SetupCommand);
        const { alias } = args;

        try {
            // 1. Obtener credenciales del alias
            const credentials = await getCredentialByKey(alias);
            if (!credentials) return;

            this.log(chalk.blue(`\n🚀 Iniciando despliegue de monitoreo en: ${chalk.bold(alias)} (${credentials.user}@${credentials.host})`));

            // 2. Preguntar rol: Agente o Servidor
            const { role } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'role',
                    message: '¿Qué pieza del rompecabezas deseas desplegar?',
                    choices: [
                        { name: '🛰️  Agente (Centinela): Instala esto en cada VPS que quieras vigilar.', value: 'agent' },
                        { name: '🖥️  Servidor (El Gran Ojo): Instala esto SOLO UNA VEZ en tu VPS central.', value: 'server' }
                    ]
                }
            ]);

            let setupAnswers = {};
            if (role === 'agent') {
                setupAnswers = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'url',
                        message: 'URL del servidor central (ej: https://monitor.tu-dominio.com):',
                        validate: (input) => input.startsWith('http') ? true : 'La URL debe empezar con http o https'
                    },
                    {
                        type: 'input',
                        name: 'key',
                        message: 'API Key compartida:',
                        default: 'koram-secret-key'
                    },
                    {
                        type: 'input',
                        name: 'name',
                        message: 'Nombre identificador para este VPS (dejar vacío para usar hostname):',
                        default: alias
                    },
                    {
                        type: 'number',
                        name: 'interval',
                        message: 'Intervalo de reporte (segundos):',
                        default: 60
                    }
                ]);
            } else {
                setupAnswers = await inquirer.prompt([
                    {
                        type: 'number',
                        name: 'port',
                        message: 'Puerto para el servidor central:',
                        default: 3000
                    },
                    {
                        type: 'input',
                        name: 'key',
                        message: 'API Key compartida (para que los agentes se conecten):',
                        default: 'koram-secret-key'
                    },
                    {
                        type: 'confirm',
                        name: 'auth',
                        message: '¿Activar Autenticación Básica para el Dashboard?',
                        default: true
                    }
                ]);
            }

            const ssh = new NodeSSH();
            const spinner = ora('Conectando al servidor remoto...').start();

            try {
                await ssh.connect({
                    host: credentials.host,
                    username: credentials.user,
                    password: credentials.password
                });
                spinner.succeed('Conectado con éxito.');

                // 3. Verificar Versión de Node.js
                spinner.start('Verificando entorno Node.js...');
                const nodeVersion = await ssh.execCommand('node -v');
                if (nodeVersion.code !== 0) {
                    spinner.fail('Node.js no está instalado en el servidor remoto.');
                    this.log(chalk.yellow('💡 Por favor, instala Node.js >= 20 manualmente antes de continuar.'));
                    return;
                }

                const versionMatch = nodeVersion.stdout.match(/v(\d+)/);
                const majorVersion = versionMatch ? parseInt(versionMatch[1]) : 0;

                if (majorVersion < 20) {
                    spinner.fail(`Versión de Node.js insuficiente: ${nodeVersion.stdout.trim()}`);

                    const { upgrade } = await inquirer.prompt([{
                        type: 'confirm',
                        name: 'upgrade',
                        message: chalk.yellow(`⚠️  Se requiere Node.js >= 20. ¿Deseas intentar actualizar Node.js a la v20 automáticamente en el VPS?`),
                        default: true
                    }]);

                    if (upgrade) {
                        spinner.start('Verificando si NVM está disponible...');
                        // Intentamos detectar NVM en los lugares comunes
                        const checkNvm = await ssh.execCommand('[ -s "$HOME/.nvm/nvm.sh" ] && echo "nvm_found"');
                        const isNvmPresent = checkNvm.stdout.includes('nvm_found');

                        if (isNvmPresent) {
                            spinner.text = 'Evolucionando Node.js a la v20 usando NVM...';
                            const nvmCmd = 'bash -c "source $HOME/.nvm/nvm.sh && nvm install 20 && nvm alias default 20 && nvm use 20"';
                            const nvmRes = await ssh.execCommand(nvmCmd);

                            if (nvmRes.code === 0) {
                                spinner.succeed('Node.js actualizado a la v20 mediante NVM.');
                            } else {
                                spinner.fail('Falló la actualización por NVM.');
                                this.log(chalk.red(nvmRes.stderr || nvmRes.stdout));
                                return;
                            }
                        } else {
                            spinner.info('NVM no detectado. Intentando método alternativo (NodeSource/apt)...');
                            spinner.start('Evolucionando Node.js a la v20 (esto puede tardar un poco)...');
                            // Usamos NodeSource para la actualización (asumiendo Ubuntu/Debian/CentOS común)
                            const upgradeCmd = 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs';
                            const upgradeRes = await ssh.execCommand(upgradeCmd);

                            if (upgradeRes.code !== 0) {
                                spinner.fail('No se pudo automatizar la actualización.');
                                this.log(chalk.red(`Error: ${upgradeRes.stderr || upgradeRes.stdout}`));
                                this.log(chalk.yellow('💡 Intenta actualizar Node.js manualmente en el servidor.'));
                                return;
                            }
                            spinner.succeed('Node.js actualizado mediante NodeSource.');
                        }

                        // Re-verificar
                        const newNodeVersion = await ssh.execCommand('node -v');
                        const newMatch = newNodeVersion.stdout.match(/v(\d+)/);
                        const newMajor = newMatch ? parseInt(newMatch[1]) : 0;

                        if (newMajor < 20) {
                            spinner.fail(`La actualización falló o no fue suficiente: ${newNodeVersion.stdout.trim()}`);
                            return;
                        }
                    } else {
                        return;
                    }
                } else {
                    spinner.succeed(`Node.js ${nodeVersion.stdout.trim()} detectado.`);
                }

                // 4. Instalar Koram CLI Globalmente
                spinner.start('Instalando/Actualizando Koram CLI globalmente...');
                const installRes = await ssh.execCommand('npm i -g koram@latest');

                if (installRes.code !== 0) {
                    spinner.fail('Error al instalar Koram CLI.');
                    this.log(chalk.red(installRes.stderr));
                    return;
                }
                spinner.succeed('Koram CLI instalado globalmente.');

                // 5. Instalar PM2 si no existe
                spinner.start('Verificando PM2...');
                const hasPm2 = await ssh.execCommand('command -v pm2');
                if (hasPm2.code !== 0) {
                    spinner.text = 'Instalando PM2 globalmente...';
                    await ssh.execCommand('npm i -g pm2');
                }
                spinner.succeed('PM2 listo.');

                // 6. Lanzar proceso con PM2
                spinner.start(`Configurando ${role === 'agent' ? 'agente' : 'servidor'} en PM2...`);
                let cmd = '';
                let pm2Name = '';

                if (role === 'agent') {
                    cmd = `koram monitor:agent --url "${setupAnswers.url}" --key "${setupAnswers.key}" --name "${setupAnswers.name}" --interval ${setupAnswers.interval}`;
                    pm2Name = 'koram-agent';
                } else {
                    cmd = `koram monitor:server --port ${setupAnswers.port} --key "${setupAnswers.key}" ${setupAnswers.auth ? '--auth' : ''}`;
                    pm2Name = 'koram-server';
                }

                // Borrar si existe para evitar duplicados
                await ssh.execCommand(`pm2 delete "${pm2Name}" || true`);

                const pm2Res = await ssh.execCommand(`pm2 start "${cmd}" --name "${pm2Name}"`);

                if (pm2Res.code !== 0) {
                    spinner.fail('Error al iniciar en PM2.');
                    this.log(chalk.red(pm2Res.stderr));
                    return;
                }

                // Guardar persistencia de PM2
                await ssh.execCommand('pm2 save');

                spinner.succeed(chalk.green(`\n✅ ¡${role === 'agent' ? 'Agente' : 'Servidor'} desplegado con éxito en ${alias}!`));
                this.log(chalk.cyan(`📈 PM2 Name: ${pm2Name}`));

            } catch (sshErr) {
                spinner.fail(`Error de conexión SSH: ${sshErr.message}`);
                this.log(chalk.red('Asegúrate de que el servidor acepte conexiones y las credenciales sean correctas.'));
            } finally {
                ssh.dispose();
            }

        } catch (err) {
            this.error(chalk.red(`❌ Error inesperado: ${err.message}`));
        }
    }
}

SetupCommand.description = `Despliega automáticamente el agente o el servidor central de monitoreo en un remoto.
Utiliza tus credenciales SSH guardadas para entrar, verificar Node.js, instalar Koram e iniciar el servicio con PM2.
`;

SetupCommand.args = [
    { name: 'alias', required: true, description: 'Alias del servidor (usado en koram ssh)' },
];

module.exports = SetupCommand;
