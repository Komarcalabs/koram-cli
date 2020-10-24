const { Command, flags } = require("@oclif/command");
const open = require("open");
const { exec } = require("child_process");
const chalk = require('chalk');
const repo = "aHR0cHM6Ly9qaG9sYXJjazpqUFdrNlRYWXNWc0dzaHpDeTVwdUBnaXRsYWIuY29tL2tvbWFyY2Eta29kZWJhc2Uva29yYW4uZ2l0";
class UICommand extends Command {
  async run() {
    let startServerInstance = `cd "${__dirname}/.." && pm2 --silent start server --name koram`;
    try {
      var direction=`${__dirname}/../server/koram`;
      var gitcommand=`git -C ${direction} pull -s recursive -X theirs origin master || git clone -b master ${Buffer.from(repo, 'base64')} ${direction}`
      
      let parent = exec(gitcommand, function (err) {
        if (err) throw err;
        console.log(chalk.green('Estamos iniciando el koram, por favor muestre respeto :)'))
        let child = exec(startServerInstance, function (err) {
          if (err) throw err;
          setTimeout(()=>{
            open('http://localhost:3777');
            console.log(chalk.green('Lea el koram en:'),chalk.blue.underline('http://localhost:3777'))
          },2000)
        });
        child.stdout.on("data", (data) => {
          console.log(data.toString());
        });
        child.stderr.on("data", (data) => {
          console.log(data.toString());
        });
      });
      parent.stdout.on("data", (data) => {
        console.log(data.toString());
      });
    } catch (error) {
      console.log(chalk.red('Diosss misho algo a sucedido'), error)
    }
  }
}
UICommand.description = `Abre nuestro libro sakrado en tu navegador
...
Comando para abrir el koram
`;
module.exports = UICommand;