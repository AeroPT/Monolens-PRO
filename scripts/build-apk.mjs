import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const isWin = process.platform === 'win32';
const shouldPublishRelease = process.argv.includes('--release');
const androidDir = path.resolve(process.cwd(), 'android');

if (!fs.existsSync(androidDir)) {
  console.error('Pasta android/ nao encontrada. Execute "npx cap add android" primeiro.');
  process.exit(1);
}

const env = { ...process.env };

if (isWin) {
  if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT && env.LOCALAPPDATA) {
    const defaultSdk = path.join(env.LOCALAPPDATA, 'Android', 'Sdk');
    if (fs.existsSync(defaultSdk)) {
      env.ANDROID_HOME = defaultSdk;
      env.ANDROID_SDK_ROOT = defaultSdk;
    }
  }

  if (!env.JAVA_HOME) {
    const candidateJdks = [
      'C:\\Program Files\\Android\\Android Studio\\jbr',
      'C:\\Program Files\\Android\\Android Studio\\jre',
    ];
    for (const candidate of candidateJdks) {
      if (fs.existsSync(candidate)) {
        env.JAVA_HOME = candidate;
        env.PATH = `${path.join(candidate, 'bin')};${env.PATH || ''}`;
        break;
      }
    }
  }
}

const result = isWin
  ? spawnSync('cmd.exe', ['/c', 'gradlew.bat', 'assembleDebug'], {
      cwd: androidDir,
      env,
      stdio: 'inherit',
    })
  : spawnSync('./gradlew', ['assembleDebug'], {
      cwd: androidDir,
      env,
      stdio: 'inherit',
    });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const apkPath = path.join(
  androidDir,
  'app',
  'build',
  'outputs',
  'apk',
  'debug',
  'app-debug.apk'
);

if (!fs.existsSync(apkPath)) {
  console.error('Erro: app-debug.apk nao encontrado apos a compilacao.');
  process.exit(1);
}

console.log(`\nAPK gerado com sucesso em:\n${apkPath}\n`);

if (shouldPublishRelease) {
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const tag = `v${pkg.version}`;
  const assetArg = `${apkPath}#monolens-pro-${tag}-debug.apk`;

  console.log(`A publicar release ${tag} no GitHub...`);

  const ghResult = spawnSync(
    'gh',
    [
      'release',
      'create',
      tag,
      assetArg,
      '--title',
      `MonoLens Pro ${tag}`,
      '--generate-notes',
    ],
    {
      stdio: 'inherit',
    }
  );

  if (ghResult.status !== 0) {
    console.error('Falha ao criar a release no GitHub. Verifica se a tag ja existe ou se o gh esta autenticado.');
    process.exit(ghResult.status ?? 1);
  }

  console.log(`\nRelease ${tag} publicada com sucesso no GitHub!\n`);
}