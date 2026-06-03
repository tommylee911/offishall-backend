require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 5502;

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);
app.use(cors({ origin: true }));
app.use(express.json());

app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
  })
);

const users = new Map();
const otps = new Map();

let transporter;
let transportKind = 'json';

function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function isGmailConfigured() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  return Boolean(
    user &&
      pass &&
      user !== 'your-email@gmail.com' &&
      pass !== 'your-app-password'
  );
}

async function createEtherealTransporter() {
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass }
  });
}

async function initTransporter() {
  if (isGmailConfigured()) {
    const t = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    try {
      await t.verify();
      transporter = t;
      transportKind = 'gmail';
      console.log('SMTP ready (Gmail).');
      return;
    } catch (err) {
      console.error('Gmail failed, trying Ethereal:', err.message);
    }
  }
  try {
    transporter = await createEtherealTransporter();
    transportKind = 'ethereal';
    console.log('Using Ethereal test mail.');
  } catch (err) {
    console.error('Ethereal failed, OTP logged only:', err.message);
    transportKind = 'json';
  }
}

function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

const isDevLike = process.env.NODE_ENV !== 'production';

async function sendOTPEmail(email, otp) {
  if (transportKind === 'json') {
    console.log(`[OTP] ${email}: ${otp}`);
    return { ok: false };
  }

  const fromAddr =
    process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@offishall.local';

  try {
    const info = await transporter.sendMail({
      from: fromAddr,
      to: email,
      subject: 'Your verification code — Offishall Stores',
      html: `
        <h2>Offishall Stores</h2>
        <p>Your verification code:</p>
        <p style="font-size:24px;font-weight:bold;letter-spacing:4px">${otp}</p>
        <p>Expires in 10 minutes.</p>
      `
    });
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) console.log('Preview:', preview);
    return { ok: true, previewUrl: preview || null };
  } catch (err) {
    console.error('Email error:', err.message);
    return { ok: false };
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/signup', async (req, res) => {
  const username = req.body.username;
  const email = normalizeEmail(req.body.email);
  const password = req.body.password;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const existing = users.get(email);
  if (existing?.verified) {
    return res.status(400).json({ error: 'User already exists. Please sign in.' });
  }

  const otp = generateOTP();
  const expiresAt = Date.now() + 10 * 60 * 1000;

  users.set(email, {
    username,
    password,
    verified: false
  });
  otps.set(email, { otp, expiresAt });

  const sendResult = await sendOTPEmail(email, otp);

  if (!sendResult.ok) {
    return res.json({
      message: 'Account created. Use the code below to verify.',
      emailSent: false,
      testOtp: otp,
      testMode: true
    });
  }

  res.json({
    message: 'Check your email for the verification code.',
    emailSent: true,
    testOtp: isDevLike ? otp : undefined,
    testMode: isDevLike
  });
});

app.post('/api/verify', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || '').trim();

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and code are required' });
  }

  const stored = otps.get(email);
  if (!stored) {
    return res.status(400).json({ error: 'No verification code found' });
  }
  if (Date.now() > stored.expiresAt) {
    otps.delete(email);
    return res.status(400).json({ error: 'Verification code expired' });
  }
  if (stored.otp !== otp) {
    return res.status(400).json({ error: 'Invalid verification code' });
  }

  const user = users.get(email);
  if (user) user.verified = true;
  otps.delete(email);

  res.json({ message: 'Account verified successfully' });
});

app.get('/api/dev/otp', (req, res) => {
  if (!isDevLike) return res.status(404).json({ error: 'Not found' });

  const email = normalizeEmail(req.query.email);
  const stored = otps.get(email);
  if (!stored) return res.status(404).json({ error: 'No code found' });
  if (Date.now() > stored.expiresAt) {
    otps.delete(email);
    return res.status(400).json({ error: 'Code expired' });
  }
  res.json({ otp: stored.otp });
});

app.post('/api/signin', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = users.get(email);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!user.verified) {
    return res.status(403).json({ error: 'Account not verified' });
  }

  res.json({
    message: 'Sign in successful',
    user: { username: user.username, email }
  });
});

app.use(express.static(path.join(__dirname, '..')));

async function start() {
  await initTransporter();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server: http://127.0.0.1:${PORT}`);
    console.log(`Sign in: http://127.0.0.1:${PORT}/signin.html`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
