// src/commands/deploy-logs.js
const glob = require('glob');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const inquirer = require('inquirer');
const keytar = require('keytar');
const { NodeSSH } = require('node-ssh');


module.exports.selectKoramConfig = async function (projectRoot, envFlag) {

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


module.exports.getCredentialByKey = async function (alias, username, hostname) {

    // Leer credenciales
    const credFile = path.join(os.homedir(), '.koram_credentials.json');
    if (!fs.existsSync(credFile)) {
        console.log(chalk.red('❌ No se encontraron credenciales guardadas'));
        return;
    }
    const allCreds = JSON.parse(fs.readFileSync(credFile));
    var keys;
    if (alias) {
        keys = Object.keys(allCreds).filter(k => k.startsWith(alias + ':'));
    } else {
        keys = Object.keys(allCreds).filter(k => k.endsWith(':' + username) && allCreds[k].host == hostname);
    }

    console.log(keys, "llaves", alias, username, hostname,allCreds)

    let keyToUse = keys[0] || '';
    if (keys.length > 1) {
        const choices = keys.map(k => {
            let user = k.split(':')[1];
            let host = allCreds[k].host || '-';
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
    return {
        alias,
        user,
        host,
        password
    };
}