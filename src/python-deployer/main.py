import sys
import os
import json
import subprocess
import paramiko
import glob
import re
from scp import SCPClient
from PyQt5.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton,
    QTextEdit, QComboBox, QTableWidget, QTableWidgetItem
)
from PyQt5.QtCore import QThread, pyqtSignal

def clean_ansi(text):
    ansi_escape = re.compile(r'\x1B\[[0-?]*[ -/]*[@-~]')
    return ansi_escape.sub('', text)

class DeployWorker(QThread):
    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal(bool)

    def __init__(self, host, user, remote_path, appname, app_port, rc_path, build_env, env_vars, use_pm2, pre_command):
        super().__init__()
        self.host = host
        self.user = user
        self.remote_path = remote_path
        self.appname = appname
        self.app_port = app_port
        self.rc_path = rc_path
        self.build_env = build_env
        self.env_vars = env_vars
        self.use_pm2 = use_pm2
        self.pre_command = pre_command

    def run(self):
        try:
            # --- BUILD LOCAL ---
            self.log(f"🚀 Iniciando build local usando {self.build_env}...")
            env = os.environ.copy()
            env['NODE_ENV'] = self.build_env
            for k, v in self.env_vars.items():
                env[k] = v

            # Log versión de Node local
            result = subprocess.run(["node", "-v"], capture_output=True, text=True)
            self.log(f"🔹 Node.js versión local: {result.stdout.strip()}")

            subprocess.run(["npm", "ci", "--omit=dev", "--no-progress"], check=True, env=env)
            subprocess.run(["npm", "run", "build", "--", "--no-progress"], check=True, env=env)

            output_dir = ".output"
            if not os.path.exists(output_dir):
                self.log(f"❌ Directorio {output_dir} no encontrado.")
                self.finished_signal.emit(False)
                return

            # Limpiar node_modules nativos del build
            server_node_modules = os.path.join(output_dir, "server", "node_modules")
            if os.path.exists(server_node_modules):
                self.log("🧹 Limpiando node_modules nativos del build local...")
                subprocess.run(["rm", "-rf", server_node_modules], check=True)

            self.log("📦 Empaquetando archivos...")
            subprocess.run([
                "tar", "--no-xattrs", "--dereference", "-czf", "nuxt-output.tar.gz",
                ".output", "package.json", "package-lock.json", "public"
            ], check=True)

            # --- SSH ---
            self.log(f"🔌 Conectando a {self.host}...")
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(self.host, username=self.user, timeout=15)

            self.log("📁 Asegurando carpeta remota...")
            ssh.exec_command(f"mkdir -p {self.remote_path}")

            self.log("⬆️ Subiendo build...")
            with SCPClient(ssh.get_transport()) as scp:
                scp.put("nuxt-output.tar.gz", self.remote_path)

            # --- Crear archivo .env remoto ---
            self.log("📝 Creando archivo .env remoto...")
            env_lines = [f'{k}="{v}"' for k, v in self.env_vars.items()]
            env_lines.append(f'PORT={self.app_port}')
            env_content = "\n".join(env_lines)
            env_path_remote = f"{self.remote_path}/.env"

            sftp = ssh.open_sftp()
            with sftp.file(env_path_remote, 'w') as f:
                f.write(env_content)
            sftp.close()

            # --- Comandos remotos ---
            self.log("⚙️ Ejecutando comandos en servidor...")

            remote_cmds = f"cd {self.remote_path} && "
            if self.pre_command:
                remote_cmds += f"{self.pre_command} && "

            remote_cmds += (
                "rm -rf .output public package.json package-lock.json && "
                "tar -xzf nuxt-output.tar.gz && "
                "npm ci --omit=dev && "
                "npm rebuild --update-binary && "
                # Exportar variables del .env antes de ejecutar
                "export $(cat .env | xargs) && "
            )

            if self.use_pm2:
                # PM2 tomará las variables exportadas
                remote_cmds += (
                    f"pm2 restart {self.appname} --update-env || "
                    f"pm2 start .output/server/index.mjs --name {self.appname} --env production"
                )
            else:
                remote_cmds += "node .output/server/index.mjs"

            # Log versión de Node remoto antes de ejecutar la app
            stdin, stdout, stderr = ssh.exec_command("node -v && " + remote_cmds, get_pty=True)
            for line in iter(stdout.readline, ""):
                if line:
                    self.log(clean_ansi(line.strip()))
            for line in iter(stderr.readline, ""):
                if line:
                    self.log(clean_ansi(line.strip()))

            ssh.close()
            self.finished_signal.emit(True)

        except Exception as e:
            self.log(f"❌ Error: {e}")
            self.finished_signal.emit(False)

    def log(self, message):
        self.log_signal.emit(message)


