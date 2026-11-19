import { chromium } from 'playwright-core';

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=d3d11', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  
  // Connect to preview server or dev server
  await page.goto('http://127.0.0.1:4178/?qa=1');
  await page.waitForFunction(() => window.__qa && window.__qa.ready);
  
  await page.evaluate(() => window.__qa.startSiege(true));
  await page.waitForTimeout(500);
  
  console.log('Player initial pos:', await page.evaluate(() => window.__qa.state().pos));
  console.log('Rover initial info:', await page.evaluate(() => window.__qa.rover()));
  
  // Try goTo rover
  const res = await page.evaluate(() => {
    window.__qa.goTo('rover', 1.8);
    return {
      pos: window.__qa.state().pos,
      rover: window.__qa.rover(),
    };
  });
  console.log('After goTo rover:', res);
  
  await page.waitForTimeout(400);
  
  const focusedCheck = await page.evaluate(() => {
    return {
      prompt: document.querySelector('.interact-prompt, .prompt, .hud-prompt')?.textContent,
      driving: window.__qa.rover().driving,
    };
  });
  console.log('Focused check:', focusedCheck);
  
  // Press KeyE
  await page.evaluate(() => window.__qa.key('KeyE', 250));
  await page.waitForTimeout(700);
  
  const drivingAfter = await page.evaluate(() => window.__qa.rover());
  console.log('Rover after KeyE:', drivingAfter);
  
  await browser.close();
}

main().catch(console.error);
