import sys
import os
import json
import subprocess
import paramiko
import glob
import re
import base64
import getpass
import platform
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from scp import SCPClient
from PyQt5.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton,
    QTextEdit, QComboBox, QTableWidget, QTableWidgetItem, QScrollArea, QFrame
)
from PyQt5.QtCore import QThread, pyqtSignal

# ========= CIFRADO / DESCIFRADO =========
def generate_key():
    user = getpass.getuser()
    hostname = platform.node()
    salt = b"koram_static_salt"
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=390000,
    )
    return base64.urlsafe_b64encode(kdf.derive(f"{user}@{hostname}".encode()))

def encrypt_password(password: str) -> str:
    if not password:
        return ""
    f = Fernet(generate_key())
    return f.encrypt(password.encode()).decode()

def decrypt_password(encrypted_password: str) -> str:
    if not encrypted_password:
        return ""
    try:
        f = Fernet(generate_key())
        return f.decrypt(encrypted_password.encode()).decode()
    except Exception:
        return ""

# ========= LIMPIEZA ANSI =========
def clean_ansi(text):
    ansi_escape = re.compile(r'\x1B\[[0-?]*[ -/]*[@-~]')
    return ansi_escape.sub('', text)

# ========= WORKER =========
class DeployWorker(QThread):
    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal(bool)

    def __init__(self, host, user, password, remote_path, appname, app_port, rc_path, build_env, env_vars, use_pm2, pre_commands, optimize_npm):
        super().__init__()
        self.host = host
        self.user = user
        self.password = password
        self.remote_path = remote_path
        self.appname = appname
        self.app_port = app_port
        self.rc_path = rc_path
        self.build_env = build_env
        self.env_vars = env_vars
        self.use_pm2 = use_pm2
        self.pre_commands = pre_commands
        self.optimize_npm = optimize_npm

    def run(self):
        try:
            self.log(f"🚀 Iniciando build local usando {self.build_env}...")
            env = os.environ.copy()
            env['NODE_ENV'] = self.build_env
            for k, v in self.env_vars.items():
                env[k] = v

            result = subprocess.run(["node", "-v"], capture_output=True, text=True)
            self.log(f"🔹 Node.js versión local: {result.stdout.strip()}")

            if self.optimize_npm:
                self.log("🚀 Build optimizado local: Instalando dependencias (incremental)...")
                subprocess.run(["npm", "install", "--omit=dev", "--no-progress"], check=True, env=env)
            else:
                self.log("🧹 Build limpio local: Limpiando node_modules...")
                subprocess.run(["rm", "-rf", "node_modules"], check=True)
                # NO borramos package-lock.json para evitar errores de sincronización
                subprocess.run(["npm", "ci", "--omit=dev", "--no-progress"], check=True, env=env)

            # Construye la app
            self.log("🔨 Construyendo la app...")
            subprocess.run(["npm", "run", "build", "--", "--no-progress"], check=True, env=env)

            # Detectar carpeta de salida (Nuxt3: .output, Nuxt2: .nuxt)
            output_dir = ".output" if os.path.exists(".output") else ".nuxt"
            if not os.path.exists(output_dir):
                self.log(f"❌ Directorio de build no encontrado (.output o .nuxt).")
                self.finished_signal.emit(False)
                return

            server_node_modules = os.path.join(output_dir, "server", "node_modules")
            if os.path.exists(server_node_modules):
                self.log("🧹 Limpiando node_modules nativos del build local...")
                subprocess.run(["rm", "-rf", server_node_modules], check=True)

            self.log("📦 Empaquetando archivos...")
            files_to_pack = [output_dir, "package.json", "package-lock.json", "public"]
            existing_files = [f for f in files_to_pack if os.path.exists(f)]
            subprocess.run([
                "tar", "--no-xattrs", "--dereference", "-czf", "nuxt-output.tar.gz", *existing_files
            ], check=True)

            self.log(f"🔌 Conectando a {self.host}...")
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            if self.password:
                ssh.connect(self.host, username=self.user, password=self.password, timeout=15)
            else:
                ssh.connect(self.host, username=self.user, timeout=15)

            self.log("📁 Asegurando carpeta remota...")
            ssh.exec_command(f"mkdir -p {self.remote_path}")

            self.log("⬆️ Subiendo build...")
            with SCPClient(ssh.get_transport()) as scp:
                scp.put("nuxt-output.tar.gz", self.remote_path)

            self.log("📝 Creando archivo .env remoto...")
            env_lines = [f'{k}="{v}"' for k, v in self.env_vars.items()]
            env_lines.append(f'PORT={self.app_port}')
            env_content = "\n".join(env_lines)
            env_path_remote = f"{self.remote_path}/.env"

            sftp = ssh.open_sftp()
            with sftp.file(env_path_remote, 'w') as f:
                f.write(env_content)
            sftp.close()

            self.log("⚙️ Ejecutando comandos en servidor...")

            remote_cmds = f"cd {self.remote_path} && "
            if self.pre_commands:
                remote_cmds += " && ".join(self.pre_commands) + " && "
            # --omit=optional con fallback
            
            if self.optimize_npm:
                npm_cmds = (
                    "npm install --omit=dev --prefer-offline --no-audit --no-progress && "
                    "(npm rebuild --update-binary --build-from-source || npm rebuild --update-binary) && "
                )
            else:
                npm_cmds = (
                    "npm ci --omit=dev && "
                    "npm rebuild --update-binary && "
                )


            # 🔹 Limpieza correcta (no borrar el tar antes de extraerlo)
            remote_cmds += (
                "rm -rf .output public .nuxt .cache && "
                "tar --overwrite -xzf nuxt-output.tar.gz && "
                "rm nuxt-output.tar.gz && "
                + npm_cmds +
                "export $(cat .env | xargs) && "
            )

            if self.use_pm2:
                remote_cmds += (
                    f"if pm2 describe {self.appname} > /dev/null; then "
                    f"pm2 reload {self.appname} --update-env; "
                    f"else pm2 start .output/server/index.mjs --name {self.appname} --env {self.build_env}; fi"
                )
            else:
                remote_cmds += "node .output/server/index.mjs"

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

