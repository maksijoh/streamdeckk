import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  type LayoutChangeEvent,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { BlurTargetView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Feather from '@expo/vector-icons/Feather';
import { DeckClient, type ClientState } from './src/client';
import { parseQr, type Pairing } from './src/protocol';
import { clearToken, loadPairing, savePairing } from './src/storage';
import {
  DEFAULT_APPEARANCE,
  type AppearancePreferences,
  loadAppearance,
  paletteFor,
  saveAppearance,
  withAlpha,
} from './src/appearance';
import { AppearanceSettings } from './src/components/AppearanceSettings';
import { DeckGrid } from './src/components/DeckGrid';
import { GlassBlurProvider, GlassControl, GlassSurface } from './src/components/GlassSurface';

function AmbientBackground({ appearance }: { appearance: AppearancePreferences }) {
  const palette = paletteFor(appearance);
  const dark = palette.theme === 'dark';
  return <LinearGradient
    pointerEvents="none"
    colors={[
      palette.background,
      withAlpha(palette.accent, dark ? 0.16 : 0.22),
      palette.background,
    ]}
    locations={[0, 0.48, 1]}
    start={{ x: 0.08, y: 0 }}
    end={{ x: 0.9, y: 1 }}
    style={StyleSheet.absoluteFill}
  >
    <View style={[styles.ambientTop, { backgroundColor: withAlpha(palette.accent, dark ? 0.12 : 0.14) }]} />
    <View style={[styles.ambientSide, { backgroundColor: withAlpha(palette.buttonHighlight, dark ? 0.07 : 0.18) }]} />
    <View style={[styles.ambientBottom, { backgroundColor: withAlpha(palette.glass, dark ? 0.18 : 0.34) }]} />
  </LinearGradient>;
}

function DeckRemote() {
  const [state, setState] = useState<ClientState>({ status: 'disconnected', buttons: [], notice: '', pending: 0 });
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [connectionReady, setConnectionReady] = useState(false);
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [appearance, setAppearance] = useState<AppearancePreferences>(DEFAULT_APPEARANCE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [appearanceError, setAppearanceError] = useState('');
  const [deckViewport, setDeckViewport] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const client = useRef<DeckClient | null>(null);
  const scanLock = useRef(false);
  const mounted = useRef(false);
  const ambientBlurTarget = useRef<View | null>(null);
  const sceneBlurTarget = useRef<View | null>(null);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const palette = useMemo(() => paletteFor(appearance), [appearance]);
  const ready = connectionReady && appearanceReady;

  useEffect(() => {
    let alive = true;
    void loadAppearance()
      .then(saved => { if (alive) setAppearance(saved); })
      .catch(() => { if (alive) setAppearanceError('Appearance could not be restored. Theme defaults are active.'); })
      .finally(() => { if (alive) setAppearanceReady(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    mounted.current = true;
    const connection = new DeckClient(next => { if (alive) setState(next); }, () => {
      setPairing(null);
      setScanning(true);
      scanLock.current = false;
      void clearToken().catch(() => { if (mounted.current) setError('Could not clear the expired pairing. Restart the app and scan again.'); });
    }, { uuid: randomUUID });
    client.current = connection;
    connection.setActive(AppState.currentState === 'active');
    void loadPairing().then(saved => {
      if (!alive) return;
      setPairing(saved);
      if (saved) connection.connect(saved);
      else setScanning(true);
    }).catch(() => {
      if (alive) { setError('Could not restore pairing. Scan a new QR from the PC.'); setScanning(true); }
    }).finally(() => { if (alive) setConnectionReady(true); });
    const subscription = AppState.addEventListener('change', value => {
      const foreground = value === 'active';
      setActive(foreground);
      connection.setActive(foreground);
      if (foreground) void getPermission().catch(() => setError('Camera permission could not be checked. Try again.'));
    });
    return () => { alive = false; mounted.current = false; subscription.remove(); connection.disconnect(); client.current = null; };
  }, [getPermission]);

  async function scanned(data: string) {
    if (scanLock.current || busy || !active) return;
    scanLock.current = true;
    let next: Pairing;
    try { next = parseQr(data); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Invalid QR. Scan again.'); return; }
    setBusy(true);
    client.current?.disconnect();
    try {
      await savePairing(next);
      if (!mounted.current) return;
      setPairing(next);
      setScanning(false);
      setError('');
      client.current?.connect(next);
    } catch { if (mounted.current) setError('Could not save pairing securely. Retry the scan.'); }
    finally { if (mounted.current) setBusy(false); }
  }

  const updateAppearance = (next: AppearancePreferences) => {
    setAppearance(next);
    setAppearanceError('');
    void saveAppearance(next).catch(() => {
      if (mounted.current) setAppearanceError('Appearance changed, but could not be saved on this device.');
    });
  };
  const retryScan = () => { scanLock.current = false; setError(''); };
  const scanNew = () => { client.current?.disconnect(); retryScan(); setScanning(true); };
  const pressButton = useCallback((buttonId: string) => client.current?.press(buttonId), []);
  const measureDeck = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout;
    setDeckViewport(current => current.width === next.width && current.height === next.height
      ? current
      : { width: next.width, height: next.height });
  }, []);
  const connected = state.status === 'connected' && !scanning && active;
  const status = scanning ? 'Pair a computer' : state.status === 'connected' ? 'Connected' : state.status === 'connecting' ? 'Connecting' : state.status === 'error' ? 'Needs attention' : 'Disconnected';
  const statusColor = scanning || state.status === 'connecting' ? palette.buttonHighlight : state.status === 'connected' ? palette.success : state.status === 'error' ? palette.danger : palette.muted;
  const statusIcon = scanning ? 'camera' : state.status === 'connected' ? 'wifi' : state.status === 'connecting' ? 'loader' : state.status === 'error' ? 'alert-circle' : 'wifi-off';

  if (!ready) return <View style={[styles.center, { backgroundColor: palette.background }]}>
    <AmbientBackground appearance={appearance} />
    <ActivityIndicator color={palette.accent} />
    <Text style={[styles.body, { color: palette.muted }]}>Restoring your deck…</Text>
  </View>;

  return <View style={[styles.screen, { backgroundColor: palette.background }]}>
    <StatusBar barStyle={palette.theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
    <BlurTargetView
      ref={sceneBlurTarget}
      style={styles.scene}
      accessibilityElementsHidden={settingsOpen}
      importantForAccessibility={settingsOpen ? 'no-hide-descendants' : 'auto'}
    >
      <SafeAreaView style={styles.safeArea}>
        <BlurTargetView ref={ambientBlurTarget} style={StyleSheet.absoluteFill}>
          <AmbientBackground appearance={appearance} />
        </BlurTargetView>
        <GlassBlurProvider target={ambientBlurTarget}>

          {scanning ? <View style={[styles.scannerArea, isLandscape && styles.scannerAreaLandscape]}>
            <GlassSurface palette={palette} variant="floating" style={[styles.scannerPanel, isLandscape && styles.scannerPanelLandscape]}>
              <View style={[styles.scannerIntro, isLandscape && styles.scannerIntroLandscape]}>
                <View style={styles.scannerCopy}>
                  <Text style={[styles.scannerTitle, { color: palette.text }]}>Scan QR</Text>
                  <Text style={[styles.body, { color: palette.muted }]}>Show the pairing QR on the PC.</Text>
                </View>
                <View style={styles.scannerActions}>
                  {!!error && <GlassControl palette={palette} title="Scan again" icon="refresh-cw" onPress={retryScan} disabled={busy} />}
                  {pairing && <GlassControl palette={palette} title="Back to deck" icon="grid" disabled={busy} onPress={() => { setScanning(false); setError(''); client.current?.connect(pairing); }} />}
                </View>
              </View>

              <View style={styles.scannerViewport}>
                {!permission ? <ActivityIndicator color={palette.accent} /> : !permission.granted ? <View style={styles.permissionState}>
                  <View style={[styles.permissionIcon, { backgroundColor: withAlpha(palette.accent, 0.12) }]}><Feather name="camera" size={25} color={palette.accent} /></View>
                  <Text style={[styles.body, { color: palette.muted }]}>Camera access is needed to read the pairing QR.</Text>
                  <GlassControl palette={palette} title={permission.canAskAgain ? 'Allow camera' : 'Open camera settings'} icon="camera" onPress={() => {
                    void (permission.canAskAgain ? requestPermission() : Linking.openSettings()).catch(() => setError('Could not open camera permissions. Enable Camera in phone settings.'));
                  }} />
                </View> : !error && active && !busy && !settingsOpen ? <View style={[styles.cameraShell, { borderColor: withAlpha(palette.buttonHighlight, 0.55) }]}>
                  <CameraView
                    style={styles.camera}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={({ data }) => { void scanned(data); }}
                    onMountError={() => setError('Camera could not start. Close other camera apps and try again.')}
                  />
                  <View pointerEvents="none" style={styles.scanFrame}>
                    {['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].map(position => <View key={position} style={[
                      styles.scanCorner,
                      position.includes('top') ? styles.cornerTop : styles.cornerBottom,
                      position.includes('Left') ? styles.cornerLeft : styles.cornerRight,
                      { borderColor: palette.buttonHighlight },
                    ]} />)}
                  </View>
                </View> : null}
                {busy && <ActivityIndicator color={palette.accent} />}
              </View>
            </GlassSurface>
          </View> : <View style={[styles.deckArea, isLandscape ? styles.deckAreaLandscape : styles.deckAreaPortrait]} onLayout={measureDeck}>
            <DeckGrid
              buttons={state.buttons}
              connected={connected}
              palette={palette}
              viewportWidth={deckViewport.width || (isLandscape ? Math.max(1, width - 64) : width)}
              viewportHeight={deckViewport.height || height}
              onPress={pressButton}
            />
            {state.buttons.length === 0 && <Text style={[styles.emptyMessage, { color: palette.muted }]}>
              {connected ? 'Add buttons on the PC.' : 'Waiting for deck…'}
            </Text>}
          </View>}

          <View style={[styles.statusCorner, isLandscape ? styles.statusCornerLandscape : styles.statusCornerPortrait]}>
            <GlassSurface palette={palette} variant="subtle" style={[styles.statusPanel, isLandscape && styles.statusPanelLandscape]}>
              <View
                accessible
                accessibilityLabel={`${status}${state.pending > 0 ? `, ${state.pending} pending` : ''}${state.notice ? `, ${state.notice}` : ''}`}
                accessibilityLiveRegion="polite"
                style={styles.statusLine}
              >
                {isLandscape
                  ? <Feather name={statusIcon} size={19} color={statusColor} />
                  : <View style={[styles.statusDotOuter, { borderColor: withAlpha(statusColor, 0.3) }]}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  </View>}
                {!isLandscape && <Text numberOfLines={1} style={[styles.statusTitle, { color: palette.text }]}>{status}</Text>}
                {!isLandscape && state.pending > 0 && <View style={[styles.pendingBadge, { backgroundColor: withAlpha(palette.accent, 0.16) }]}>
                  <Text style={[styles.pendingText, { color: palette.accent }]}>{state.pending}</Text>
                </View>}
              </View>
            </GlassSurface>
          </View>

          <View style={styles.settingsCorner}>
            <GlassControl palette={palette} title="Appearance settings" icon="sliders" compact onPress={() => setSettingsOpen(true)} />
          </View>

          {!scanning && <View style={[styles.actionDock, isLandscape ? styles.actionDockLandscape : styles.actionDockPortrait]}>
            <GlassControl palette={palette} title="Pair new PC" icon="camera" compact onPress={scanNew} />
            {pairing && <GlassControl palette={palette} title={state.status === 'connected' || state.status === 'connecting' ? 'Disconnect' : 'Retry'} compact icon={state.status === 'connected' || state.status === 'connecting' ? 'wifi-off' : 'refresh-cw'} onPress={() => {
              if (state.status === 'connected' || state.status === 'connecting') client.current?.disconnect();
              else client.current?.connect(pairing);
            }} />}
          </View>}

          {(!!error || !!appearanceError) && <GlassSurface palette={palette} variant="floating" style={[styles.errorPanel, isLandscape && styles.errorPanelLandscape, { borderColor: withAlpha(palette.danger, 0.38) }]}>
            <Feather name="alert-circle" size={16} color={palette.danger} />
            <Text accessibilityLiveRegion="assertive" numberOfLines={2} style={[styles.errorText, { color: palette.danger }]}>{error || appearanceError}</Text>
          </GlassSurface>}

        </GlassBlurProvider>
      </SafeAreaView>
    </BlurTargetView>

    {settingsOpen && <GlassBlurProvider target={sceneBlurTarget}>
      <AppearanceSettings
        preferences={appearance}
        palette={palette}
        onChange={updateAppearance}
        onClose={() => setSettingsOpen(false)}
      />
    </GlassBlurProvider>}
  </View>;
}

export default function App() { return <SafeAreaProvider><DeckRemote /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scene: { flex: 1 },
  safeArea: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  ambientTop: { position: 'absolute', width: 280, height: 280, borderRadius: 140, top: -150, right: -80 },
  ambientSide: { position: 'absolute', width: 230, height: 230, borderRadius: 115, top: '38%', left: -170 },
  ambientBottom: { position: 'absolute', width: 330, height: 210, borderRadius: 165, bottom: -145, right: -90 },
  body: { fontSize: 14, lineHeight: 20 },
  statusCorner: { position: 'absolute', zIndex: 20, elevation: 20 },
  statusCornerPortrait: { top: 8, left: 12 },
  statusCornerLandscape: { top: 60, right: 8 },
  statusPanel: { paddingHorizontal: 10, paddingVertical: 8 },
  statusPanelLandscape: { width: 44, height: 44, paddingHorizontal: 0, paddingVertical: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDotOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 5, alignItems: 'center', justifyContent: 'center' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusTitle: { fontSize: 13, fontWeight: '800' },
  pendingBadge: { minWidth: 25, height: 25, borderRadius: 13, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  pendingText: { fontSize: 11, fontWeight: '900' },
  settingsCorner: { position: 'absolute', top: 8, right: 8, zIndex: 21, elevation: 21 },
  actionDock: { position: 'absolute', zIndex: 20, elevation: 20, gap: 8 },
  actionDockPortrait: { bottom: 8, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center' },
  actionDockLandscape: { right: 8, bottom: 8, flexDirection: 'column' },
  errorPanel: { position: 'absolute', left: 16, right: 16, bottom: 62, zIndex: 30, minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorPanelLandscape: { left: '24%', right: '24%', bottom: 8 },
  errorText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  deckArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deckAreaPortrait: { marginTop: 56, marginBottom: 58 },
  deckAreaLandscape: { marginTop: 4, marginRight: 60, marginBottom: 4, marginLeft: 4 },
  emptyMessage: { position: 'absolute', alignSelf: 'center', fontSize: 11 },
  scannerArea: { flex: 1, padding: 12, paddingTop: 60 },
  scannerAreaLandscape: { padding: 8, paddingRight: 60 },
  scannerPanel: { flex: 1, padding: 14, gap: 14 },
  scannerPanelLandscape: { flexDirection: 'row' },
  scannerIntro: { gap: 12 },
  scannerIntroLandscape: { width: 190, justifyContent: 'space-between' },
  scannerCopy: { gap: 4 },
  scannerTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  scannerViewport: { flex: 1, minHeight: 0, justifyContent: 'center' },
  cameraShell: { flex: 1, minHeight: 180, borderRadius: 20, overflow: 'hidden', borderWidth: 1 },
  camera: { flex: 1 },
  scanFrame: { position: 'absolute', top: 28, right: 28, bottom: 28, left: 28 },
  scanCorner: { position: 'absolute', width: 30, height: 30 },
  cornerTop: { top: 0, borderTopWidth: 3 },
  cornerBottom: { bottom: 0, borderBottomWidth: 3 },
  cornerLeft: { left: 0, borderLeftWidth: 3 },
  cornerRight: { right: 0, borderRightWidth: 3 },
  permissionState: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 20 },
  permissionIcon: { width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  scannerActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
});
