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
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('Navigating to CourtReserve...');
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for network activity to settle
    await page.waitForLoadState('networkidle').catch(() => {});

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

    // Wait 5 seconds for the scheduler table grid to render
    console.log('Waiting for court grid to load...');
    await page.waitForTimeout(5000);

    // Search page content for the target time and "Reserve" button
    const pageText = await page.innerText('body');
    const searchTime = TARGET_TIME.replace(/^0/, '').trim(); // "3:00 PM"
    const searchTimeNoSpace = searchTime.replace(/\s+/g, ''); // "3:00PM"

    const hasTimeText = pageText.includes(searchTime) || pageText.includes(searchTimeNoSpace);

    // Verify if "Reserve" appears near the time slot
    const isSlotAvailable = await page.evaluate(({ timeStr, timeNoSpace }) => {
      const elements = Array.from(document.querySelectorAll('tr, td, div, .k-scheduler-table tr'));
      return elements.some(el => {
        const txt = (el.innerText || '').toUpperCase();
        const matchesTime = txt.includes(timeStr.toUpperCase()) || txt.includes(timeNoSpace.toUpperCase());
        const matchesReserve = txt.includes('RESERVE') && !txt.includes('NONE AVAILABLE');
        return matchesTime && matchesReserve;
      });
    }, { timeStr: searchTime, timeNoSpace: searchTimeNoSpace });

    if (isSlotAvailable || (hasTimeText && pageText.toUpperCase().includes('RESERVE'))) {
      console.log(`✅ SUCCESS: Slot found for ${TARGET_TIME}! Sending alert email...`);
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: NOTIFY_EMAIL,
        subject: `🏓 Court Slot Available for ${TARGET_TIME}!`,
        html: `<p>A court slot opened up for <strong>${TARGET_TIME}</strong>!</p><p><a href="${TARGET_URL}">Click here to book on CourtReserve</a></p>`
      });
    } else {
      console.log(`❌ No open slots found for ${TARGET_TIME}.`);
      console.log('--- Page Preview Text ---');
      console.log(pageText.substring(0, 500)); // Log page content for debugging
    }

  } catch (error) {
    console.error('Error checking availability:', error);
  } finally {
    await browser.close();
  }
}

checkAvailability();
