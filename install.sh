#!/bin/bash
set -e

echo -e "\033[1;36m========================================\033[0m"
echo -e "\033[1;36m        Instalador de KORAM CLI         \033[0m"
echo -e "\033[1;36m========================================\033[0m"

# Verificar si Node.js está instalado
if ! command -v node >/dev/null 2>&1; then
    echo -e "\033[1;33m=> Node.js no está instalado.\033[0m"
    echo "=> Instalando NVM (Node Version Manager) y Node.js..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    
    # Cargar NVM en la sesión actual
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    
    # Instalar la versión más reciente de Node
    nvm install node
    nvm use node
else
    echo -e "\033[1;32m=> Node.js ya está instalado: $(node -v)\033[0m"
fi

# Instalar koram globalmente
echo -e "\033[1;33m=> Instalando koram desde npm...\033[0m"
npm install -g https://github.com/Komarcalabs/koram-cli.git

echo -e "\033[1;36m========================================\033[0m"
echo -e "\033[1;32m¡Koram instalado exitosamente!\033[0m"
echo -e "Puedes ejecutar \033[1;33mkoram\033[0m para empezar."
echo "Nota: Si acabas de instalar Node.js, puede que necesites cerrar y abrir tu terminal, o ejecutar 'source ~/.bashrc' (o ~/.zshrc)."
echo -e "\033[1;36m========================================\033[0m"
