const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const backendDir = path.resolve(__dirname, "../backend");
const python =
  process.platform === "win32"
    ? path.join(backendDir, "venv", "Scripts", "python.exe")
    : path.join(backendDir, "venv", "bin", "python");

if (!fs.existsSync(python)) {
  console.error(`Python venv not found at: ${python}`);
  process.exit(1);
}

console.log(`Building backend with: ${python}`);
const result = spawnSync(
  python,
  ["-m", "PyInstaller", "--noconfirm", "build.spec"],
  {
    cwd: backendDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  }
);

process.exit(result.status ?? 1);
