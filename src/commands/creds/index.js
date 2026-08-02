const { Command } = require('@oclif/command');
const { Help } = require('@oclif/plugin-help');
const chalk = require('chalk');

class CredsIndex extends Command {
  async run() {
    this.log(chalk.cyan.bold('\n🔑 MÓDULO SAGRADO DE CREDENCIALES (BÓVEDA DE KORAM)'));
    this.log(chalk.gray('Almacenamiento cifrado y seguro para tus credenciales de infraestructura.\n'));

    // Mostrar la ayuda predeterminada de Oclif
    const help = new Help(this.config);
    help.showHelp(['creds']);

    this.log(chalk.cyan.bold('\n💡 RITUALES Y EJEMPLOS DE USO:'));

    this.log(chalk.yellow('\n1. Registrar un Servidor SSH:'));
    this.log(`   ${chalk.green('koram creds:add mi-vps root 64.23.174.86')}`);
    this.log(chalk.gray('   Registra el usuario root y la IP. Te solicitará la contraseña de forma segura.'));

    this.log(chalk.yellow('\n2. Registrar AWS S3 (Asistente Interactivo):'));
    this.log(`   ${chalk.green('koram creds:add mi-s3 s3')}`);
    this.log(chalk.gray('   Inicia un asistente específico para S3 pidiendo AccessKey, SecretKey y Región.'));

    this.log(chalk.yellow('\n3. Registrar AWS S3 de forma Directa:'));
    this.log(`   ${chalk.green('koram creds:add mi-s3 AKIAIOSFODNN7EXAMPLE us-east-1 --type s3')}`);
    this.log(chalk.gray('   Registra las llaves de S3 pasando el Access Key y la Región como argumentos.'));

    this.log(chalk.yellow('\n4. Ver y Administrar credenciales:'));
    this.log(`   ${chalk.green('koram creds:ls')}                  # Lista todas las credenciales con su tipo (S3 / Server)`);
    this.log(`   ${chalk.green('koram creds:ls -p')}               # Muestra también las contraseñas/secrets en texto claro`);
    this.log(`   ${chalk.green('koram creds:show mi-s3')}          # Muestra detalle formateado específico para S3`);
    this.log(`   ${chalk.green('koram creds:rm mi-s3')}            # Elimina de la bóveda de forma física`);

    this.log(chalk.gray('\nPara ver los parámetros detallados de cada comando individual, corre:'));
    this.log(`   ${chalk.bold('koram creds:add --help')} o ${chalk.bold('koram creds:show --help')}\n`);
  }
}

CredsIndex.description = 'Gestión de credenciales seguras (bóveda) para servidores SSH y AWS S3';

module.exports = CredsIndex;
