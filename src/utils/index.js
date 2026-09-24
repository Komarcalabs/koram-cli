// src/commands/deploy-logs.js
const glob = require('glob');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { NodeSSH } = require('node-ssh');
let keytar;
try {
    keytar = require('keytar');
} catch (err) {
    keytar = null;
}
async function createDefaultKoramRc(projectRoot, env) {
    const appName = path.basename(projectRoot);
    const rcFileName = `.koram-rc.${env}.json`;
    const rcPath = path.join(projectRoot, rcFileName);

    const defaultConfig = {
      name: appName,
      type: 'spa',
      server: {
        host: '',
        user: '',
        port: 22
      },
      deploy: {
        repository: '',
        branch: 'main',
        path: `/var/www/${appName}`,
        outputDir: 'dist',
        buildCommand: 'npm run build',
        atomicDeploys: true,
        preDeploy: [],
        postDeploy: []
      },
      processes: [
        {
          name: appName,
          command: `pm2 start dist/index.js --name ${appName}`
        }
      ],
      advanced: {
        usePm2: true,
        optimizeNpm: true,
        localNpmInstall: false
      },
      env: {
        NODE_ENV: env,
        PORT: 3000
      }
    };

    fs.writeFileSync(rcPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    console.log(chalk.green(`\n✅ Archivo de configuración por defecto ${rcFileName} creado.`));
}

module.exports.selectKoramConfig = async function (projectRoot, envFlag) {
    let configPath;
    if (envFlag) {
        // Si el usuario pasó -e
        configPath = path.join(projectRoot, `.koram-rc.${envFlag}.json`);
        if (!fs.existsSync(configPath)) {
            const { init } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'init',
                    message: `No se encontró el archivo .koram-rc.${envFlag}.json. ¿Deseas inicializarlo ahora?`,
                    default: true
                }
            ]);
            if (init) {
                await createDefaultKoramRc(projectRoot, envFlag);
            } else {
                throw new Error(`❌ No se encontró archivo ${configPath}`);
            }
        }
    } else {
        // Buscar todos los .koram-rc.*.json
        let configs = glob.sync(path.join(projectRoot, `.koram-rc.*.json`));
        if (configs.length === 0) {
            const { init } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'init',
                    message: 'No se encontró ningún archivo de configuración .koram-rc.*.json. ¿Deseas inicializar .koram-rc.production.json por defecto?',
                    default: true
                }
            ]);
            if (init) {
                await createDefaultKoramRc(projectRoot, 'production');
                configs = [path.join(projectRoot, '.koram-rc.production.json')];
            } else {
                throw new Error(`❌ No se encontró ningún archivo .koram-rc.*.json en ${projectRoot}`);
            }
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

module.exports.getCredentialByKey = async function (alias, username, hostname) {
    // Leer credenciales
    const credFile = path.join(os.homedir(), '.koram_credentials.json');
    if (!fs.existsSync(credFile)) {
        console.log(chalk.red('❌ No se encontraron credenciales guardadas'));
        return;
    }
    const allCreds = JSON.parse(fs.readFileSync(credFile));

    let keys;
    if (alias) {
        keys = Object.keys(allCreds).filter(k => k.startsWith(alias + ':') || allCreds[k].host === alias);
    } else if (username && hostname) {
        keys = Object.keys(allCreds).filter(k => k.endsWith(':' + username) && allCreds[k].host === hostname);
    } else {
        keys = Object.keys(allCreds);
    }

    if (keys.length === 0) {
        console.log(chalk.red('❌ No se encontraron credenciales que coincidan'));
        return;
    }

    // Elegir cuál usar si hay varias
    let keyToUse = keys[0];
    if (keys.length > 1) {
        const choices = keys.map(k => {
            let user = k.split(':')[1];
            let host = allCreds[k].host || '-';
            return { name: `${user}@${k.split(':')[0]} | Host: ${host}`, value: k };
        });
        const answer = await inquirer.prompt([{
            type: 'list',
            name: 'selected',
            message: `Se encontraron varias credenciales, selecciona cuál usar:`,
            choices
        }]);
        keyToUse = answer.selected;
    }

    const [aliasName, user] = keyToUse.split(':');
    const host = allCreds[keyToUse].host;

    // Obtener contraseña: primero keytar, si falla fallback
    let password = null;
    let origen = chalk.green('keytar');

    if (keytar) {
        try {
            password = await keytar.getPassword('koram', keyToUse);
        } catch (err) {
            // Si Keytar falla, usar fallback
            password = allCreds[keyToUse].password || null;
            origen = chalk.yellow('fallback ⚠️');
        }
    }

    // Si keytar no estaba disponible o no devolvió nada, fallback
    if (!password && allCreds[keyToUse].password) {
        password = allCreds[keyToUse].password;
        origen = chalk.yellow('fallback ⚠️');
    }

    const credData = allCreds[keyToUse] || {};
    let keyPath = credData.keyPath || null;
    if (keyPath) {
        keyPath = keyPath.replace(/^~(?=$|\/|\\)/, os.homedir());
    }

    const authType = credData.authType || (keyPath ? 'key' : 'password');

    // Asegurar permisos 0600 en el archivo de llave si existe
    if (keyPath && fs.existsSync(keyPath)) {
        try {
            fs.chmodSync(keyPath, 0o600);
        } catch (e) { }
    }

    return {
        alias: aliasName,
        user,
        host,
        password,
        origen,
        type: credData.type || 'server',
        authType,
        keyPath,
        passphrase: authType === 'key' ? password : null,
        privateKey: keyPath && fs.existsSync(keyPath) ? fs.readFileSync(keyPath) : null,
        accessKeyId: credData.accessKeyId || undefined,
        region: credData.region || undefined
    };
};