class DeployerApp(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Nuxt Deployer")
        self.setGeometry(200, 200, 900, 800)

        main_layout = QVBoxLayout()

        # --- Selector de RC ---
        self.rc_selector = QComboBox()
        main_layout.addWidget(QLabel("Seleccionar configuración (.koram-rc):"))
        main_layout.addWidget(self.rc_selector)

        # --- Configuración de servidor ---
        server_layout1 = QHBoxLayout()
        self.user_input = QLineEdit(); self.user_input.setPlaceholderText("Usuario SSH")
        self.host_input = QLineEdit(); self.host_input.setPlaceholderText("IP / Host")
        server_layout1.addWidget(self.user_input, 30)
        server_layout1.addWidget(self.host_input, 70)
        main_layout.addLayout(server_layout1)

        server_layout2 = QHBoxLayout()
        self.path_input = QLineEdit(); self.path_input.setPlaceholderText("Ruta remota")
        server_layout2.addWidget(QLabel("Ruta remota:"))
        server_layout2.addWidget(self.path_input)
        main_layout.addLayout(server_layout2)

        # --- Pre-command ---
        pre_layout = QHBoxLayout()
        self.pre_cmd_input = QLineEdit(); self.pre_cmd_input.setPlaceholderText("Comando a ejecutar al conectarse (ej: nvm use 20)")
        pre_layout.addWidget(QLabel("Comando previo:"))
        pre_layout.addWidget(self.pre_cmd_input)
        main_layout.addLayout(pre_layout)

        # --- Nombre de app + entorno de build + puerto ---
        app_layout = QHBoxLayout()
        self.appname_input = QLineEdit(); self.appname_input.setPlaceholderText("Nombre app")
        self.build_env_selector = QComboBox()
        self.port_build_input = QLineEdit(); self.port_build_input.setPlaceholderText("Puerto de la app")
        app_layout.addWidget(QLabel("App:"))
        app_layout.addWidget(self.appname_input, 40)
        app_layout.addWidget(QLabel("Entorno build:"))
        app_layout.addWidget(self.build_env_selector, 40)
        app_layout.addWidget(QLabel("Puerto:"))
        app_layout.addWidget(self.port_build_input, 20)
        main_layout.addLayout(app_layout)

        # --- Tabla de variables de entorno ---
        self.env_table = QTableWidget()
        self.env_table.setColumnCount(2)
        self.env_table.setHorizontalHeaderLabels(["KEY", "VALUE"])
        self.env_table.setMinimumHeight(300)
        main_layout.addWidget(QLabel("Variables de entorno:"))
        main_layout.addWidget(self.env_table)

        def resize_columns():
            total_width = self.env_table.viewport().width()
            self.env_table.setColumnWidth(0, int(total_width * 0.35))
            self.env_table.setColumnWidth(1, int(total_width * 0.65))
        self.env_table.resizeEvent = lambda event: resize_columns()
        resize_columns()

        # Botones de agregar / eliminar variables
        buttons_layout = QHBoxLayout()
        add_btn = QPushButton("Agregar")
        add_btn.clicked.connect(self.add_env_row)
        remove_btn = QPushButton("Eliminar")
        remove_btn.clicked.connect(self.remove_env_row)
        buttons_layout.addWidget(add_btn)
        buttons_layout.addWidget(remove_btn)
        main_layout.addLayout(buttons_layout)

        # --- Usar PM2 ---
        self.use_pm2_selector = QComboBox()
        self.use_pm2_selector.addItems(["Sí", "No"])
        main_layout.addWidget(QLabel("Usar PM2?"))
        main_layout.addWidget(self.use_pm2_selector)

        # --- Logs y deploy ---
        self.log_output = QTextEdit(); self.log_output.setReadOnly(True)
        deploy_btn = QPushButton("Deploy")
        deploy_btn.clicked.connect(self.deploy)
        main_layout.addWidget(deploy_btn)
        main_layout.addWidget(QLabel("Logs:")); main_layout.addWidget(self.log_output)

        self.setLayout(main_layout)

        # --- Detectar RC y env usando glob ---
        self.rc_files = glob.glob(".koram-rc*")
        if not self.rc_files:
            self.rc_files = ['.koram-rc.default']
            with open(self.rc_files[0], 'w') as f:
                json.dump({}, f)
        self.rc_selector.addItems(self.rc_files)
        self.rc_selector.currentTextChanged.connect(self.load_rc)

        self.build_env_files = glob.glob(".env.*")
        if not self.build_env_files:
            self.build_env_files = ['.env.production']
        self.build_env_selector.addItems(self.build_env_files)

        self.load_rc(self.rc_selector.currentText())

    def add_env_row(self):
        row = self.env_table.rowCount()
        self.env_table.insertRow(row)
        self.env_table.setItem(row, 0, QTableWidgetItem(""))
        self.env_table.setItem(row, 1, QTableWidgetItem(""))

    def remove_env_row(self):
        row = self.env_table.currentRow()
        if row >= 0:
            self.env_table.removeRow(row)

    def load_rc(self, rc_file):
        self.rc_path = rc_file
        if os.path.exists(rc_file):
            with open(rc_file, 'r') as f:
                rc_data = json.load(f)
            self.user_input.setText(rc_data.get('user', ''))
            self.host_input.setText(rc_data.get('host', ''))
            self.path_input.setText(rc_data.get('remote_path', ''))
            self.appname_input.setText(rc_data.get('app_name', ''))
            self.port_build_input.setText(str(rc_data.get('port_build', '3000')))
            self.pre_cmd_input.setText(rc_data.get('pre_command', ''))

            # Cargar environment
            self.env_table.setRowCount(0)
            env_vars = rc_data.get('environment', {})
            for k, v in env_vars.items():
                row = self.env_table.rowCount()
                self.env_table.insertRow(row)
                self.env_table.setItem(row, 0, QTableWidgetItem(k))
                self.env_table.setItem(row, 1, QTableWidgetItem(v))

    def log(self, message):
        self.log_output.append(message)
        QApplication.processEvents()

    def deploy(self):
        host = self.host_input.text()
        app_port = self.port_build_input.text() or "3000"
        user = self.user_input.text()
        remote_path = self.path_input.text()
        appname = self.appname_input.text()
        build_env_file = self.build_env_selector.currentText()
        build_env_name = build_env_file.split('.')[-1] if build_env_file else "production"
        use_pm2 = self.use_pm2_selector.currentText() == "Sí"
        pre_command = self.pre_cmd_input.text().strip()

        # Variables de entorno desde la tabla
        env_vars = {}
        for row in range(self.env_table.rowCount()):
            key_item = self.env_table.item(row, 0)
            val_item = self.env_table.item(row, 1)
            if key_item and val_item:
                key = key_item.text().strip()
                val = val_item.text().strip()
                if key:
                    env_vars[key] = val

        # Guardar configuración en RC
        config = {
            "host": host,
            "port_build": app_port,
            "user": user,
            "remote_path": remote_path,
            "app_name": appname,
            "environment": env_vars,
            "pre_command": pre_command
        }
        with open(self.rc_path, 'w') as f:
            json.dump(config, f, indent=2)
        self.log(f"💾 Configuración guardada en {self.rc_path}")

        # Ejecutar deploy
        self.worker = DeployWorker(host, user, remote_path, appname, app_port, self.rc_path,
                                   build_env_name, env_vars, use_pm2, pre_command)
        self.worker.log_signal.connect(self.log)
        self.worker.finished_signal.connect(lambda success: self.log("✅ Deploy terminado." if success else "❌ Deploy fallido."))
        self.worker.start()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = DeployerApp()
    window.show()
    sys.exit(app.exec_())
