const { chromium } = require('playwright');
const nodemailer = require('nodemailer');

const TARGET_URL = 'https://app.courtreserve.com/Online/Reservations/Bookings/13206?sId=16955';
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
  // Launch browser with realistic user arguments to bypass Cloudflare
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  // Create a context with realistic desktop browser headers and viewport
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles'
  });

  const page = await context.newPage();

  // Hide automation flags in navigator properties
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    console.log('Navigating to CourtReserve...');
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Allow Cloudflare challenge / JavaScript to resolve
    await page.waitForTimeout(6000);

    // Check if redirected to Login
    if (page.url().includes('Login') || page.url().includes('Account')) {
      console.log('Logging in to CourtReserve...');
      if (await page.$('input[name="UserName"]')) {
        await page.fill('input[name="UserName"]', process.env.COURTRESERVE_USER);
        await page.fill('input[name="Password"]', process.env.COURTRESERVE_PASS);
        await page.click('button[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {});
        await page.goto(TARGET_URL, { waitUntil: 'networkidle' }).catch(() => {});
      }
    }

    console.log('Waiting for court grid to load...');
    await page.waitForTimeout(5000);

    const pageText = await page.innerText('body');

    // Check if Cloudflare block page is rendered
    if (pageText.includes('you have been blocked') || pageText.includes('Attention Required! | Cloudflare')) {
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
        html: `<p>A court slot opened up for <strong>${TARGET_TIME}</strong>!</p><p><a href="${TARGET_URL}">Click here to book on CourtReserve</a></p>`
      });
    } else {
      console.log(`❌ No open slots found for ${TARGET_TIME}.`);
    }

  } catch (error) {
    console.error('Error checking availability:', error);
  } finally {
    await browser.close();
  }
}

checkAvailability();
