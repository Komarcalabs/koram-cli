const { Command } = require('@oclif/command');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

let keytar;
try {
  keytar = require('keytar');
} catch (e) {
  keytar = null;
}

class CredentialUpdateCommand extends Command {
  async run() {
    const { args } = this.parse(CredentialUpdateCommand);
    const alias = args.alias;

    if (!alias) {
      console.log(chalk.red('❌ Debes indicar el alias de la credencial a actualizar'));
      return;
    }

    const credFile = path.join(process.env.HOME, '.koram_credentials.json');
    let allCreds = {};
    if (fs.existsSync(credFile)) {
      allCreds = JSON.parse(fs.readFileSync(credFile));
    }

    const matchingKeys = Object.keys(allCreds).filter(k => k.startsWith(alias + ':'));

    if (matchingKeys.length === 0) {
      console.log(chalk.yellow(`⚠ No se encontró ninguna credencial para alias "${alias}"`));
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
        message: `Se encontraron varias credenciales para alias "${alias}", selecciona cuál actualizar:`,
        choices
      }]);
      keyToUpdate = answer.selected;
    }

    const [aliasName, oldUser] = keyToUpdate.split(':');
    const oldCred = allCreds[keyToUpdate];
    const type = oldCred.type || 'server';

    console.log(chalk.cyan(`\n🛠 Actualizando credencial: ${oldUser}@${aliasName} (Tipo: ${type})`));

    const prompts = [];
    
    if (type === 's3') {
      prompts.push({
        type: 'input',
        name: 'user',
        message: 'AWS Access Key ID:',
        default: oldCred.accessKeyId || oldUser,
      });
      prompts.push({
        type: 'input',
        name: 'host',
        message: 'Región de AWS S3:',
        default: oldCred.region || oldCred.host,
      });
      prompts.push({
        type: 'password',
        name: 'password',
        message: 'Nuevo AWS Secret Access Key (deja en blanco para mantener la actual):',
        mask: '*'
      });
    } else {
      prompts.push({
        type: 'input',
        name: 'user',
        message: 'Usuario SSH:',
        default: oldUser,
      });
      prompts.push({
        type: 'input',
        name: 'host',
        message: 'IP/Hostname del servidor:',
        default: oldCred.host,
      });
      prompts.push({
        type: 'password',
        name: 'password',
        message: 'Nueva contraseña (deja en blanco para mantener la actual):',
        mask: '*'
      });
    }

    const answers = await inquirer.prompt(prompts);

    const newUser = answers.user.trim();
    const newHost = answers.host.trim();
    const newPassword = answers.password;

    const newKey = `${aliasName}:${newUser}`;

    // Recuperar la contraseña antigua si no proporcionaron una nueva
    let finalPassword = newPassword;
    if (!finalPassword) {
      if (keytar) {
        finalPassword = await keytar.getPassword('koram', keyToUpdate);
      }
      if (!finalPassword) {
        finalPassword = oldCred.password; 
      }
    }

    // Si cambió el identificador (usuario), borrar el antiguo
    if (newKey !== keyToUpdate) {
      if (keytar) {
        await keytar.deletePassword('koram', keyToUpdate);
      }
      delete allCreds[keyToUpdate];
    }

    // Preparar el nuevo objeto
    if (!allCreds[newKey]) {
      allCreds[newKey] = {};
    }

    allCreds[newKey].type = type;
    allCreds[newKey].host = newHost;
    
    if (type === 's3') {
      allCreds[newKey].accessKeyId = newUser;
      allCreds[newKey].region = newHost;
    }

    // Guardar la contraseña
    if (keytar && finalPassword) {
      await keytar.setPassword('koram', newKey, finalPassword);
      delete allCreds[newKey].password; // Limpiar del JSON si estamos usando keytar
    } else if (finalPassword) {
      allCreds[newKey].password = finalPassword;
    }

    fs.writeFileSync(credFile, JSON.stringify(allCreds, null, 2));

    console.log(chalk.green(`\n✅ Credencial actualizada correctamente para ${newUser}@${aliasName}`));
  }
}

CredentialUpdateCommand.description = `Actualiza interactivamente una credencial guardada
Permite modificar el usuario, host/IP o la contraseña de una credencial existente utilizando su alias.`;

CredentialUpdateCommand.args = [
  { name: 'alias', required: true, description: 'Alias de la credencial a actualizar' }
];

CredentialUpdateCommand.examples = [
  `${require('chalk').green('koram creds:update mi-servidor')}  # Abre el asistente para actualizar datos`
];

module.exports = CredentialUpdateCommand;
