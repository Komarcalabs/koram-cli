const { Command, flags } = require('@oclif/command')
const { spawn } = require('child_process')
const path = require('path')

class DeployCommand extends Command {
  async run() {
    const { flags } = this.parse(DeployCommand)
    
    // Ruta a tu script Python o ejecutable PyInstaller
    const deployerPath = path.resolve(__dirname, '../python-deployer/main.py')
    // Si usas ejecutable PyInstaller:
    // const deployerPath = path.resolve(__dirname, '../python-deployer/dist/deployer')

    // Ejecutamos el script Python
    const pyProcess = spawn('python3', [deployerPath], { shell: true })

    // Mostrar logs en tiempo real
    pyProcess.stdout.on('data', (data) => {
      process.stdout.write(data.toString())
    })

    pyProcess.stderr.on('data', (data) => {
      process.stderr.write(data.toString())
    })

    pyProcess.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ Deploy completado con éxito.')
      } else {
        console.log(`\n❌ Deploy finalizó con código ${code}`)
      }
    })
  }
}

DeployCommand.description = `Lanza el deployer Python para Nuxt
...
Este comando ejecuta el flujo de construcción, empaquetado, subida y reinicio de la app en el servidor.
`

DeployCommand.flags = {
  // Si quieres, puedes añadir flags como host, user, path, etc.
  host: flags.string({ char: 'h', description: 'Host del servidor' }),
  user: flags.string({ char: 'u', description: 'Usuario SSH' }),
  path: flags.string({ char: 'p', description: 'Ruta remota de la app' }),
}

module.exports = DeployCommand
