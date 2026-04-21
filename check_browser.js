const puppeteer = require('puppeteer');

(async () => {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  
  page.on('pageerror', err => {
    errors.push(err.toString());
  });

  console.log('Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  
  console.log('Waiting a bit for dynamic content...');
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('--- CONSOLE ERRORS ---');
  if (errors.length === 0) {
    console.log('No errors found!');
  } else {
    errors.forEach(e => console.log(e));
  }
  console.log('----------------------');

  await browser.close();
})();
