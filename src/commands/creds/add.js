const { Command, flags } = require('@oclif/command');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { storeKoramKey } = require('../../utils/keys');
let keytar;

try {
  keytar = require('keytar');
} catch (err) {
  // Si no hay keytar disponible (ej: WSL)
  keytar = null;
}

class CredentialAddCommand extends Command {
  async run() {
    const { args, flags } = this.parse(CredentialAddCommand);
    let alias = args.alias ? args.alias.trim() : '';
    let user = args.user ? args.user.trim() : '';
    let host = args.host ? args.host.trim() : '';

    // Determinar tipo inicial
    let type = flags.type || '';
    if (flags.key) {
      type = 'key';
    } else if (user === 's3' || flags.type === 's3') {
      type = 's3';
    }

    // 1. Si no se especificó tipo y no hay flags de llave, lanzar selector interactivo
    if (!type && (!alias || !user)) {
      console.log(chalk.cyan('\n🔮 Bóveda de Seguridad Koram - Registro de Credencial\n'));
      const typeAns = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedType',
          message: '¿Qué tipo de credencial deseas registrar?',
          choices: [
            { name: '🛡️  Servidor SSH con Llave Privada (.pem, id_rsa) [Recomendado]', value: 'key' },
            { name: '🔑 Servidor SSH con Contraseña tradicional', value: 'server' },
            { name: '☁️  Almacenamiento AWS S3 (Access Key / Secret Key)', value: 's3' }
          ],
          default: 'key'
        }
      ]);
      type = typeAns.selectedType;
    } else if (!type) {
      type = 'server';
    }

    // 2. Solicitar Alias si no fue proporcionado
    if (!alias) {
      const aliasPrompt = await inquirer.prompt([
        {
          type: 'input',
          name: 'alias',
          message: 'Introduce un alias para identificar la credencial (ej: prod-aws, vps-prod):',
          validate: (input) => {
            const trimmed = input.trim();
            if (!trimmed) return 'El alias es obligatorio.';
            if (/\s/.test(trimmed)) return 'El alias no debe contener espacios.';
            return true;
          }
        }
      ]);
      alias = aliasPrompt.alias.trim();
    }

    const credFile = path.join(os.homedir(), '.koram_credentials.json');
    let allCreds = {};
    if (fs.existsSync(credFile)) {
      try {
        allCreds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
      } catch (e) {
        allCreds = {};
      }
    }

    let secretKey = '';
    let finalUser = user;
    let finalHost = host;
    let savedKeyPath = null;
    let authType = 'password';

    // 3. Procesar según el tipo de credencial
    if (type === 's3') {
      console.log(chalk.cyan(`\n☁️  Asistente de Credenciales AWS S3 para alias: ${chalk.bold(alias)}`));
      
      const s3Ans = await inquirer.prompt([
        ...(!finalUser || finalUser === 's3' ? [{
          type: 'input',
          name: 'accessKeyId',
          message: 'Introduce el AWS Access Key ID:',
          validate: (input) => input.trim() ? true : 'El Access Key ID es obligatorio.'
        }] : []),
        {
          type: 'password',
          name: 'secretAccessKey',
          message: `Introduce el AWS Secret Access Key:`,
          mask: '*'
        },
        ...(!finalHost ? [{
          type: 'input',
          name: 'region',
          message: 'Introduce la Región de AWS S3 (ej: us-east-1):',
          default: 'us-east-1'
        }] : [])
      ]);

      finalUser = s3Ans.accessKeyId ? s3Ans.accessKeyId.trim() : finalUser;
      secretKey = s3Ans.secretAccessKey;
      finalHost = s3Ans.region ? s3Ans.region.trim() : (finalHost || 'us-east-1');

    } else if (type === 'key') {
      console.log(chalk.cyan(`\n🛡️  Asistente de Servidor SSH con Llave Privada para alias: ${chalk.bold(alias)}`));

      // Preguntar usuario si no vino en args
      if (!finalUser) {
        const userAns = await inquirer.prompt([
          {
            type: 'input',
            name: 'user',
            message: 'Usuario SSH del servidor:',
            default: 'ubuntu',
            validate: (input) => input.trim() ? true : 'El usuario SSH es obligatorio.'
          }
        ]);
        finalUser = userAns.user.trim();
      }

      // Preguntar host si no vino en args
      if (!finalHost) {
        const hostAns = await inquirer.prompt([
          {
            type: 'input',
            name: 'host',
            message: 'IP o Hostname del servidor:',
            validate: (input) => input.trim() ? true : 'El host del servidor es obligatorio.'
          }
        ]);
        finalHost = hostAns.host.trim();
      }

      // Obtener ruta del archivo de llave (.pem)
      let sourceKeyPath = flags.key;
      if (!sourceKeyPath) {
        const keyFileAns = await inquirer.prompt([
          {
            type: 'input',
            name: 'keyPath',
            message: 'Ruta local del archivo de llave privada (.pem / id_rsa):',
            validate: (input) => {
              if (!input.trim()) return 'Debes especificar la ruta de la llave.';
              const resolved = input.trim().replace(/^~(?=$|\/|\\)/, os.homedir());
              const abs = path.isAbsolute(resolved) ? resolved : path.resolve(process.cwd(), resolved);
              if (!fs.existsSync(abs)) return `El archivo no existe en: ${abs}`;
              return true;
            }
          }
        ]);
        sourceKeyPath = keyFileAns.keyPath.trim();
      }

      // Copiar la llave de forma segura a ~/.koram/keys/<alias>.pem con permisos 0600
      try {
        savedKeyPath = storeKoramKey(sourceKeyPath, alias, finalUser);
        console.log(chalk.green(`✔ Llave copiada con éxito a: ${savedKeyPath}`));
        console.log(chalk.gray(`🔒 Permisos establecidos a 0600 (drwx------ / -rw-------).`));
      } catch (err) {
        console.log(chalk.red(`❌ Error al procesar la llave SSH: ${err.message}`));
        return;
      }

      // Preguntar por passphrase opcional si no viene en flags
      if (flags.passphrase !== undefined) {
        secretKey = flags.passphrase;
      } else {
        const passConfirm = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'hasPassphrase',
            message: '¿Esta llave SSH requiere passphrase (contraseña)?',
            default: false
          }
        ]);

        if (passConfirm.hasPassphrase) {
          const passAns = await inquirer.prompt([
            {
              type: 'password',
              name: 'passphrase',
              message: 'Introduce la passphrase de la llave:',
              mask: '*'
            }
          ]);
          secretKey = passAns.passphrase;
        }
      }

      authType = 'key';

    } else {
      // type === 'server' (Contraseña tradicional)
      console.log(chalk.cyan(`\n🔑 Asistente de Servidor SSH con Contraseña para alias: ${chalk.bold(alias)}`));

      if (!finalUser) {
        const userAns = await inquirer.prompt([
          {
            type: 'input',
            name: 'user',
            message: 'Usuario SSH del servidor:',
            default: 'root',
            validate: (input) => input.trim() ? true : 'El usuario SSH es obligatorio.'
          }
        ]);
        finalUser = userAns.user.trim();
      }

      if (!finalHost) {
        const hostAns = await inquirer.prompt([
          {
            type: 'input',
            name: 'host',
            message: 'IP o Hostname del servidor:',
            validate: (input) => input.trim() ? true : 'El host del servidor es obligatorio.'
          }
        ]);
        finalHost = hostAns.host.trim();
      }

      const passAns = await inquirer.prompt([
        {
          type: 'password',
          name: 'password',
          message: `Introduce la contraseña para ${finalUser}@${alias}:`,
          mask: '*'
        }
      ]);
      secretKey = passAns.password;
      authType = 'password';
    }

    const key = `${alias}:${finalUser}`;
    let existing = null;

    if (!flags.fallback && keytar) {
      existing = await keytar.getPassword('koram', key);
    } else {
      existing = allCreds[key]?.password || null;
    }

    if (existing || allCreds[key]) {
      console.log(chalk.yellow(`⚠ Ya existe una credencial para ${finalUser}@${alias}, se sobrescribirá.`));
    }

    if (!flags.fallback && keytar) {
      // Guardar en Keytar (incluso si secretKey está vacío para limpiar contraseñas anteriores)
      if (secretKey) {
        await keytar.setPassword('koram', key, secretKey);
      } else if (existing) {
        await keytar.deletePassword('koram', key);
      }
    } else {
      // Guardar en archivo JSON (fallback)
      allCreds[key] = { host: finalHost, password: secretKey || '' };
    }

    // Guardar siempre metadata (host, etc.)
    if (!allCreds[key]) {
      allCreds[key] = { host: finalHost };
    } else {
      allCreds[key].host = finalHost || allCreds[key].host || '';
    }

    allCreds[key].type = type === 'key' ? 'server' : type;
    allCreds[key].authType = authType;

    if (type === 'key') {
      allCreds[key].keyPath = savedKeyPath;
    } else if (type === 'server') {
      delete allCreds[key].keyPath;
    } else if (type === 's3') {
      allCreds[key].accessKeyId = finalUser;
      allCreds[key].region = finalHost;
    }

    fs.writeFileSync(credFile, JSON.stringify(allCreds, null, 2));

    const methodDesc = type === 'key' ? 'SSH Key (.pem)' : (type === 's3' ? 'AWS S3' : 'SSH Password');
    console.log(chalk.green(`\n🔑 Credencial guardada para ${chalk.bold(finalUser + '@' + alias)} (${flags.fallback ? 'fallback' : 'keytar'}, tipo: ${methodDesc})`));
  }
}

