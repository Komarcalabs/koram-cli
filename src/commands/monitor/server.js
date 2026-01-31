const { Command, flags } = require('@oclif/command');
const express = require('express');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const os = require('os');

class ServerCommand extends Command {
    async run() {
        const { flags } = this.parse(ServerCommand);
        const { port, key, auth, user: customUser, pass: customPass } = flags;

        const dataPath = path.join(os.homedir(), '.koram_monitor_vps.json');
        let agents = this.loadData(dataPath);

        const app = express();
        app.use(express.json());

        // Middleware de Autenticación Básica
        const authMiddleware = (req, res, next) => {
            // Si el flag --auth no está activo, permitimos el paso
            if (!auth) {
                return next();
            }

            const authHeader = req.headers.authorization;
            if (!authHeader) {
                res.setHeader('WWW-Authenticate', 'Basic realm="Koram Monitor"');
                return res.status(401).send('Authentication required');
            }

            const authData = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
            const user = authData[0];
            const pass = authData[1];

            // Usar credenciales personalizadas o valores por defecto
            const expectedUser = customUser || 'koram';
            const expectedPass = customPass || key;

            if (user === expectedUser && pass === expectedPass) {
                next();
            } else {
                res.setHeader('WWW-Authenticate', 'Basic realm="Koram Monitor"');
                return res.status(401).send('Invalid credentials');
            }
        };

        // Endpoint para recibir reportes (usa x-api-key para agentes)
        app.post('/api/report', (req, res) => {
            const apiKey = req.headers['x-api-key'];
            if (apiKey !== key) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const payload = req.body;
            if (!payload.name) {
                return res.status(400).json({ error: 'Missing agent name' });
            }

            const existingAgent = agents[payload.name] || {};

            // Lógica de Baseline
            const processes = payload.pm2 || [];
            const baseline = existingAgent.baseline || null;
            let alerts = [];

            if (baseline) {
                baseline.forEach(baseProc => {
                    const current = processes.find(p => p.name === baseProc.name);
                    if (!current) {
                        alerts.push(`Proceso ${baseProc.name} DESAPARECIDO`);
                    } else if (current.status !== 'online') {
                        alerts.push(`Proceso ${baseProc.name} en estado ${current.status}`);
                    }
                });
            }

            agents[payload.name] = {
                ...payload,
                baseline: baseline, // Mantener baseline
                alerts,
                lastSeen: new Date().toISOString()
            };

            this.saveData(dataPath, agents);
            res.json({ success: true });
        });

        // Endpoints protegidos por Basic Auth
        app.use(authMiddleware);

        app.get('/api/status', (req, res) => {
            res.json(Object.values(agents));
        });

        app.post('/api/lock/:name', (req, res) => {
            const name = req.params.name;
            if (agents[name]) {
                agents[name].baseline = agents[name].pm2.map(p => ({ name: p.name }));
                this.saveData(dataPath, agents);
                return res.json({ success: true, baseline: agents[name].baseline });
            }
            res.status(404).json({ error: 'Agent not found' });
        });

        app.get('/', (req, res) => {
            res.send(this.getDashboardHtml());
        });

        app.listen(port, () => {
            this.log(chalk.green(`\n🚀 Koram Monitor Server corriendo en http://localhost:${port}`));
            this.log(chalk.gray(`🔑 Credenciales Dashboard: ${customUser || 'koram'} / ${customPass || key}`));
            this.log(chalk.blue(`📊 Dashboard: http://localhost:${port}/`));
        });
    }

    loadData(filePath) {
        if (fs.existsSync(filePath)) {
            try {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } catch (e) {
                return {};
            }
        }
        return {};
    }

