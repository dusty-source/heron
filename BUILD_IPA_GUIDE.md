# Babylonian Heron - Build IPA Guide

## Overview

This is a React web app wrapped as a native iOS app using **Capacitor** (by Ionic). The web assets are embedded in a native WKWebView container, allowing offline use.

---

## Prerequisites

### Required (Mac Only)
- **macOS** (MacBook, iMac, or Mac Mini)
- **Xcode** (free from Mac App Store)
- **Node.js** 18+ and npm
- **CocoaPods** (`sudo gem install cocoapods`)

### For Sideloading (No App Store)
- **Apple ID** (free tier works for personal use, 7-day re-sign)
- OR **Apple Developer Account** ($99/year for permanent signing)
- **AltStore**, **Sideloadly**, or **Xcode** for installation

---

## Method 1: Build IPA with Xcode (Recommended)

### Step 1: Extract the ZIP
```bash
unzip babylonian-heron-app.zip
cd babylonian-heron-app
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Build Web Assets
```bash
npm run build
```

### Step 4: Sync to iOS
```bash
npx cap sync ios
```

### Step 5: Open in Xcode
```bash
npx cap open ios
```

### Step 6: Configure Signing in Xcode
1. In Xcode, select the **App** target
2. Go to **Signing & Capabilities** tab
3. Check **Automatically manage signing**
4. Select your **Team** (your Apple ID)
5. Change **Bundle Identifier** if needed (e.g., `com.yourname.babylonianheron`)

### Step 7: Build & Run
- Connect your iPhone 15 Pro via USB
- Select your iPhone as the target device (top toolbar)
- Press **Cmd+R** or click the Play button
- Xcode will build, sign, and install the app on your phone

### Step 8: Export IPA (for sharing/sideloading)
1. In Xcode, select **Any iOS Device (arm64)** as target
2. Go to **Product > Archive**
3. In Organizer, click **Distribute App**
4. Select **Ad Hoc** or **Development**
5. Choose your signing certificate
6. Export the `.ipa` file

---

## Method 2: Sideload IPA (No Mac Required)

If someone else builds the IPA for you, install it using:

### Option A: AltStore (Free, requires refresh every 7 days)
1. Install AltStore on your Mac/PC from altstore.io
2. Install AltStore app on your iPhone
3. Connect iPhone to computer
4. In AltStore, tap **+** and select the `.ipa` file

### Option B: Sideloadly (Free, requires refresh every 7 days)
1. Download Sideloadly from sideloadly.io
2. Connect iPhone to computer
3. Drag the `.ipa` into Sideloadly
4. Enter your Apple ID
5. Click **Start**

### Option C: TrollStore (Permanent, requires specific iOS version)
- Only works on iOS 14.0 - 16.6.1 or 17.0
- Permanent installation, no re-signing needed
- Search for TrollStore guides for your iOS version

---

## Method 3: Use Online Build Service (No Mac)

### Ionic Appflow (Paid)
1. Upload code to GitHub
2. Connect to Ionic Appflow
3. Build iOS binary in cloud
4. Download IPA

### GitHub Actions + macOS Runner (Free tier available)
A `.github/workflows/build-ios.yml` can be added to auto-build IPA on GitHub's macOS runners.

---

## Project Structure

```
babylonian-heron-app/
├── dist/                  # Built web assets (embedded in app)
├── ios/                   # Native iOS Xcode project
│   └── App/
│       ├── App.xcodeproj  # Open this in Xcode
│       └── App/
│           └── public/    # Web assets copied here
├── src/                   # React source code
├── public/                # Static assets (icons, manifest)
├── capacitor.config.ts    # Capacitor configuration
├── package.json           # Dependencies
└── vite.config.ts         # Build config
```

---

## Troubleshooting

### "CocoaPods not installed"
```bash
sudo gem install cocoapods
```

### "No signing certificate"
- Open Xcode > Preferences > Accounts
- Add your Apple ID
- Download manual profiles

### "App won't open after install"
- iOS Settings > General > VPN & Device Management
- Trust the developer certificate

### "White screen on launch"
- Ensure `npm run build` completed successfully
- Run `npx cap sync ios` again
- Check Console app for errors

---

## Rebuilding After Code Changes

```bash
# After modifying React code:
npm run build
npx cap sync ios

# Then rebuild in Xcode (Cmd+R)
```

---

## App Features

- **Offline Ready**: All data is embedded, works without internet
- **Native Feel**: WKWebView with iOS gestures, scroll bounce, safe areas
- **Dark Theme**: Optimized for OLED displays
- **3 Tabs**: Overview, Details, Debt
- **10 Months Data**: June through March
- **Interactive Charts**: Area charts, pie charts, progress bars
- **Smooth Animations**: Framer Motion spring physics
