const { execSync, spawn } = require('node:child_process');

function setWindowsUtf8CodePage() {
  if (process.platform !== 'win32') return;
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch (error) {
    // 忽略设置失败，保持默认编码
  }
}

function run() {
  setWindowsUtf8CodePage();
  const electronPath = require('electron');
  const args = process.argv.slice(2);
  const child = spawn(electronPath, ['.'].concat(args), {
    stdio: 'inherit',
    env: process.env,
    windowsHide: false
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

run();
