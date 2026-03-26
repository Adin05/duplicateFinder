const fs = require('fs/promises');
const path = require('path');

const pngToIcoModule = require('png-to-ico');
const sharp = require('sharp');

const projectRoot = path.resolve(__dirname, '..');
const sourceSvg = path.join(projectRoot, 'assets', 'icon.svg');
const buildDir = path.join(projectRoot, 'build');

const pngSizes = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  const pngToIco =
    typeof pngToIcoModule === 'function' ? pngToIcoModule : pngToIcoModule.default;

  await fs.mkdir(buildDir, { recursive: true });

  const pngPaths = [];
  for (const size of pngSizes) {
    const outputPath = path.join(buildDir, `icon-${size}.png`);
    await sharp(sourceSvg)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    pngPaths.push(outputPath);
  }

  const icoBuffer = await pngToIco(pngPaths);
  await fs.writeFile(path.join(buildDir, 'icon.ico'), icoBuffer);
  await fs.copyFile(path.join(buildDir, 'icon-256.png'), path.join(buildDir, 'icon.png'));

  console.log('Generated build/icon.ico and build/icon.png');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
