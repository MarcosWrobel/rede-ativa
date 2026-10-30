const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Script para empacotar a extensão em public/extensao-leopoldina.zip durante o build da Vercel
const extensionDir = path.join(__dirname, '..', 'extension');
const publicDir = path.join(__dirname, '..', 'public');
const zipPath = path.join(publicDir, 'extensao-leopoldina.zip');

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

try {
  // Usa Python nativo presente no ambiente Linux/Vercel
  const pythonScript = `
import zipfile, os
zip_path = r"${zipPath}"
ext_dir = r"${extensionDir}"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk(ext_dir):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, ext_dir)
            zipf.write(full_path, rel_path)
print("Extensão compactada com sucesso em:", zip_path)
`;
  execSync(`python3 -c '${pythonScript}'`, { stdio: 'inherit' });
} catch (e) {
  console.warn('Aviso: Não foi possível compactar automaticamente com python3:', e.message);
}