CredentialAddCommand.description = `Guarda una credencial segura para un servidor SSH (llave .pem o password) o servicio AWS S3.
Lanza un asistente interactivo si se ejecuta sin argumentos, o acepta parámetros por línea de comandos.`;

CredentialAddCommand.args = [
  { name: 'alias', required: false, description: 'Alias legible del servidor o servicio' },
  { name: 'user', required: false, description: 'Usuario SSH o "s3" / AWS Access Key ID para S3' },
  { name: 'host', required: false, description: 'IP/Hostname del servidor o Región de AWS S3 (ej: us-east-1)' }
];

CredentialAddCommand.flags = {
  fallback: flags.boolean({ char: 'f', description: 'Usar almacenamiento fallback en JSON en lugar de Keytar' }),
  type: flags.string({ char: 't', description: 'Tipo de credencial (server, s3, key)' }),
  key: flags.string({ char: 'k', description: 'Ruta al archivo de llave privada SSH (.pem, id_rsa)' }),
  passphrase: flags.string({ description: 'Passphrase de la llave SSH si está encriptada' })
};

CredentialAddCommand.examples = [
  `${chalk.green('koram creds:add')}                                                # Asistente interactivo completo`,
  `${chalk.green('koram creds:add prod-aws ubuntu 54.21.32.10 --key ~/keys/mi.pem')} # Registra servidor con llave .pem`,
  `${chalk.green('koram creds:add mi-servidor root 192.168.1.1')}                   # Registra servidor con contraseña`,
  `${chalk.green('koram creds:add mi-s3 s3')}                                      # Asistente para AWS S3`
];

module.exports = CredentialAddCommand;
