const path = require('path')
const frontend = path.join(__dirname, '../frontend')

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require(path.join(frontend, 'tailwind.config.js'))],
  content: [
    path.join(frontend, 'index.html'),
    path.join(frontend, 'src/**/*.{js,ts,jsx,tsx}'),
  ],
}