    saveData(filePath, data) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }

    getDashboardHtml() {
        return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Koram Monitor - Dashboard Sagrado</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0b0f1a;
            --card: #161e31;
            --text: #e2e8f0;
            --accent: #38bdf8;
            --success: #22c55e;
            --error: #f43f5e;
            --warning: #f59e0b;
        }
        body { font-family: 'Outfit', sans-serif; background-color: var(--bg); color: var(--text); margin: 0; padding: 2rem; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
        h1 { margin: 0; color: var(--accent); font-size: 1.8rem; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 1.5rem; }
        .card { background: var(--card); border-radius: 16px; padding: 1.5rem; border: 1px solid rgba(255,255,255,0.05); transition: transform 0.2s; }
        .card:hover { transform: translateY(-4px); border-color: var(--accent); }
        .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; }
        .agent-info h2 { margin: 0; font-size: 1.4rem; }
        .agent-status { font-size: 0.8rem; padding: 4px 8px; border-radius: 20px; }
        .online-lite { color: var(--success); border: 1px solid var(--success); }
        .offline-lite { color: var(--error); border: 1px solid var(--error); }
        
        .metrics-bar { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
        .metric-item { background: rgba(0,0,0,0.25); padding: 12px; border-radius: 12px; }
        .metric-item .label { display: block; font-size: 0.7rem; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
        .metric-item .val { font-size: 1.1rem; font-weight: 600; }

        .pm2-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        .pm2-table th { text-align: left; color: #64748b; padding-bottom: 8px; font-weight: 400; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .pm2-table td { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .st-tag { font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
        .st-online { background: #064e3b; color: #34d399; }
        .st-error { background: #450a0a; color: #f87171; }
        
        .alerts { margin-bottom: 1rem; }
        .alert-item { background: rgba(244, 63, 94, 0.1); color: var(--error); padding: 8px; border-radius: 8px; font-size: 0.8rem; margin-bottom: 4px; border-left: 3px solid var(--error); }
        
        .btn-lock { background: var(--accent); color: #000; border: none; padding: 6px 12px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.8rem; }
        .btn-lock:hover { opacity: 0.9; }

        #last-update { font-size: 0.8rem; color: #64748b; }
    </style>
</head>
<body>
    <header>
        <h1>🛰️ Koram Monitor</h1>
        <div id="last-update">Actualizando...</div>
    </header>
    <div id="agents-grid" class="grid"></div>

    <script>
        async function lockBaseline(name) {
            if(!confirm('¿Deseas guardar el estado actual como la línea base? Se generarán alertas si alguno de estos procesos cae.')) return;
            const res = await fetch(\`/api/lock/\${name}\`, { method: 'POST' });
            if(res.ok) fetchStatus();
        }

        async function fetchStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                renderAgents(data);
                document.getElementById('last-update').innerText = 'Última ráfaga: ' + new Date().toLocaleTimeString();
            } catch (err) { console.error(err); }
        }

        function renderAgents(agents) {
            const grid = document.getElementById('agents-grid');
            grid.innerHTML = agents.map(agent => {
                const lastReport = new Date(agent.lastSeen);
                const isOffline = (Date.now() - lastReport.getTime()) > 120000;
                
                return \`
                <div class="card">
                    <div class="card-header">
                        <div class="agent-info">
                            <span class="agent-status \${isOffline ? 'offline-lite' : 'online-lite'}">
                                \${isOffline ? 'DISCONNECTED' : 'ONLINE'}
                            </span>
                            <h2>\${agent.name}</h2>
                        </div>
                        <button class="btn-lock" onclick="lockBaseline('\${agent.name}')">🔒 Lock Baseline</button>
                    </div>

                    \${agent.alerts && agent.alerts.length > 0 ? \`
                        <div class="alerts">
                            \${agent.alerts.map(a => \`<div class="alert-item">⚠️ \${a}</div>\`).join('')}
                        </div>
                    \` : ''}

                    <div class="metrics-bar">
                        <div class="metric-item">
                            <span class="label">Load Average</span>
                            <span class="val">\${agent.system.loadAvg}</span>
                        </div>
                        <div class="metric-item">
                            <span class="label">Memoria Usada</span>
                            <span class="val">\${agent.system.memory.usage}</span>
                        </div>
                    </div>

                    <table class="pm2-table">
                        <thead>
                            <tr>
                                <th>Proceso</th>
                                <th>Estado</th>
                                <th>Res.</th>
                                <th>CPU</th>
                                <th>Mem</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${agent.pm2.map(p => \`
                                <tr>
                                    <td><strong>\${p.name}</strong> <br/> <small style="color:#64748b">pid: \${p.pid}</small></td>
                                    <td><span class="st-tag \${p.status === 'online' ? 'st-online' : 'st-error'}">\${p.status}</span></td>
                                    <td>\${p.restarts}</td>
                                    <td>\${p.cpu}%</td>
                                    <td>\${p.memory}</td>
                                </tr>
                            \`).join('')}
                        </tbody>
                    </table>
                </div>
            \`;
            }).join('');
        }

        setInterval(fetchStatus, 5000);
        fetchStatus();
    </script>
</body>
</html>
    `;
    }
}

ServerCommand.description = `Inicia el servidor central de Koram Monitor
Recibe reportes de los agentes y muestra un dashboard web con alertas y persistencia.
`;

ServerCommand.flags = {
    port: flags.integer({ char: 'p', description: 'Puerto del servidor', default: 3000 }),
    key: flags.string({ char: 'k', description: 'API Key compartida para seguridad', required: true }),
    auth: flags.boolean({ char: 'a', description: 'Requerir autenticación básica para el Dashboard', default: false }),
    user: flags.string({ description: 'Usuario personalizado para el Dashboard (por defecto: koram)' }),
    pass: flags.string({ description: 'Contraseña personalizada para el Dashboard (por defecto: API_KEY)' }),
};

module.exports = ServerCommand;
