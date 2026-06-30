# Rent Agent

Automated maintenance and pest control request agent for RentCafe resident portals.

Text an SMS to submit maintenance requests or have pest control scheduled automatically every week.

## How It Works

1. **Browserbase** cloud browser handles Cloudflare challenges and persists cookies across sessions
2. **Playwright** automates the RentCafe portal (login, form submission)
3. **Twilio SMS** lets you text requests like "leaky faucet in bathroom"
4. **Cron scheduler** auto-submits pest control requests weekly

## Setup

### Prerequisites

- Node.js 18+
- [Browserbase](https://browserbase.com) account (API key + project ID)
- Twilio account (for SMS — optional for CLI-only use)

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
# Edit .env with your details
```

Required:
- `RENTCAFE_EMAIL` — your RentCafe login email
- `BROWSERBASE_API_KEY` — from [Browserbase dashboard](https://browserbase.com)
- `BROWSERBASE_PROJECT_ID` — your Browserbase project ID

For SMS:
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `USER_PHONE_NUMBER` — your phone number

### First-Time Login

```bash
npm run login
```

This creates a Browserbase session that:
1. Automatically solves Cloudflare captchas
2. Navigates to RentCafe and fills your email
3. Prompts you for the OTP code from your email
4. Saves cookies via Browserbase persistent context

### Run the Agent

```bash
npm run dev
```

Starts:
- Express server for Twilio SMS webhooks
- Cron scheduler for weekly pest control

### CLI Submission

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
| `123456` (digits) | Supplies OTP code during login |

## Architecture

```
User (SMS) → Twilio → Express Server → Handler
                                          ↓
                                    Playwright → Browserbase (cloud) → RentCafe
                                          ↑
                                    Cron Scheduler (weekly pest control)
```

### Why Browserbase?

RentCafe uses Cloudflare Turnstile which blocks automated browsers. Browserbase provides:
- **Captcha solving** — automatically handles Cloudflare challenges
- **Persistent contexts** — cookies survive across sessions (no re-login needed)
- **Stealth browsing** — residential fingerprints that bypass bot detection
- **Session replay** — debug automation via recorded browser sessions

## Configuration

| Env Variable | Description | Default |
|---|---|---|
| `RENTCAFE_URL` | Login page URL | Atlantic Palazzo Living |
| `RENTCAFE_EMAIL` | Your login email | — |
| `BROWSERBASE_API_KEY` | Browserbase API key | — |
| `BROWSERBASE_PROJECT_ID` | Browserbase project ID | — |
| `BROWSERBASE_CONTEXT_ID` | Context ID for cookie persistence | `rentcafe-session` |
| `TWILIO_ACCOUNT_SID` | Twilio account SID | — |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | — |
| `TWILIO_PHONE_NUMBER` | Twilio phone number | — |
| `USER_PHONE_NUMBER` | Your phone number | — |
| `PORT` | Webhook server port | `3000` |
| `PEST_CONTROL_CRON` | Cron schedule for pest control | `0 9 * * 1` (Mon 9am) |
