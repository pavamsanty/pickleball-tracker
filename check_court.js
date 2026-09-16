const { chromium } = require('playwright');
const nodemailer = require('nodemailer');

const TARGET_URL = 'https://app.courtreserve.com/Online/Reservations/Bookings/13206?sId=16955';
const TARGET_TIME = '3:00 PM'; // Use format without leading zero
const NOTIFY_EMAIL = process.env.EMAIL_USER;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function checkAvailability() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('Navigating to CourtReserve...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

    // Handle Login if redirected
    if (page.url().includes('Portal/Login') || page.url().includes('Account/Login')) {
      console.log('Logging in...');
      await page.fill('input[name="UserName"]', process.env.COURTRESERVE_USER);
      await page.fill('input[name="Password"]', process.env.COURTRESERVE_PASS);
      await page.click('button[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle' });
      await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
    }

    // Wait explicitly for the reservation grid/table to render
    await page.waitForSelector('body', { timeout: 10000 });
    await page.waitForTimeout(3000); // Wait 3 seconds for dynamic slots to load

    // Normalize target time (e.g. "03:00 PM" -> "3:00 PM")
    const searchTimeNormalized = TARGET_TIME.replace(/^0/, '').trim().toUpperCase();

    // Check row text and ensure "Reserve" is visible on the same row
    const isSlotAvailable = await page.evaluate((searchTime) => {
      const rows = Array.from(document.querySelectorAll('tr, div, .k-scheduler-table tr'));
      return rows.some(row => {
        const text = row.innerText || '';
        // Row must contain time (e.g., "3:00 PM") AND the "Reserve" button/link
        return text.toUpperCase().includes(searchTime) && text.toLowerCase().includes('reserve');
      });
    }, searchTimeNormalized);

    if (isSlotAvailable) {
      console.log(`Slot found for ${TARGET_TIME}! Sending alert email...`);
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: NOTIFY_EMAIL,
        subject: `🏓 Court Slot Available for ${TARGET_TIME}!`,
        html: `<p>A court slot opened up for <strong>${TARGET_TIME}</strong>!</p><p><a href="${TARGET_URL}">Click here to book on CourtReserve</a></p>`
      });
    } else {
      console.log(`No open slots found for ${TARGET_TIME}.`);
    }

  } catch (error) {
    console.error('Error checking availability:', error);
  } finally {
    await browser.close();
  }
}

checkAvailability();
