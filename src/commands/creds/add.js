const { Command, flags } = require('@oclif/command');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
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
    const alias = args.alias;
    const user = args.user;
    const host = args.host || '';

    if (!alias || !user) {
      console.log(chalk.red('❌ Debes indicar alias y usuario/AccessKey'));
      return;
    }

    let type = flags.type || 'server';
    if (user === 's3' || flags.type === 's3') {
      type = 's3';
    }

    const credFile = `${process.env.HOME}/.koram_credentials.json`;
    let allCreds = {};
    if (fs.existsSync(credFile)) {
      allCreds = JSON.parse(fs.readFileSync(credFile));
    }

    let secretKey = '';
    let finalUser = user;
    let finalHost = host;

    if (type === 's3') {
      console.log(chalk.cyan(`\n🔑 Asistente de Credenciales AWS S3 para alias: ${chalk.bold(alias)}`));
      
      const s3Ans = await inquirer.prompt([
        ...(user === 's3' ? [{
          type: 'input',
          name: 'accessKeyId',
          message: 'Introduce el AWS Access Key ID:',
          validate: (input) => input.trim() ? true : 'El Access Key ID es obligatorio.'
        }] : []),
        {
          type: 'password',
          name: 'secretAccessKey',
          message: `Introduce el AWS Secret Access Key para ${user === 's3' ? 'la cuenta' : user + '@' + alias}:`,
          mask: '*'
        },
        ...(!host ? [{
          type: 'input',
          name: 'region',
          message: 'Introduce la Región de AWS S3 (ej: us-east-1):',
          default: 'us-east-1'
        }] : [])
      ]);

      finalUser = user === 's3' ? s3Ans.accessKeyId.trim() : user;
      secretKey = s3Ans.secretAccessKey;
      finalHost = host ? host : (s3Ans.region ? s3Ans.region.trim() : 'us-east-1');
    } else {
      const answer = await inquirer.prompt([
        {
          type: 'password',
          name: 'password',
          message: `Introduce la contraseña para ${user}@${alias}:`,
          mask: '*'
        }
      ]);
      secretKey = answer.password;
    }

    const key = `${alias}:${finalUser}`;
    let existing = null;

    if (!flags.fallback && keytar) {
      existing = await keytar.getPassword('koram', key);
    } else {
      existing = allCreds[key]?.password || null;
    }

    if (existing) {
      console.log(chalk.yellow(`⚠ Ya existe una credencial para ${finalUser}@${alias}, se sobrescribirá.`));
    }

    if (!flags.fallback && keytar) {
      // Guardar en Keytar
      await keytar.setPassword('koram', key, secretKey);
    } else {
      // Guardar en archivo JSON (fallback)
      allCreds[key] = { host: finalHost, password: secretKey };
    }

    // Guardar siempre metadata (host, etc.)
    if (!allCreds[key]) {
      allCreds[key] = { host: finalHost };
    } else {
      allCreds[key].host = finalHost || allCreds[key].host || '';
    }

    allCreds[key].type = type;
    if (type === 's3') {
      allCreds[key].accessKeyId = finalUser;
      allCreds[key].region = finalHost;
    }

    fs.writeFileSync(credFile, JSON.stringify(allCreds, null, 2));

    console.log(chalk.green(`🔑 Credencial guardada para ${finalUser}@${alias} (${flags.fallback ? 'fallback' : 'keytar'}, tipo: ${type})`));
  }
}

CredentialAddCommand.description = `Guarda una credencial segura para un servidor o servicio AWS S3 con alias simple.
Por defecto usa Keytar, pero puedes usar un almacenamiento fallback en JSON.`;

CredentialAddCommand.args = [
  { name: 'alias', required: true, description: 'Alias legible del servidor o servicio' },
  { name: 'user', required: true, description: 'Usuario SSH o "s3" / AWS Access Key ID para S3' },
  { name: 'host', required: false, description: 'IP/Hostname del servidor o Región de AWS S3 (ej: us-east-1)' }
];

CredentialAddCommand.flags = {
  fallback: flags.boolean({ char: 'f', description: 'Usar almacenamiento fallback en JSON en lugar de Keytar' }),
  type: flags.string({ char: 't', description: 'Tipo de credencial (server, s3)', default: 'server' })
};

CredentialAddCommand.examples = [
  `${require('chalk').green('koram creds:add mi-servidor root 192.168.1.1')}      # Registra un servidor SSH`,
  `${require('chalk').green('koram creds:add mi-s3 s3')}                           # Lanza el asistente interactivo de AWS S3`,
  `${require('chalk').green('koram creds:add mi-s3 AKIA... us-east-1 --type s3')}  # Registra credenciales S3 directamente`
];

module.exports = CredentialAddCommand;
