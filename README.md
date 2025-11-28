# Christmas Party Planner 2025

A festive web app for organizing your Christmas party with family RSVPs, food planning, and Yankee Swap!

## Party Details
- **Date:** December 13th, 2025
- **Location:** Tom & Erin's Place
- **Time:** Arrive by 6 PM
- **Yankee Swap:** $20 gift limit, kids & adults play together!

## Features
- Track families and their confirmation status (Invited, Confirmed, Maybe, Not Coming)
- Add/remove family members for each family
- Automatic guest count for confirmed attendees
- Food planner to coordinate what each family is bringing
- No authentication needed - simple and open editing
- Christmas-themed design with animated snowflakes
- Data stored in simple JSON files for easy server-side editing

## Local Development Setup

### Prerequisites
- Node.js installed on your machine

### Installation
1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open your browser to:
   ```
   http://localhost:3000
   ```

That's it! The app will create a `data/` directory automatically and store:
- `data/families.json` - Family and member information
- `data/food.json` - Food items each family is bringing

## Production Deployment (nginx)

### Setup on Your nginx Server

1. **Upload the project files** to your server

2. **Install Node.js dependencies** on the server:
   ```bash
   cd /path/to/xmasParty
   npm install
   ```

3. **Configure nginx** to serve static files and proxy API calls:
   - See `nginx.conf.example` for the configuration
   - Update the paths and domain name
   - Copy to `/etc/nginx/sites-available/` and enable it
   - Test and reload nginx

4. **Start the Node.js backend** (use port 3001 for production):
   ```bash
   PORT=3001 node server.js
   ```

   **Recommended:** Use a process manager like `pm2` to keep it running:
   ```bash
   npm install -g pm2
   pm2 start server.js --name xmasparty-api -- PORT=3001
   pm2 save
   pm2 startup  # Follow the instructions to enable on boot
   ```

### How It Works

**Local Development:**
- Node.js serves both static files AND handles API requests
- Everything runs on one port (3000)

**Production (nginx):**
- nginx serves the static files (HTML, CSS, JS) from the `public/` directory
- nginx proxies `/api/*` requests to the Node.js backend on port 3001
- Node.js only handles API operations (reading/writing JSON files)

## Data Storage

All data is stored in JSON files in the `data/` directory:

### families.json
```json
[
  {
    "id": "1234567890",
    "name": "The Smiths",
    "status": "confirmed",
    "members": [
      { "id": "1234567891", "name": "John" },
      { "id": "1234567892", "name": "Jane" }
    ]
  }
]
```

### food.json
```json
[
  {
    "id": "1234567893",
    "familyId": "1234567890",
    "item": "Turkey"
  }
]
```

You can manually edit these files on the server if needed. The app will pick up changes on the next API call.

## Project Structure

```
xmasParty/
├── server.js           # Express server (serves static files + API)
├── package.json        # Node.js dependencies
├── nginx.conf.example  # Example nginx configuration
├── public/             # Static files served to browser
│   ├── index.html      # Main HTML page
│   ├── style.css       # Christmas-themed styles
│   └── app.js          # Frontend JavaScript
└── data/               # JSON data storage (auto-created)
    ├── families.json
    └── food.json
```

## Troubleshooting

### Local Development Issues

**Port already in use:**
```bash
PORT=3001 npm start
```

**Can't connect to API:**
- Make sure the server is running
- Check the browser console for errors

### Production Issues

**nginx 502 Bad Gateway:**
- Make sure the Node.js backend is running on port 3001
- Check: `pm2 status` or `ps aux | grep node`

**API calls not working:**
- Verify nginx is proxying `/api/` correctly
- Check nginx error logs: `sudo tail -f /var/log/nginx/error.log`
- Check Node.js logs: `pm2 logs xmasparty-api`

**Static files not loading:**
- Verify the path in nginx config points to the `public/` directory
- Check nginx access logs: `sudo tail -f /var/log/nginx/access.log`

## Security Note

This app has no authentication by design - anyone with the URL can edit the data. This is fine for a small, trusted group. If you need to restrict access:
- Use nginx basic auth
- Put the site behind a VPN
- Add a simple password in the frontend

Enjoy your Christmas party planning! 🎄
