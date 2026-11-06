const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

async function generateBrandIcons() {
  const rootDir = path.resolve(__dirname, "..");
  const symbolSvgPath = path.join(rootDir, "public", "logo-symbol.svg");
  const symbolSvgBuffer = fs.readFileSync(symbolSvgPath);

  console.log("Gerando ícones oficiais da marca Rede Ativa com Sharp...");

  // 1. PWA Icons em public/
  const pwaTargets = [
    { file: path.join(rootDir, "public", "icon-192.png"), size: 192 },
    { file: path.join(rootDir, "public", "icon-512.png"), size: 512 },
    { file: path.join(rootDir, "public", "icon-maskable.png"), size: 512 },
  ];

  for (const target of pwaTargets) {
    await sharp(symbolSvgBuffer)
      .resize(target.size, target.size)
      .png({ quality: 95, compressionLevel: 9 })
      .toFile(target.file);
    console.log(`✓ Gerado: ${path.relative(rootDir, target.file)} (${target.size}x${target.size})`);
  }

  // 2. Extensão Chrome em extension/icons/
  const extIconsDir = path.join(rootDir, "extension", "icons");
  if (!fs.existsSync(extIconsDir)) {
    fs.mkdirSync(extIconsDir, { recursive: true });
  }

  const extTargets = [
    { file: path.join(extIconsDir, "icon16.png"), size: 16 },
    { file: path.join(extIconsDir, "icon48.png"), size: 48 },
    { file: path.join(extIconsDir, "icon128.png"), size: 128 },
  ];

  for (const target of extTargets) {
    await sharp(symbolSvgBuffer)
      .resize(target.size, target.size)
      .png({ quality: 95, compressionLevel: 9 })
      .toFile(target.file);
    console.log(`✓ Gerado: ${path.relative(rootDir, target.file)} (${target.size}x${target.size})`);
  }

  console.log("Todos os ícones da Rede Ativa foram gerados com sucesso!");
}

generateBrandIcons().catch((err) => {
  console.error("Erro ao gerar ícones de marca:", err);
  process.exit(1);
});
