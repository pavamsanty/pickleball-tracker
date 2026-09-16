const { chromium } = require('playwright');
const nodemailer = require('nodemailer');

const TARGET_TIME = '3:00 PM'; 
const NOTIFY_EMAIL = process.env.EMAIL_USER;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function checkAvailability() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles'
  });

  const page = await context.newPage();

  // Remove automation flags
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    // 1. Navigate to main portal login URL
    console.log('1. Navigating to https://app.courtreserve.com...');
    await page.goto('https://app.courtreserve.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // 2. Perform Login if login fields are present
    const usernameInput = await page.$('input[name="UserName"], input[name="Email"], input[type="email"]');
    if (usernameInput) {
      console.log('2. Logging in with credentials...');
      await usernameInput.fill(process.env.COURTRESERVE_USER);
      
      const passwordInput = await page.$('input[name="Password"], input[type="password"]');
      if (passwordInput) {
        await passwordInput.fill(process.env.COURTRESERVE_PASS);
      }

      const loginBtn = await page.$('button[type="submit"], input[type="submit"], .btn-primary');
      if (loginBtn) {
        await loginBtn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {});
      }
    }

    await page.waitForTimeout(4000);

    // 3. Open the "Reservations" navigation dropdown menu
    console.log('3. Clicking on "Reservations" menu...');
    const reservationsMenu = page.locator('a, button, span').filter({ hasText: /^Reservations/i }).first();
    await reservationsMenu.waitFor({ state: 'visible', timeout: 15000 });
    await reservationsMenu.click();
    await page.waitForTimeout(1000);

    // 4. Click on "Pickleball Court Reservations"
    console.log('4. Clicking on "Pickleball Court Reservations"...');
    const pickleballOption = page.locator('a, span, li').filter({ hasText: /^Pickleball Court Reservations/i }).first();
    await pickleballOption.waitFor({ state: 'visible', timeout: 10000 });
    await pickleballOption.click();
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(4000);

    // 5. Click on the "TODAY" button on the grid header
    console.log('5. Clicking on "TODAY" button...');
    const todayBtn = page.locator('button, a, div').filter({ hasText: /^TODAY$/i }).first();
    if (await todayBtn.isVisible()) {
      await todayBtn.click();
      await page.waitForTimeout(3000);
    }

    // 6. Inspect the grid for open slots at target time
    console.log(`6. Checking availability for ${TARGET_TIME}...`);
    const pageText = await page.innerText('body');

    if (pageText.includes('you have been blocked') || pageText.includes('Attention Required!')) {
      console.error('❌ Cloudflare anti-bot trigger detected.');
      return;
    }

    const searchTime = TARGET_TIME.replace(/^0/, '').trim(); 
    const searchTimeNoSpace = searchTime.replace(/\s+/g, '');

    const isSlotAvailable = await page.evaluate(({ timeStr, timeNoSpace }) => {
      const elements = Array.from(document.querySelectorAll('tr, td, div, .k-scheduler-table tr'));
      return elements.some(el => {
        const txt = (el.innerText || '').toUpperCase();
        const matchesTime = txt.includes(timeStr.toUpperCase()) || txt.includes(timeNoSpace.toUpperCase());
        const matchesReserve = txt.includes('RESERVE') && !txt.includes('NONE AVAILABLE');
        return matchesTime && matchesReserve;
      });
    }, { timeStr: searchTime, timeNoSpace: searchTimeNoSpace });

    if (isSlotAvailable) {
      console.log(`✅ SUCCESS: Slot found for ${TARGET_TIME}! Sending alert email...`);
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: NOTIFY_EMAIL,
        subject: `🏓 Court Slot Available for ${TARGET_TIME}!`,
        html: `<p>A court slot opened up for <strong>${TARGET_TIME}</strong>!</p><p><a href="${page.url()}">Click here to book on CourtReserve</a></p>`
      });
    } else {
      console.log(`❌ No open slots found for ${TARGET_TIME}.`);
    }

  } catch (error) {
    console.error('Error during automated navigation:', error);
  } finally {
    await browser.close();
  }
}

checkAvailability();
