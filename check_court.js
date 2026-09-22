const { chromium } = require('playwright');
const nodemailer = require('nodemailer');

const BOOKING_URL = 'https://app.courtreserve.com/Online/Reservations/Bookings/13206?sId=16955';
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

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    console.log(`1. Navigating to ${BOOKING_URL}...`);
    await page.goto(BOOKING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    if (page.url().includes('Login') || page.url().includes('Account')) {
      console.log('2. Redirected to login page. Entering credentials...');
      const usernameInput = await page.waitForSelector('input[name="UserName"], input[name="Email"], input[type="email"]', { timeout: 10000 });
      if (usernameInput) {
        await usernameInput.fill(process.env.COURTRESERVE_USER);
        
        const passwordInput = await page.$('input[name="Password"], input[type="password"]');
        if (passwordInput) {
          await passwordInput.fill(process.env.COURTRESERVE_PASS);
        }

        const loginBtn = await page.$('button[type="submit"], input[type="submit"], .btn-primary');
        if (loginBtn) {
          await loginBtn.click();
          await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
        }
      }
    }

    if (!page.url().includes('13206')) {
      console.log('3. Navigating to Pickleball Court Reservation grid...');
      await page.goto(BOOKING_URL, { waitUntil: 'domcontentloaded' });
    }

    await page.waitForTimeout(4000);

    console.log('4. Looking for TODAY button...');
    const todayBtn = page.locator('button, a, div').filter({ hasText: /^TODAY$/i }).first();
    if (await todayBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('Clicking TODAY button...');
      await todayBtn.click();
      await page.waitForTimeout(3000);
    }

    console.log(`5. Inspecting schedule for ${TARGET_TIME}...`);
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