const keysUtils = require('./keys');
module.exports.getKoramKeysDir = keysUtils.getKoramKeysDir;
module.exports.ensureKoramKeysDir = keysUtils.ensureKoramKeysDir;
module.exports.storeKoramKey = keysUtils.storeKoramKey;
module.exports.removeKoramKey = keysUtils.removeKoramKey;

/**
 * Asegura que el entorno de Python exista y sea compatible (>= 3.7).
 * Si no existe o es incompatible, lo instala bajo demanda si el usuario aprueba.
 */
module.exports.ensurePythonEnv = async function () {
    const cliRootPath = path.resolve(__dirname, '../../');
    const venvPythonPath = path.join(cliRootPath, 'venv/bin/python3');

    // Función interna para chequear versión
    const getVersion = () => {
        try {
            const { execSync } = require('child_process');
            const output = execSync('python3 --version', { encoding: 'utf8' });
            const match = output.match(/Python (\d+)\.(\d+)/);
            if (match) return { major: parseInt(match[1]), minor: parseInt(match[2]), full: output.trim() };
        } catch { }
        return null;
    };

    const isVenvPresent = fs.existsSync(venvPythonPath);
    const sysVersion = getVersion();
    const isSysCompatible = sysVersion && (sysVersion.major > 3 || (sysVersion.major === 3 && sysVersion.minor >= 7));

    if (isVenvPresent) {
        return venvPythonPath;
    }

    if (!isSysCompatible) {
        const reason = sysVersion ? `(Versión detectada: ${sysVersion.full} es muy antigua)` : '(Python3 no encontrado)';
        console.log(chalk.yellow(`\n⚠️  Este comando requiere Python 3.7+ y no se pudo validar en el sistema ${reason}.`));
    } else {
        console.log(chalk.yellow('\n⚠️  Este comando requiere un entorno de Python que no ha sido configurado.'));
    }

    const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: '¿Deseas intentar configurar el entorno Python ahora? (Esto es necesario para Nuxt/SPA deploys)',
        default: true
    }]);

    if (confirm) {
        console.log(chalk.cyan('🚀 Iniciando ritual de configuración de Python...'));
        try {
            const { execSync } = require('child_process');
            const installScript = path.join(cliRootPath, 'src/scripts/install-python.js');
            // Ejecutamos el script de instalación
            execSync(`node ${installScript}`, { stdio: 'inherit' });

            if (fs.existsSync(venvPythonPath)) {
                console.log(chalk.green('✅ Entorno Python listo. Prosiguamos.'));
                return venvPythonPath;
            }
        } catch (err) {
            console.error(chalk.red('❌ Falló la configuración de Python.'));
        }
    }

    throw new Error('❌ No se puede continuar sin un entorno Python 3.7+ compatible.');
};