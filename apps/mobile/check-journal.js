const { chromium } = require('playwright');
const { spawn } = require('child_process');
async function runTest() {
  const server = spawn('npx', ['serve', 'dist', '-l', '8081']);
  await new Promise(r => setTimeout(r, 2000));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  await page.goto('http://localhost:8081/');
  await page.waitForTimeout(5000);
  await browser.close();
  server.kill();
}
runTest();
