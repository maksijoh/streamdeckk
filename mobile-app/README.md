# DeckRemote phone client

Expo SDK 57, TypeScript, Android/iOS. Expo requires Node 22.13 or later; Node 24 is used for the dependency-free test runner.

```sh
npm ci
npm test
npm run typecheck
npm run lint
npx expo install --check
npx expo prebuild --platform android --no-install
npm run android
```

For iOS, use `npm run ios` on a Mac with Xcode. Native builds require the platform toolchain and a connected device/emulator. Physical devices are required for camera acceptance. Development signing/build setup is local; no EAS account is required for local builds.

Expo Go supports SDK 57 and can load the JavaScript app. Use a standalone native build for acceptance and release: Expo Go cannot apply this app's native configuration, Android redirect protection, or opening-handshake timeout. No navigation or external state library is needed for the single screen: scanning temporarily replaces the deck.

Start the PC service, request its pairing QR, and scan it in the phone app. Enable Camera and Local Network permissions when prompted. Both devices must be on the same trusted Wi-Fi. The app saves only the normalized endpoint in AsyncStorage, and saves the secret in SecureStore. The deck remains disabled until the first valid server configuration arrives. Unknown action outcomes are never replayed automatically.

## Native transport limitations and release checks

- The MVP uses cleartext `ws` on a trusted LAN. Android requires `usesCleartextTraffic=true` for dynamic numeric IP endpoints; Android network-security XML cannot allowlist private CIDRs. Every connection is constrained in application code to the protocol's private/link-local IPv4 ranges. There are no remote URL inputs or WebViews.
- iOS uses `NSAllowsLocalNetworking` and `NSLocalNetworkUsageDescription`; no global arbitrary-load exception is configured. Actual numeric-IP WebSocket permission/ATS behavior must be proven on the target iOS version before signoff.
- `plugins/withNoWebSocketRedirects.cjs` changes the generated Kotlin `MainApplication` before React Native starts. It disables HTTP and HTTPS redirect following only for RN WebSockets and sets a 20-second opening-handshake call timeout, before the JS client's 25-second retry deadline. RN Android does not register its socket until `onOpen`, so JS cannot cancel an earlier stalled handshake. The native timeout bounds that outstanding work. With pinned OkHttp 4.9.2, a successful upgrade invokes [`Exchange.newWebSocketStreams()`](https://github.com/square/okhttp/blob/parent-4.9.2/okhttp/src/main/kotlin/okhttp3/internal/connection/Exchange.kt), which calls [`RealCall.timeoutEarlyExit()`](https://github.com/square/okhttp/blob/parent-4.9.2/okhttp/src/main/kotlin/okhttp3/internal/connection/RealCall.kt); the timeout ends before the established WebSocket runs. RN's unlimited read timeout is unchanged. The plugin fails prebuild if the expected insertion point changes and upgrades the previous redirect-only hook without duplicating it. Expo Go does not include this patch.
- Before release, test the **standalone native binary** on each platform against a controlled LAN listener returning 301/302/303/307/308 to a second listener, with a disposable token. Verify zero connections to that second listener, then verify a normal 101 WebSocket upgrade as a positive control. Do not log actual pairing URLs/tokens. iOS redirect behavior is not yet verified.
- Android handshake acceptance: use a listener that accepts TCP and never completes HTTP upgrade, then one that sends only partial HTTP headers. Verify native sockets close around 20 seconds and repeated reconnects do not accumulate live handshakes. Repeat after scanning a new PC, explicit disconnect, and backgrounding; cancellation before upgrade may take up to that native deadline. The JS client retains only a close handler on an abandoned socket's late `onOpen`, so a handshake that succeeds before the deadline is closed rather than orphaned; test a delayed 101 response after cancellation as well. As a positive control, keep a valid configured connection with heartbeat responses alive for several minutes and verify it is not closed at 20 seconds. These native tests remain unrun; source inspection and generated Kotlin checks are not device proof. Recheck early-timeout-exit semantics when upgrading RN/OkHttp.
- Native receive-allocation risk remains: the 65,536-byte message limit is enforced in JavaScript after the native WebSocket implementation has assembled the message. It does not cap native allocation for a malicious oversized or fragmented message. No native receive-allocation limit is configured; retain this as a release risk and test it on the target devices before broader network use.
- Phone camera, screen rotation/safe areas, denied permissions, Wi-Fi loss/recovery, PC restart, token regeneration, two phones, and real launch/hotkey OS effects require physical end-to-end acceptance. Unit tests and Metro export do not prove those behaviors.

API references: [Expo Camera SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/camera/), [SecureStore](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/), [Crypto UUID](https://docs.expo.dev/versions/v57.0.0/sdk/crypto/), [Android network security](https://developer.android.com/privacy-and-security/security-config).
