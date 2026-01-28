const { Command, flags } = require('@oclif/command');
const { spawn } = require('child_process');
const os = require('os');
const http = require('http');
const https = require('https');
const chalk = require('chalk');

class AgentCommand extends Command {
    async run() {
        const { flags } = this.parse(AgentCommand);
        const { url, key, name, interval } = flags;

        const agentName = name || os.hostname();
        this.log(chalk.blue(`🛰️  Koram Monitor Agent iniciado: ${chalk.bold(agentName)}`));
        this.log(chalk.gray(`📡 Enviando a: ${url} cada ${interval}s`));

        // Intervalo de reporte
        setInterval(async () => {
            try {
                const payload = await this.collectMetrics(agentName);
                await this.postData(url, key, payload);
                this.log(chalk.green(`✅ Reporte enviado a las ${new Date().toLocaleTimeString()}`));
            } catch (err) {
                this.warn(chalk.red(`❌ Error al enviar reporte: ${err.message}`));
            }
        }, interval * 1000);
    }

    async collectMetrics(agentName) {
        const cpuUsage = os.loadavg()[0]; // 1 min load average
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const memUsage = ((totalMem - freeMem) / totalMem) * 100;

        const pm2Data = await this.getPM2Status();

        return {
            name: agentName,
            timestamp: Date.now(),
            system: {
                loadAvg: cpuUsage.toFixed(2),
                memory: {
                    total: (totalMem / 1024 / 1024 / 1024).toFixed(2) + 'GB',
                    free: (freeMem / 1024 / 1024 / 1024).toFixed(2) + 'GB',
                    usage: memUsage.toFixed(2) + '%'
                },
                uptime: os.uptime()
            },
            pm2: pm2Data
        };
    }

    getPM2Status() {
        return new Promise((resolve) => {
            // Usamos spawn para ejecutar pm2 jlist (formato JSON)
            const pm2 = spawn('pm2', ['jlist'], { shell: true });
            let data = '';

            pm2.stdout.on('data', (chunk) => {
                data += chunk;
            });

            pm2.on('close', (code) => {
                if (code !== 0) {
                    resolve({ error: `pm2 exit code ${code}` });
                    return;
                }
                try {
                    const list = JSON.parse(data);
                    const simplified = list.map(proc => ({
                        name: proc.name,
                        status: proc.pm2_env.status,
                        cpu: proc.monit.cpu,
                        memory: (proc.monit.memory / 1024 / 1024).toFixed(2) + 'MB',
                        uptime: Math.floor((Date.now() - proc.pm2_env.pm_uptime) / 1000),
                        restarts: proc.pm2_env.restart_time,
                        pid: proc.pid,
                        mode: proc.pm2_env.exec_mode
                    }));
                    resolve(simplified);
                } catch (err) {
                    resolve({ error: 'Failed to parse PM2 output' });
                }
            });
        });
    }

    postData(apiUrl, apiKey, payload) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(payload);
            const urlObj = new URL(apiUrl);
            const lib = urlObj.protocol === 'https:' ? https : http;

            // Construir el path correctamente uniendo el pathname base con el endpoint
            const baseStatusPath = urlObj.pathname.endsWith('/') ? urlObj.pathname : urlObj.pathname + '/';
            const finalPath = (baseStatusPath + 'api/report').replace(/\/+/g, '/');

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: finalPath,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'x-api-key': apiKey
                }
            };

            const req = lib.request(options, (res) => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve();
                } else if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                    reject(new Error(`Server returned ${res.statusCode} (Redirect). Intenta usar HTTPS en la URL si el servidor lo requiere.`));
                } else {
                    reject(new Error(`Server returned ${res.statusCode}`));
                }
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }
}

AgentCommand.description = `Inicia el agente de monitoreo Koram
Recopila estadísticas del sistema y procesos PM2 para enviarlos a una central.
`;

AgentCommand.flags = {
    url: flags.string({ char: 'u', description: 'URL de la API central', required: true }),
    key: flags.string({ char: 'k', description: 'API Key compartida', required: true }),
    name: flags.string({ char: 'n', description: 'Nombre identificador de este VPS (opcional)' }),
    interval: flags.integer({ char: 'i', description: 'Intervalo de reporte en segundos', default: 60 }),
};

module.exports = AgentCommand;
