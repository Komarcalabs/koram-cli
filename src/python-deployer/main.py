import sys
import subprocess
import paramiko
from scp import SCPClient
from PyQt5.QtWidgets import QApplication, QWidget, QVBoxLayout, QLabel, QLineEdit, QPushButton, QTextEdit

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
        
        layout.addWidget(QLabel("Host:"))
        layout.addWidget(self.host_input)
        layout.addWidget(QLabel("Usuario:"))
        layout.addWidget(self.user_input)
        layout.addWidget(QLabel("Ruta remota:"))
        layout.addWidget(self.path_input)
        layout.addWidget(QLabel("Nombre PM2:"))
        layout.addWidget(self.appname_input)
        layout.addWidget(deploy_btn)
        layout.addWidget(QLabel("Logs:"))
        layout.addWidget(self.log_output)
        
        self.setLayout(layout)
    
    def log(self, message):
        self.log_output.append(message)
        QApplication.processEvents()
    
    def deploy(self):
        host = self.host_input.text()
        user = self.user_input.text()
        remote_path = self.path_input.text()
        appname = self.appname_input.text()
        
        try:
            self.log("🚀 Iniciando build local...")
            subprocess.run(["npm", "ci", "--omit=dev"], check=True)
            subprocess.run(["npm", "run", "build"], check=True)
            
            self.log("📦 Empaquetando archivos...")
            subprocess.run([
                "tar", "-czf", "nuxt-output.tar.gz", 
                ".output", "package.json", "package-lock.json", "public"
            ], check=True)
            
            self.log(f"🔌 Conectando a {host}...")
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(host, username=user)
            
            self.log("⬆️ Subiendo build...")
            with SCPClient(ssh.get_transport()) as scp:
                scp.put("nuxt-output.tar.gz", remote_path)
            
            self.log("⚙️ Ejecutando comandos en servidor...")
            commands = f"""
            cd {remote_path} &&
            tar -xzf nuxt-output.tar.gz &&
            npm ci --omit=dev &&
            pm2 restart {appname} || pm2 start .output/server/index.mjs --name {appname}
            """
            stdin, stdout, stderr = ssh.exec_command(commands)
            self.log(stdout.read().decode())
            self.log(stderr.read().decode())
            
            ssh.close()
            self.log("✅ Deploy completado.")
        
        except Exception as e:
            self.log(f"❌ Error: {e}")

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = DeployerApp()
    window.show()
    sys.exit(app.exec_())
