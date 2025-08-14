import sys 
import os
import json
import subprocess
import paramiko
from scp import SCPClient
from PyQt5.QtWidgets import QApplication, QWidget, QVBoxLayout, QLabel, QLineEdit, QPushButton, QTextEdit
from PyQt5.QtCore import QThread, pyqtSignal

class DeployWorker(QThread):
    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal(bool)

    def __init__(self, host, user, remote_path, appname, rc_path):
        super().__init__()
        self.host = host
        self.user = user
        self.remote_path = remote_path
        self.appname = appname
        self.rc_path = rc_path

    def run(self):
        try:
            self.log("🚀 Iniciando build local...")
            subprocess.run(["npm", "ci", "--omit=dev"], check=True)
            subprocess.run(["npm", "run", "build"], check=True)

            self.log("📦 Empaquetando archivos...")
            subprocess.run([
                "tar", "-czf", "nuxt-output.tar.gz", 
                ".output", "package.json", "package-lock.json", "public"
            ], check=True)

            self.log(f"🔌 Conectando a {self.host}...")
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(self.host, username=self.user, timeout=10)  # <--- timeout agregado

            self.log("⬆️ Subiendo build...")
            with SCPClient(ssh.get_transport()) as scp:
                scp.put("nuxt-output.tar.gz", self.remote_path)

            self.log("⚙️ Ejecutando comandos en servidor...")
            commands = f"""
            cd {self.remote_path} &&
            tar -xzf nuxt-output.tar.gz &&
            npm ci --omit=dev &&
            pm2 restart {self.appname} || pm2 start .output/server/index.mjs --name {self.appname}
            """
            stdin, stdout, stderr = ssh.exec_command(commands)
            self.log(stdout.read().decode())
            self.log(stderr.read().decode())
            
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
        self.setGeometry(200, 200, 500, 400)
        
        layout = QVBoxLayout()
        self.host_input = QLineEdit()
        self.host_input.setPlaceholderText("Host (ej. mi-servidor.com)")
        self.user_input = QLineEdit()
        self.user_input.setPlaceholderText("Usuario SSH")
        self.path_input = QLineEdit()
        self.path_input.setPlaceholderText("Ruta remota (ej. /var/www/nuxt-app)")
        self.appname_input = QLineEdit()
        self.appname_input.setPlaceholderText("Nombre de la app en PM2")
        self.log_output = QTextEdit()
        self.log_output.setReadOnly(True)
        deploy_btn = QPushButton("Deploy")
        deploy_btn.clicked.connect(self.deploy)

        layout.addWidget(QLabel("Host:")); layout.addWidget(self.host_input)
        layout.addWidget(QLabel("Usuario:")); layout.addWidget(self.user_input)
        layout.addWidget(QLabel("Ruta remota:")); layout.addWidget(self.path_input)
        layout.addWidget(QLabel("Nombre PM2:")); layout.addWidget(self.appname_input)
        layout.addWidget(deploy_btn)
        layout.addWidget(QLabel("Logs:")); layout.addWidget(self.log_output)
        self.setLayout(layout)

        self.rc_path = os.environ.get('RC_PATH', os.path.join(os.getcwd(), '.koram-rc'))
        self.host_input.setText(os.environ.get('HOST', ''))
        self.user_input.setText(os.environ.get('USER', ''))
        self.path_input.setText(os.environ.get('REMOTE_PATH', ''))
        self.appname_input.setText(os.environ.get('APP_NAME', ''))

        if os.path.exists(self.rc_path):
            with open(self.rc_path, 'r') as f:
                rc_data = json.load(f)
            self.host_input.setText(self.host_input.text() or rc_data.get('host',''))
            self.user_input.setText(self.user_input.text() or rc_data.get('user',''))
            self.path_input.setText(self.path_input.text() or rc_data.get('remote_path',''))
            self.appname_input.setText(self.appname_input.text() or rc_data.get('app_name',''))

    def log(self, message):
        self.log_output.append(message)
        QApplication.processEvents()

    def deploy(self):
        host = self.host_input.text()
        user = self.user_input.text()
        remote_path = self.path_input.text()
        appname = self.appname_input.text()

        # Guardar configuración
        config = {"host": host, "user": user, "remote_path": remote_path, "app_name": appname}
        with open(self.rc_path, 'w') as f:
            json.dump(config, f, indent=2)
        self.log(f"💾 Configuración guardada en {self.rc_path}")

        # Lanzar hilo del deploy
        self.worker = DeployWorker(host, user, remote_path, appname, self.rc_path)
        self.worker.log_signal.connect(self.log)
        self.worker.finished_signal.connect(lambda success: self.log("✅ Deploy terminado." if success else "❌ Deploy fallido."))
        self.worker.start()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = DeployerApp()
    window.show()
    sys.exit(app.exec_())
