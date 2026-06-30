# Rent Agent

Automated maintenance and pest control request agent for RentCafe resident portals.

Text an SMS to submit maintenance requests or have pest control scheduled automatically every week.

## How It Works

1. **Browser automation** (Playwright) logs into your RentCafe portal and submits maintenance request forms
2. **SMS interface** (Twilio) lets you text requests like "leaky faucet in bathroom" and the agent handles the rest
3. **Weekly scheduler** automatically submits pest control requests on your chosen day/time
4. **Session persistence** — cookies are saved so you stay logged in between runs

## Setup

### Prerequisites

- Node.js 18+
- A Twilio account (for SMS — optional for CLI-only use)

### Install

```bash
npm install
npx playwright install chromium
```

### Configure

```bash
cp .env.example .env
# Edit .env with your details
```

Required:
- `RENTCAFE_EMAIL` — your RentCafe login email
- `RENTCAFE_URL` — your property's RentCafe login page URL

For SMS:
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `USER_PHONE_NUMBER` — your phone number

### First-Time Login

Run the interactive login to authenticate and save cookies:

```bash
npm run login
```

This opens a browser window where you:
1. Solve the Cloudflare captcha (if any)
2. Enter your email
3. Enter the verification code from your email

Cookies are saved for future use.

### Run the Agent

```bash
npm run dev
```

This starts:
- An Express server listening for Twilio SMS webhooks
- A cron scheduler for weekly pest control requests

### One-Shot Submission

Submit a request from the command line without starting the server:

```bash
npm run submit -- "leaky faucet in kitchen"
npm run submit -- "pest control"
```

## SMS Commands

| Message | Action |
|---------|--------|
| `leaky faucet in bathroom` | Creates a plumbing maintenance request |
| `pest control` | Submits a pest control request |
| `login` | Triggers re-authentication |
| `status` | Checks if agent is logged in |
| `help` | Shows available commands |
| `123456` (digits) | Supplies an OTP code during login |

## Architecture

```
User (SMS) → Twilio → Express Server → Handler
                                          ↓
                                    Playwright Browser → RentCafe Portal
                                          ↑
                                    Cron Scheduler (weekly pest control)
```

### Session Management

- Cookies are persisted to `browser-data/cookies.json`
- If the session expires, the agent texts you for a new verification code
- A keepalive can be added to prevent session timeout

## Configuration

| Env Variable | Description | Default |
|---|---|---|
| `RENTCAFE_URL` | Login page URL | Atlantic Palazzo Living |
| `RENTCAFE_EMAIL` | Your login email | — |
| `TWILIO_ACCOUNT_SID` | Twilio account SID | — |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | — |
| `TWILIO_PHONE_NUMBER` | Twilio phone number | — |
| `USER_PHONE_NUMBER` | Your phone number | — |
| `PORT` | Webhook server port | 3000 |
| `HEADLESS` | Run browser headless | false |
| `PEST_CONTROL_CRON` | Cron schedule for pest control | `0 9 * * 1` (Mon 9am) |
