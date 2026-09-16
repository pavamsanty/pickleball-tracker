const { chromium } = require('playwright');
const nodemailer = require('nodemailer');

// Configuration
const TARGET_URL = 'https://app.courtreserve.com/Online/Reservations/Bookings/13206?sId=16955';
const TARGET_TIME = '03:00 PM'; // Time slot you are looking for
const NOTIFY_EMAIL = 'Santosh.pillai@outlook.com';

// Setup Email Transporter (e.g., Gmail App Password)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS // Gmail App Password
  }
});

async function checkAvailability() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('Navigating to CourtReserve...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

    // Handle Login if redirected to a login screen
    if (page.url().includes('Portal/Login')) {
      await page.fill('input[name="UserName"]', process.env.COURTRESERVE_USER);
      await page.fill('input[name="Password"]', process.env.COURTRESERVE_PASS);
      await page.click('button[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle' });
      await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
    }

    // Inspect available slots on the page grid
    const availableSlots = await page.$$eval('.k-scheduler-content .available-slot', slots =>
      slots.map(s => s.innerText.trim())
    );

    const isSlotAvailable = availableSlots.some(slot => slot.includes(TARGET_TIME));

    if (isSlotAvailable) {
      console.log(`Slot found for ${TARGET_TIME}! Sending email...`);
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: NOTIFY_EMAIL,
        subject: `🏓 Court Available for ${TARGET_TIME}!`,
        html: `<p>A court slot opened up for <strong>${TARGET_TIME}</strong>!</p><p><a href="${TARGET_URL}">Book Now on CourtReserve</a></p>`
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
