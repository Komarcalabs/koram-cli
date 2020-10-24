const {Command, flags} = require('@oclif/command')
class LoginCommand extends Command {
  async run() {
    const {flags} = this.parse(LoginCommand)
    const user = flags.user || 'world';
    console.log(`Hola ${user}, este flujo aún esta en configuración`)
  }
}
LoginCommand.description = `Logueate como wen komarquino
...
Comando de login en la plataforma koram
`
LoginCommand.flags = {
  user: flags.string({char: 'u', description: 'nickname komarquino'}),
}
module.exports = LoginCommand
