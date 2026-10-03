const { Command, flags } = require('@oclif/command');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Table = require('cli-table3');
const { storeKoramKey, getKoramKeysDir } = require('../../utils/keys');

let keytar;
try {
  keytar = require('keytar');
} catch (e) {
  keytar = null;
}

class CredentialUpdateCommand extends Command {
  async run() {
    const { args, flags: cmdFlags } = this.parse(CredentialUpdateCommand);
    let alias = args.alias;

    const credFile = path.join(os.homedir(), '.koram_credentials.json');
    let allCreds = {};
    if (fs.existsSync(credFile)) {
      try {
        allCreds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
      } catch (e) {
        allCreds = {};
      }
    }

    const allKeys = Object.keys(allCreds);
    if (allKeys.length === 0) {
      console.log(chalk.yellow('⚠️ No hay credenciales registradas en la bóveda de Koram.'));
      console.log(chalk.gray('💡 Usa "koram creds:add" para registrar tu primer servidor o bucket S3.'));
      return;
    }

    // 1. Si no se especificó alias, seleccionar interactivamente de la lista
    if (!alias) {
      console.log(chalk.cyan('\n🔐 Bóveda de Seguridad Koram - Actualización de Credenciales\n'));
      const choices = allKeys.map(k => {
        const [aAlias, aUser] = k.split(':');
        const meta = allCreds[k] || {};
        let typeLabel = chalk.blue('SSH (Pass)');
        if (meta.type === 's3') typeLabel = chalk.yellow('AWS S3');
        else if (meta.authType === 'key' || meta.keyPath) typeLabel = chalk.cyan('SSH (Key)');

        return {
          name: `${chalk.bold(aAlias.padEnd(16))} │ ${chalk.white(aUser)}@${chalk.gray(meta.host || '-')} │ ${typeLabel}`,
          value: aAlias
        };
      });

      const ans = await inquirer.prompt([{
        type: 'list',
        name: 'selectedAlias',
        message: 'Selecciona la credencial que deseas actualizar:',
        choices
      }]);
      alias = ans.selectedAlias;
    }

    // 2. Buscar clave correspondiente al alias
    const matchingKeys = allKeys.filter(k => k.startsWith(alias + ':'));

    if (matchingKeys.length === 0) {
      console.log(chalk.red(`❌ No se encontró ninguna credencial con alias "${alias}".`));
      console.log(chalk.gray(`💡 Ejecuta "koram creds:ls" para ver todos los alias disponibles.`));
      return;
    }

    let keyToUpdate;
    if (matchingKeys.length === 1) {
      keyToUpdate = matchingKeys[0];
    } else {
      const choices = matchingKeys.map(k => {
        const user = k.split(':')[1];
        const host = allCreds[k].host || '-';
        return { name: `${user}@${alias} | Host: ${host}`, value: k };
      });
      const answer = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: `Se encontraron varias cuentas para el alias "${alias}", selecciona cuál actualizar:`,
        choices
      }]);
      keyToUpdate = answer.selected;
    }

    const [aliasName, oldUser] = keyToUpdate.split(':');
    const oldCred = allCreds[keyToUpdate] || {};
    const credType = oldCred.type || 'server';
    const oldIsKeyAuth = oldCred.authType === 'key' || !!oldCred.keyPath;

    // Recuperar contraseña / passphrase actual
    let currentPassword = null;
    if (keytar) {
      try {
        currentPassword = await keytar.getPassword('koram', keyToUpdate);
      } catch (e) {}
    }
    if (!currentPassword && oldCred.password) {
      currentPassword = oldCred.password;
    }

    let newAlias = cmdFlags.newAlias ? cmdFlags.newAlias.trim() : null;
    let newUser = cmdFlags.user ? cmdFlags.user.trim() : null;
    let newHost = cmdFlags.host ? cmdFlags.host.trim() : null;
    let newPassword = cmdFlags.password;
    let newKeyPathInput = cmdFlags.key;
    let authType = oldIsKeyAuth ? 'key' : 'password';

    // 3. Si no se pasaron flags suficientes para actualización silenciosa, ejecutar asistente interactivo
    const hasFlags = cmdFlags.user || cmdFlags.host || cmdFlags.password || cmdFlags.key || cmdFlags.newAlias;

    if (!hasFlags) {
      console.log(chalk.cyan(`\n🛠️  Actualizando credencial: ${chalk.bold(aliasName)} (${oldUser}@${oldCred.host || '-'})`));

      const basePrompts = [
        {
          type: 'input',
          name: 'alias',
          message: 'Alias identificador:',
          default: aliasName,
          validate: input => input.trim().length > 0 && !/\s/.test(input.trim()) ? true : 'El alias no debe contener espacios vacíos.'
        },
        {
          type: 'input',
          name: 'user',
          message: credType === 's3' ? 'AWS Access Key ID:' : 'Usuario SSH:',
          default: oldUser,
          validate: input => input.trim().length > 0 ? true : 'El usuario es obligatorio.'
        },
        {
          type: 'input',
          name: 'host',
          message: credType === 's3' ? 'Región AWS S3 por defecto:' : 'Host / IP del servidor:',
          default: oldCred.host || '',
          validate: input => input.trim().length > 0 ? true : 'El host/región es obligatorio.'
        }
      ];

      const baseAnswers = await inquirer.prompt(basePrompts);
      newAlias = baseAnswers.alias.trim();
      newUser = baseAnswers.user.trim();
      newHost = baseAnswers.host.trim();

      if (credType === 's3') {
        const s3Prompt = await inquirer.prompt([
          {
            type: 'password',
            name: 'secretKey',
            message: 'Nuevo AWS Secret Access Key (deja en blanco para mantener el actual):',
            mask: '*'
          }
        ]);
        if (s3Prompt.secretKey && s3Prompt.secretKey.trim()) {
          newPassword = s3Prompt.secretKey.trim();
        }
      } else {
        // Servidor SSH: permitir cambiar método de autenticación
        const authChoice = await inquirer.prompt([
          {
            type: 'list',
            name: 'authMethod',
            message: 'Método de autenticación SSH:',
            choices: [
              { name: '🛡️  Llave Privada (.pem, id_rsa)', value: 'key' },
              { name: '🔑 Contraseña tradicional', value: 'password' }
            ],
            default: oldIsKeyAuth ? 'key' : 'password'
          }
        ]);

        authType = authChoice.authMethod;

        if (authType === 'key') {
          const currentKeyDesc = oldCred.keyPath ? path.basename(oldCred.keyPath) : 'ninguna';
          const keyPrompt = await inquirer.prompt([
            {
              type: 'input',
              name: 'keyPath',
              message: `Ruta al archivo .pem de la llave privada (deja en blanco para mantener "${currentKeyDesc}"):`,
            },
            {
              type: 'password',
              name: 'passphrase',
              message: 'Nueva passphrase de la llave (deja en blanco para mantener la actual):',
              mask: '*'
            }
          ]);
          if (keyPrompt.keyPath && keyPrompt.keyPath.trim()) {
            newKeyPathInput = keyPrompt.keyPath.trim();
          }
          if (keyPrompt.passphrase && keyPrompt.passphrase.trim()) {
            newPassword = keyPrompt.passphrase.trim();
          }
        } else {
          const passPrompt = await inquirer.prompt([
            {
              type: 'password',
              name: 'password',
              message: 'Nueva contraseña SSH (deja en blanco para mantener la actual):',
              mask: '*'
            }
          ]);
          if (passPrompt.password && passPrompt.password.trim()) {
            newPassword = passPrompt.password.trim();
          }
        }
      }
    } else {
      // Si se pasaron flags, completar valores por defecto
      if (!newAlias) newAlias = aliasName;
      if (!newUser) newUser = oldUser;
      if (!newHost) newHost = oldCred.host;
      if (cmdFlags.key) authType = 'key';
      else if (cmdFlags.password && !oldIsKeyAuth) authType = 'password';
    }

    // 4. Procesar actualización de llave SSH si aplica
    let finalKeyPath = oldCred.keyPath || null;
    if (authType === 'key') {
      if (newKeyPathInput && newKeyPathInput.trim()) {
        try {
          finalKeyPath = storeKoramKey(newKeyPathInput.trim(), newAlias, newUser);
          console.log(chalk.green(`✔ Llave privada SSH copiada y asegurada en: ${finalKeyPath}`));
        } catch (keyErr) {
          console.log(chalk.red(`❌ Error al procesar el archivo de llave: ${keyErr.message}`));
          return;
        }
      } else if (oldCred.keyPath && fs.existsSync(oldCred.keyPath)) {
        // Si el alias cambió y no se pasó nueva llave, renombrar el archivo en ~/.koram/keys si corresponde
        if (newAlias !== aliasName) {
          try {
            const keysDir = getKoramKeysDir();
            const oldKeyFile = path.join(keysDir, `${aliasName}.pem`);
            const newKeyFile = path.join(keysDir, `${newAlias}.pem`);
            if (fs.existsSync(oldKeyFile)) {
              fs.renameSync(oldKeyFile, newKeyFile);
              finalKeyPath = newKeyFile;
            }
          } catch (renErr) {}
        }
      }
    } else {
      finalKeyPath = null;
    }

    // 5. Contraseña final
    const finalPassword = (newPassword !== undefined && newPassword !== null && newPassword.trim() !== '')
      ? newPassword.trim()
      : currentPassword;

    const newKey = `${newAlias}:${newUser}`;

    // Si cambió la clave identificadora (alias o usuario), limpiar la antigua
    if (newKey !== keyToUpdate) {
      if (keytar) {
        try {
          await keytar.deletePassword('koram', keyToUpdate);
        } catch (e) {}
      }
      delete allCreds[keyToUpdate];
    }

    // 6. Guardar en JSON
    allCreds[newKey] = {
      type: credType,
      host: newHost,
      authType: authType,
      updatedAt: new Date().toISOString()
    };

    if (authType === 'key' && finalKeyPath) {
      allCreds[newKey].keyPath = finalKeyPath;
    }

    if (credType === 's3') {
      allCreds[newKey].accessKeyId = newUser;
      allCreds[newKey].region = newHost;
    }

    // 7. Guardar contraseña en Keytar o Fallback
    const useFallback = cmdFlags.fallback || !keytar;

    if (!useFallback && keytar && finalPassword) {
      try {
        await keytar.setPassword('koram', newKey, finalPassword);
        delete allCreds[newKey].password;
      } catch (keytarErr) {
        console.log(chalk.yellow(`⚠️ No se pudo guardar en el llavero del sistema: ${keytarErr.message}. Usando fallback local.`));
        allCreds[newKey].password = finalPassword;
      }
    } else if (finalPassword) {
      allCreds[newKey].password = finalPassword;
    }

    fs.writeFileSync(credFile, JSON.stringify(allCreds, null, 2), { mode: 0o600 });

    // 8. Resumen en tabla
    const table = new Table({
      head: [chalk.cyan('Campo'), chalk.cyan('Valor')],
      style: { head: [], border: [] },
      colWidths: [22, 50]
    });

    table.push(
      [chalk.blue('Alias'), chalk.bold(newAlias)],
      [chalk.blue('Usuario / ID'), newUser],
      [chalk.blue(credType === 's3' ? 'Región S3' : 'Host / IP'), newHost],
      [chalk.blue('Tipo'), credType === 's3' ? chalk.yellow('AWS S3') : (authType === 'key' ? chalk.cyan('SSH (Llave .pem)') : chalk.blue('SSH (Contraseña)'))],
      ...(authType === 'key' && finalKeyPath ? [[chalk.blue('Ruta Llave'), finalKeyPath]] : []),
      [chalk.blue('Almacenamiento'), useFallback ? chalk.yellow('JSON local (.koram_credentials.json)') : chalk.green('Llavero seguro del SO (keytar)')]
    );

    console.log(chalk.green(`\n✅ Credencial "${newAlias}" actualizada exitosamente en la bóveda:\n`));
    console.log(table.toString() + '\n');
  }
}