# ========= INTERFAZ =========
class DeployerApp(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Nuxt Deployer")
        self.setGeometry(200, 200, 950, 700)

        # Contenedor con scroll
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)

        container = QWidget()
        main_layout = QVBoxLayout(container)

        # --- Selector RC ---
        main_layout.addWidget(QLabel("Seleccionar configuración (.koram-rc):"))
        self.rc_selector = QComboBox()
        main_layout.addWidget(self.rc_selector)

        # --- Datos servidor ---
        main_layout.addWidget(QLabel("Conexión SSH:"))
        server_layout = QHBoxLayout()

        self.user_input = QLineEdit(); self.user_input.setPlaceholderText("Usuario SSH")
        self.host_input = QLineEdit(); self.host_input.setPlaceholderText("IP / Host")
        self.password_input = QLineEdit(); self.password_input.setPlaceholderText("Contraseña SSH (opcional)")
        self.password_input.setEchoMode(QLineEdit.Password)

        server_layout.addWidget(QLabel("Usuario:"))
        server_layout.addWidget(self.user_input, 20)
        server_layout.addWidget(QLabel("Host:"))
        server_layout.addWidget(self.host_input, 40)
        server_layout.addWidget(QLabel("Contraseña:"))
        server_layout.addWidget(self.password_input, 40)

        main_layout.addLayout(server_layout)


        # --- Deploy Path ---
        server_layout2 = QHBoxLayout()
        self.path_input = QLineEdit(); self.path_input.setPlaceholderText("Ruta remota (deploy.path)")
        server_layout2.addWidget(QLabel("Ruta remota:"))
        server_layout2.addWidget(self.path_input)
        main_layout.addLayout(server_layout2)

        # --- PreDeploy ---
        main_layout.addWidget(QLabel("Comandos preDeploy:"))
        self.pre_table = QTableWidget()
        self.pre_table.setColumnCount(1)
        self.pre_table.setHorizontalHeaderLabels(["Comando"])
        self.pre_table.setMinimumHeight(120)
        main_layout.addWidget(self.pre_table)

        pre_btns = QHBoxLayout()
        add_pre_btn = QPushButton("Agregar")
        add_pre_btn.clicked.connect(self.add_pre_row)
        remove_pre_btn = QPushButton("Eliminar")
        remove_pre_btn.clicked.connect(self.remove_pre_row)
        pre_btns.addWidget(add_pre_btn)
        pre_btns.addWidget(remove_pre_btn)
        main_layout.addLayout(pre_btns)

        # --- App / Entorno / Puerto ---
        app_layout = QHBoxLayout()
        self.appname_input = QLineEdit(); self.appname_input.setPlaceholderText("Nombre app")
        self.build_env_selector = QComboBox()
        self.port_build_input = QLineEdit(); self.port_build_input.setPlaceholderText("Puerto")
        app_layout.addWidget(QLabel("App:"))
        app_layout.addWidget(self.appname_input, 40)
        app_layout.addWidget(QLabel("Entorno build:"))
        app_layout.addWidget(self.build_env_selector, 40)
        app_layout.addWidget(QLabel("Puerto:"))
        app_layout.addWidget(self.port_build_input, 20)
        main_layout.addLayout(app_layout)

        # --- Variables de entorno ---
        main_layout.addWidget(QLabel("Variables de entorno:"))
        self.env_table = QTableWidget()
        self.env_table.setColumnCount(2)
        self.env_table.setHorizontalHeaderLabels(["KEY", "VALUE"])
        self.env_table.setMinimumHeight(220)
        main_layout.addWidget(self.env_table)

        def resize_columns():
            total_width = self.env_table.viewport().width()
            self.env_table.setColumnWidth(0, int(total_width * 0.35))
            self.env_table.setColumnWidth(1, int(total_width * 0.65))
        self.env_table.resizeEvent = lambda event: resize_columns()
        resize_columns()

        env_btns = QHBoxLayout()
        add_btn = QPushButton("Agregar")
        add_btn.clicked.connect(self.add_env_row)
        remove_btn = QPushButton("Eliminar")
        remove_btn.clicked.connect(self.remove_env_row)
        env_btns.addWidget(add_btn)
        env_btns.addWidget(remove_btn)
        main_layout.addLayout(env_btns)

        # --- Opciones extra ---
        options_layout = QHBoxLayout()
        self.use_pm2_selector = QComboBox()
        self.use_pm2_selector.addItems(["Sí", "No"])
        options_layout.addWidget(QLabel("Usar PM2?"))
        options_layout.addWidget(self.use_pm2_selector, 20)
        self.optimize_npm_selector = QComboBox()
        self.optimize_npm_selector.addItems(["Sí", "No"])
        options_layout.addWidget(QLabel("Optimizar npm ci?"))
        options_layout.addWidget(self.optimize_npm_selector, 20)
        main_layout.addLayout(options_layout)

        # --- Deploy + Logs ---
        deploy_btn = QPushButton("Deploy")
        deploy_btn.clicked.connect(self.deploy)
        main_layout.addWidget(deploy_btn)

        main_layout.addWidget(QLabel("Logs:"))
        self.log_output = QTextEdit(); self.log_output.setReadOnly(True)
        self.log_output.setMinimumHeight(300)
        main_layout.addWidget(self.log_output)

        scroll.setWidget(container)

        final_layout = QVBoxLayout(self)
        final_layout.addWidget(scroll)

        # --- Archivos detectados ---
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

    # ======== PREDEPLOY ROWS ========
    def add_pre_row(self):
        row = self.pre_table.rowCount()
        self.pre_table.insertRow(row)
        self.pre_table.setItem(row, 0, QTableWidgetItem(""))

    def remove_pre_row(self):
        row = self.pre_table.currentRow()
        if row >= 0:
            self.pre_table.removeRow(row)

    # ======== ENV ROWS ========
    def add_env_row(self):
        row = self.env_table.rowCount()
        self.env_table.insertRow(row)
        self.env_table.setItem(row, 0, QTableWidgetItem(""))
        self.env_table.setItem(row, 1, QTableWidgetItem(""))

    def remove_env_row(self):
        row = self.env_table.currentRow()
        if row >= 0:
            self.env_table.removeRow(row)

    # ======== LOAD CONFIG ========
    def load_rc(self, rc_file):
        self.rc_path = rc_file
        if os.path.exists(rc_file):
            with open(rc_file, 'r') as f:
                rc_data = json.load(f)

            server = rc_data.get("server", {})
            deploy = rc_data.get("deploy", {})
            processes = rc_data.get("processes", {})
            env_vars = rc_data.get("env", {})

            self.user_input.setText(server.get("user", ""))
            self.host_input.setText(server.get("host", ""))
            self.password_input.setText(decrypt_password(server.get("password", "")))
            self.path_input.setText(deploy.get("path", ""))
            self.appname_input.setText(processes.get("app", {}).get("command", "").split("--name")[-1].strip() if "app" in processes else "")
            self.port_build_input.setText(str(env_vars.get("PORT", "3000")))

            self.pre_table.setRowCount(0)
            for cmd in deploy.get("preDeploy", []):
                row = self.pre_table.rowCount()
                self.pre_table.insertRow(row)
                self.pre_table.setItem(row, 0, QTableWidgetItem(cmd))

            self.env_table.setRowCount(0)
            for k, v in env_vars.items():
                if k != "PORT":
                    row = self.env_table.rowCount()
                    self.env_table.insertRow(row)
                    self.env_table.setItem(row, 0, QTableWidgetItem(k))
                    self.env_table.setItem(row, 1, QTableWidgetItem(v))

    def log(self, message):
        self.log_output.append(message)
        QApplication.processEvents()

    # ======== DEPLOY ========
    def deploy(self):
        host = self.host_input.text()
        app_port = self.port_build_input.text() or "3000"
        user = self.user_input.text()
        password = self.password_input.text()
        remote_path = self.path_input.text()
        appname = self.appname_input.text()
        build_env_file = self.build_env_selector.currentText()
        build_env_name = build_env_file.split('.')[-1] if build_env_file else "production"
        use_pm2 = self.use_pm2_selector.currentText() == "Sí"
        optimize_npm = self.optimize_npm_selector.currentText() == "Sí"

        pre_commands = []
        for row in range(self.pre_table.rowCount()):
            cmd_item = self.pre_table.item(row, 0)
            if cmd_item:
                cmd = cmd_item.text().strip()
                if cmd:
                    pre_commands.append(cmd)

        env_vars = {}
        for row in range(self.env_table.rowCount()):
            key_item = self.env_table.item(row, 0)
            val_item = self.env_table.item(row, 1)
            if key_item and val_item:
                key = key_item.text().strip()
                val = val_item.text().strip()
                if key:
                    env_vars[key] = val
        env_vars["PORT"] = app_port

        config = {
            "environment": build_env_name,
            "server": {
                "host": host,
                "user": user,
                "port": 22,
                "password": encrypt_password(password) if password else "",
                "sshKey": ""
            },
            "deploy": {
                "repository": "",
                "branch": "main",
                "path": remote_path,
                "preDeploy": pre_commands,
                "postDeploy": []
            },
            "processes": {
                "app": {
                    "command": f"pm2 start dist/index.js --name {appname}",
                    "logsPath": f"/var/log/{appname}.log"
                }
            },
            "env": env_vars
        }

        with open(self.rc_path, 'w') as f:
            json.dump(config, f, indent=2)

        self.log(f"💾 Configuración guardada en {self.rc_path}")

        self.worker = DeployWorker(
            host, user, password, remote_path, appname, app_port, self.rc_path,
            build_env_name, env_vars, use_pm2, pre_commands, optimize_npm
        )
        self.worker.log_signal.connect(self.log)
        self.worker.finished_signal.connect(lambda success: self.log("✅ Deploy terminado." if success else "❌ Deploy fallido."))
        self.worker.start()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = DeployerApp()

    rc_path_env = os.environ.get("RC_PATH")
    if rc_path_env and os.path.exists(rc_path_env):
        # Tomar solo el nombre del archivo para que coincida con el combo
        rc_file_name = os.path.basename(rc_path_env)
        window.rc_selector.setCurrentText(rc_file_name)  # Esto llama a load_rc automáticamente

    # Sobrescribir contraseña si viene por env
    password_env = os.environ.get("PASSWORD")
    if password_env:
        window.password_input.setText(password_env)

    window.show()
    sys.exit(app.exec_())
