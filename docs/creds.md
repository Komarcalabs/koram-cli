# Guía Sagrada de Credenciales (Bóveda de Seguridad)

`koram-cli` almacena de forma encriptada y segura los tokens de acceso de tu infraestructura. Esta guía detalla cómo opera la bóveda, cómo registrar servidores SSH y cuentas de almacenamiento AWS S3, y cómo se mapean los parámetros.

---

## 1. Funcionamiento de la Bóveda de Seguridad

La seguridad de las contraseñas y llaves de acceso es crítica. Por ello, Koram implementa dos capas de almacenamiento:
1. **Keytar (Capa Criptográfica por Defecto):** En computadoras personales (macOS, Windows, Linux con Keychain activo), Koram utiliza la biblioteca `keytar` para delegar la encriptación directamente al llavero o bóveda de seguridad oficial de tu Sistema Operativo. Las contraseñas nunca se guardan en texto plano en el disco.
2. **JSON Fallback:** En entornos restringidos sin llavero de sistema (como WSL sin entorno gráfico o contenedores de CI/CD), Koram guarda los metadatos en un archivo en tu carpeta de usuario: `~/.koram_credentials.json`. Si no hay keytar disponible, los passwords se respaldan de forma local en este archivo (se puede forzar este modo con la bandera `--fallback`).

---

## 2. Comandos de la Bóveda

### A. Registrar Credenciales (`koram creds:add`)
Guarda de forma segura los accesos para un servidor SSH o una cuenta de AWS S3.
```bash
koram creds:add <alias> <usuario> [host/región] [flags]
```

#### Flags de `creds:add`
* `-t, --type`: Tipo de credencial a guardar. Opciones: `server` (defecto) o `s3`.
* `-f, --fallback`: Fuerza el almacenamiento en formato JSON plano en la ruta de usuario en lugar de usar el llavero criptográfico del sistema.

---

## 3. Mapeo de Tipos de Credenciales

Para mantener el esquema simple, ligero e infinitamente compatible, Koram utiliza una estructura de metadatos dinámica basada en el parámetro `"type"`. Esto te permite registrar diferentes servicios usando las mismas variables técnicas pero visualizándolos con etiquetas personalizadas en consola:

### Tipo 1: Servidores SSH (`--type server` / Por Defecto)
Se utiliza para las conexiones remotas de despliegue, túneles e infraestructura.
* **Mapeo de Campos:**
  * `<alias>` $\rightarrow$ Nombre legible para conectar (ej: `vps-produccion`).
  * `<usuario>` $\rightarrow$ Nombre de usuario SSH (ej: `root`).
  * `[host]` $\rightarrow$ IP pública o dominio del servidor VPS.
  * `[password]` *(Prompt)* $\rightarrow$ Contraseña de acceso SSH.
* **Ejemplo de Registro:**
  ```bash
  koram creds:add vps-produccion root 64.23.174.86
  ```

---

### Tipo 2: Almacenamiento AWS S3 (`--type s3`)
Se utiliza para realizar subidas de copias de seguridad de forma segura a la nube de AWS S3.
* **Mapeo de Campos:**
  * `<alias>` $\rightarrow$ Nombre legible para tu bloque de backups (ej: `mi-s3`).
  * `<usuario>` $\rightarrow$ **AWS Access Key ID** (ej: `AKIAIOSFODNN7EXAMPLE`).
  * `[host]` $\rightarrow$ **AWS Region** (ej: `us-east-1`).
  * `[password]` *(Prompt)* $\rightarrow$ **AWS Secret Access Key**.
* **Ejemplo de Registro Completo:**
  ```bash
  koram creds:add mi-s3 AKIAIOSFODNN7EXAMPLE us-east-1 --type s3
  ```
* **Ejemplo de Asistente Interactivo Simple (Recomendado):**
  Puedes omitir el Access Key en los argumentos pasando el usuario reservado `s3`, y el CLI iniciará un wizard específico para AWS:
  ```bash
  koram creds:add mi-s3 s3
  ```
  *Te guiará pidiendo el Access Key, Secret Key y Región con prompts específicos.*

---

## 4. Visualización y Eliminación de Credenciales

### Listar Credenciales (`koram creds:ls`)
Muestra una tabla con todos los registros guardados en la bóveda local indicando su tipo (`AWS S3` o `SSH Server`) y origen de almacenamiento (`keytar` o `fallback`).
```bash
koram creds:ls

# Para ver también las contraseñas o secret keys guardadas
koram creds:ls -p
```

### Mostrar Detalle de Credencial (`koram creds:show`)
Despliega en formato tabla el detalle completo de un registro por su alias. El formato y encabezados de la tabla se adaptarán dinámicamente según el tipo de credencial:
```bash
koram creds:show mi-s3
```
*Si la credencial es de tipo S3, mostrará los encabezados "AWS Access Key ID", "AWS Secret Key" y "Región por defecto" de forma limpia.*

### Eliminar Credenciales (`koram creds:rm`)
Borra físicamente del llavero criptográfico y del archivo de metadatos la credencial indicada por su alias:
```bash
koram creds:rm <alias>
```
