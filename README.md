# Offishall Stores — Express backend

## Setup

```bash
cd backend
npm install
npm start
```

Open **http://127.0.0.1:5502/signin.html** (the server also serves your HTML/CSS/JS).

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/signup` | Register (sends OTP) |
| POST | `/api/verify` | Verify OTP |
| POST | `/api/signin` | Sign in |
| GET | `/api/dev/otp?email=` | Dev only — current OTP |

## Email (optional)

Create `backend/.env`:

```
EMAIL_USER=your@gmail.com
EMAIL_PASS=your-app-password
PORT=5502
```

Without email config, dev mode returns `testOtp` in the signup response.

## Port

Default is **5502** (set in `backend/.env` or `PORT` env var). Open the site on that same port so the frontend hits `/api` on the same origin.