CredentialUpdateCommand.description = `Actualiza los datos de una credencial en la bóveda de Koram (interactivo o por flags).
Permite modificar alias, usuario, host/IP, método de autenticación (llave .pem o password) y contraseña/secret.`;

CredentialUpdateCommand.aliases = ['creds:edit', 'creds:set'];

CredentialUpdateCommand.args = [
  { name: 'alias', required: false, description: 'Alias de la credencial a actualizar (opcional, muestra selector si se omite)' }
];

CredentialUpdateCommand.flags = {
  user: flags.string({ char: 'u', description: 'Nuevo usuario SSH o AWS Access Key ID' }),
  host: flags.string({ char: 'h', description: 'Nueva IP/host del servidor o región AWS S3' }),
  password: flags.string({ char: 'p', description: 'Nueva contraseña SSH, passphrase o AWS Secret Key' }),
  key: flags.string({ char: 'k', description: 'Ruta al nuevo archivo de llave privada SSH (.pem)' }),
  newAlias: flags.string({ description: 'Renombrar el alias de la credencial' }),
  fallback: flags.boolean({ char: 'f', description: 'Guardar contraseña en archivo JSON local en lugar de Keytar' })
};

CredentialUpdateCommand.examples = [
  `${chalk.green('koram creds:update')}                          # Muestra lista interactiva para seleccionar`,
  `${chalk.green('koram creds:update mi-vps')}                   # Asistente interactivo para actualizar "mi-vps"`,
  `${chalk.green('koram creds:update mi-vps -h 18.188.35.165')}   # Actualiza solo el host/IP por flags`,
  `${chalk.green('koram creds:update mi-vps -k ~/clave.pem')}     # Actualiza o migra a llave privada .pem`,
  `${chalk.green('koram creds:edit mi-vps --newAlias prod-aws')}  # Renombra el alias usando el atajo creds:edit`
];

module.exports = CredentialUpdateCommand;
