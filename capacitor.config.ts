import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.babylonianheron.app',
  appName: 'Babylonian Heron',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  ios: {
    scheme: 'BabylonianHeron',
    allowsLinkPreview: false,
    scrollEnabled: true,
    backgroundColor: '#000000',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#000000',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'LIGHT',
      backgroundColor: '#000000',
    },
  },
};

export default config;
