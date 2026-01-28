const { Command } = require('@oclif/command');
const { Help } = require('@oclif/plugin-help');

class MonitorIndex extends Command {
    async run() {
        const help = new Help(this.config);
        help.showHelp(['monitor']);
    }
}

MonitorIndex.description = 'Central de monitoreo para VPS y procesos PM2';

module.exports = MonitorIndex;
