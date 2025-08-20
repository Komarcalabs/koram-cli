export async function selectKoramConfig(projectRoot, envFlag) {
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

export const getCredentialByKey = function (alias, user, host) {

    // Leer credenciales
    const credFile = path.join(os.homedir(), '.koram_credentials.json');
    if (!fs.existsSync(credFile)) {
        console.log(chalk.red('❌ No se encontraron credenciales guardadas'));
        return;
    }
    const allCreds = JSON.parse(fs.readFileSync(credFile));
    if (alias) {
        const keys = Object.keys(allCreds).filter(k => k.startsWith(alias + ':'));
    } else {
        const keys = Object.keys(allCreds).filter(k => k.endsWith(':' + user) && allCreds[k].host == host);
    }

    return keys;
}