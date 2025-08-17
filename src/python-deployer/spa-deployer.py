import sys, os, glob, subprocess, getpass, platform, json, re
import paramiko
from scp import SCPClient
from PyQt5.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QTextEdit, QComboBox, QTableWidget, QTableWidgetItem
)
from PyQt5.QtCore import QThread, pyqtSignal

# ---------- LIMPIEZA ANSI ----------
def clean_ansi(text):
    ansi_escape = re.compile(r'\x1B\[[0-?]*[ -/]*[@-~]')
    return ansi_escape.sub('', text)

# ---------- WORKER SPA ----------
class DeployWorkerSPA(QThread):
    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal(bool)

    def __init__(self, host, user, password, remote_path, rc_path, build_env, env_vars, pre_command):
        super().__init__()
        self.host = host
        self.user = user
        self.password = password
        self.remote_path = remote_path
        self.rc_path = rc_path
        self.build_env = build_env
        self.env_vars = env_vars
        self.pre_command = pre_command

    def run(self):
        try:
            self.log(f"🚀 Iniciando build local con NODE_ENV={self.build_env}...")
            env = os.environ.copy()
            env['NODE_ENV'] = self.build_env
            for k, v in self.env_vars.items():
                env[k] = v

            subprocess.run(["npm", "ci", "--no-progress"], check=True, env=env)
            subprocess.run(["npm", "run", "build", "--", "--no-progress"], check=True, env=env)

            output_dir = "dist"
            if not os.path.exists(output_dir):
                self.log(f"❌ Directorio {output_dir} no encontrado.")
                self.finished_signal.emit(False)
                return

            self.log("📦 Empaquetando build...")
            subprocess.run(["tar", "--no-xattrs", "--dereference", "-czf", "spa-build.tar.gz", output_dir], check=True)

            self.log(f"🔌 Conectando a {self.host}...")
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            if self.password:
                ssh.connect(self.host, username=self.user, password=self.password, timeout=15)
            else:
                ssh.connect(self.host, username=self.user, timeout=15)

            self.log("📁 Creando carpeta remota...")
            ssh.exec_command(f"mkdir -p {self.remote_path}")

            self.log("⬆️ Subiendo build...")
            with SCPClient(ssh.get_transport()) as scp:
                scp.put("spa-build.tar.gz", self.remote_path)

            self.log("⚙️ Desempaquetando en servidor...")
            remote_cmds = f"cd {self.remote_path} && "
            if self.pre_command:
                remote_cmds += f"{self.pre_command} && "
            remote_cmds += "rm -rf dist && tar --overwrite -xzf spa-build.tar.gz && rm spa-build.tar.gz"

            stdin, stdout, stderr = ssh.exec_command(remote_cmds, get_pty=True)
            for line in iter(stdout.readline, ""):
                if line: self.log(clean_ansi(line.strip()))
            for line in iter(stderr.readline, ""):
                if line: self.log(clean_ansi(line.strip()))

            ssh.close()
            self.finished_signal.emit(True)

        except Exception as e:
            self.log(f"❌ Error: {e}")
            self.finished_signal.emit(False)

    def log(self, message):
        self.log_signal.emit(message)

# ---------- INTERFAZ ----------
class SPADeployerApp(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("SPA Deployer")
        self.setGeometry(200, 200, 800, 700)
        main_layout = QVBoxLayout()

        # Host y usuario
        server_layout = QHBoxLayout()
        self.user_input = QLineEdit(); self.user_input.setPlaceholderText("Usuario SSH")
        self.host_input = QLineEdit(); self.host_input.setPlaceholderText("IP / Host")
        server_layout.addWidget(self.user_input)
        server_layout.addWidget(self.host_input)
        main_layout.addLayout(server_layout)

        # Contraseña opcional
        pwd_layout = QHBoxLayout()
        self.password_input = QLineEdit(); self.password_input.setEchoMode(QLineEdit.Password)
        self.password_input.setPlaceholderText("Contraseña SSH (opcional)")
        pwd_layout.addWidget(QLabel("Contraseña:"))
        pwd_layout.addWidget(self.password_input)
        main_layout.addLayout(pwd_layout)

        # Ruta remota
        path_layout = QHBoxLayout()
        self.path_input = QLineEdit(); self.path_input.setPlaceholderText("Ruta remota (ej: /var/www/mi-spa)")
        path_layout.addWidget(QLabel("Ruta remota:"))
        path_layout.addWidget(self.path_input)
        main_layout.addLayout(path_layout)

        # Pre-command (ej: nvm use)
        pre_layout = QHBoxLayout()
        self.pre_cmd_input = QLineEdit(); self.pre_cmd_input.setPlaceholderText("Comando previo opcional")
        pre_layout.addWidget(QLabel("Pre-command:"))
        pre_layout.addWidget(self.pre_cmd_input)
        main_layout.addLayout(pre_layout)

        # Entorno build
        build_layout = QHBoxLayout()
        self.build_env_selector = QComboBox()
        self.build_env_selector.addItems([f.replace('.env.', '') for f in glob.glob(".env.*")] or ["production"])
        build_layout.addWidget(QLabel("Entorno build:"))
        build_layout.addWidget(self.build_env_selector)
        main_layout.addLayout(build_layout)

        # Tabla variables de entorno
        self.env_table = QTableWidget(); self.env_table.setColumnCount(2)
        self.env_table.setHorizontalHeaderLabels(["KEY", "VALUE"])
        self.env_table.setMinimumHeight(200)
        main_layout.addWidget(QLabel("Variables de entorno (opcional):"))
        main_layout.addWidget(self.env_table)

        # Botones agregar/eliminar
        btn_layout = QHBoxLayout()
        add_btn = QPushButton("Agregar"); add_btn.clicked.connect(self.add_env_row)
        remove_btn = QPushButton("Eliminar"); remove_btn.clicked.connect(self.remove_env_row)
        btn_layout.addWidget(add_btn); btn_layout.addWidget(remove_btn)
        main_layout.addLayout(btn_layout)

        # Logs
        self.log_output = QTextEdit(); self.log_output.setReadOnly(True)
        deploy_btn = QPushButton("Deploy"); deploy_btn.clicked.connect(self.deploy)
        main_layout.addWidget(deploy_btn)
        main_layout.addWidget(QLabel("Logs:"))
        main_layout.addWidget(self.log_output)

        self.setLayout(main_layout)

    def add_env_row(self):
        row = self.env_table.rowCount()
        self.env_table.insertRow(row)
        self.env_table.setItem(row, 0, QTableWidgetItem(""))
        self.env_table.setItem(row, 1, QTableWidgetItem(""))

    def remove_env_row(self):
        row = self.env_table.currentRow()
        if row >= 0: self.env_table.removeRow(row)

    def log(self, msg):
        self.log_output.append(msg)
        QApplication.processEvents()

    def deploy(self):
        host = self.host_input.text()
        user = self.user_input.text()
        password = self.password_input.text()
        remote_path = self.path_input.text()
        build_env = self.build_env_selector.currentText()
        pre_command = self.pre_cmd_input.text().strip()

        env_vars = {}
        for row in range(self.env_table.rowCount()):
            k_item = self.env_table.item(row,0)
            v_item = self.env_table.item(row,1)
            if k_item and v_item and k_item.text().strip():
                env_vars[k_item.text().strip()] = v_item.text().strip()

        self.worker = DeployWorkerSPA(host, user, password, remote_path, "", build_env, env_vars, pre_command)
        self.worker.log_signal.connect(self.log)
        self.worker.finished_signal.connect(lambda success: self.log("✅ Deploy terminado." if success else "❌ Deploy fallido."))
        self.worker.start()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = SPADeployerApp()
    window.show()
    sys.exit(app.exec_())
