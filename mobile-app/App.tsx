import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Linking, Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import Feather from '@expo/vector-icons/Feather';
import { DeckClient, type ClientState } from './src/client';
import { parseQr, type Pairing } from './src/protocol';
import { clearToken, loadPairing, savePairing } from './src/storage';

const color = { background: '#10141e', panel: '#1d2636', text: '#f4f7ff', muted: '#b6c2d8', accent: '#83e0bf', error: '#ffb4a9' };

function Control({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.control, pressed && styles.pressed, disabled && styles.disabled]}>
    <Text style={styles.controlText}>{title}</Text>
  </Pressable>;
}

function DeckRemote() {
  const [state, setState] = useState<ClientState>({ status: 'disconnected', buttons: [], notice: '', pending: 0 });
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [ready, setReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const client = useRef<DeckClient | null>(null);
  const scanLock = useRef(false);
  const mounted = useRef(false);
  const { width } = useWindowDimensions();
  const columns = Math.max(2, Math.min(5, Math.floor((width - 32) / 145)));

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
    }).finally(() => { if (alive) setReady(true); });
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

  const retryScan = () => { scanLock.current = false; setError(''); };
  const scanNew = () => { client.current?.disconnect(); retryScan(); setScanning(true); };
  const connected = state.status === 'connected' && !scanning && active;
  if (!ready) return <View style={styles.center}><ActivityIndicator color={color.accent} /><Text style={styles.body}>Restoring pairing…</Text></View>;

  return <SafeAreaView style={styles.screen}>
    <StatusBar barStyle="light-content" />
    <View style={styles.header}><Text style={styles.title}>DeckRemote</Text><Text style={styles.body}>Your PC, within reach.</Text></View>
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <Text style={styles.bannerText}>{scanning ? 'Pair with your PC' : state.status === 'connected' ? 'Connected' : state.status === 'connecting' ? 'Connecting…' : state.status === 'error' ? 'Connection needs attention' : 'Disconnected / waiting to reconnect'}</Text>
      {pairing && !scanning && <Text style={styles.body}>{pairing.endpoint}</Text>}
      {!!state.notice && <Text style={styles.body}>{state.notice}</Text>}
      {state.pending > 0 && <Text style={styles.body}>{state.pending} awaiting confirmation</Text>}
    </View>
    {!!error && <View style={styles.banner} accessibilityLiveRegion="assertive"><Text style={styles.error}>{error}</Text></View>}
    {scanning ? <View style={styles.scannerArea}>
      <Text style={styles.body}>Open “Show QR” in DeckRemote on your PC. Keep both devices on the same trusted Wi-Fi.</Text>
      {!permission ? <ActivityIndicator color={color.accent} /> : !permission.granted ? <View style={styles.actions}>
        <Text style={styles.body}>Camera access is needed to scan the PC’s pairing QR.</Text>
        <Control title={permission.canAskAgain ? 'Allow camera' : 'Open camera settings'} onPress={() => {
          void (permission.canAskAgain ? requestPermission() : Linking.openSettings()).catch(() => setError('Could not open camera permissions. Enable Camera in phone settings.'));
        }} />
      </View> : !error && active && !busy ? <CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => { void scanned(data); }} onMountError={() => setError('Camera could not start. Close other camera apps and try again.')} /> : null}
      {busy && <ActivityIndicator color={color.accent} />}
      {!!error && <Control title="Scan again" onPress={retryScan} disabled={busy} />}
      {pairing && <Control title="Back to deck" disabled={busy} onPress={() => { setScanning(false); setError(''); client.current?.connect(pairing); }} />}
    </View> : <>
      <FlatList key={columns} numColumns={columns} data={state.buttons} keyExtractor={button => button.id}
        contentContainerStyle={styles.grid} columnWrapperStyle={styles.row}
        ListEmptyComponent={<Text style={styles.body}>{connected ? 'No buttons yet. Add them in the PC configuration.' : 'Waiting for the PC’s deck…'}</Text>}
        renderItem={({ item }) => {
          const icon = item.icon && Object.hasOwn(Feather.glyphMap, item.icon) ? item.icon as keyof typeof Feather.glyphMap : 'grid';
          return <Pressable accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ disabled: !connected }}
            disabled={!connected} onPress={() => client.current?.press(item.id)}
            style={({ pressed }) => [styles.tile, { width: (width - 32 - (columns - 1) * 12) / columns }, pressed && styles.pressed, !connected && styles.disabled]}>
            <Feather name={icon} size={30} color={color.accent} /><Text style={styles.label}>{item.label}</Text>
          </Pressable>;
        }} />
      <View style={styles.footer}>
        <Control title="Scan new PC" onPress={scanNew} />
        {pairing && <Control title={state.status === 'connected' || state.status === 'connecting' ? 'Disconnect' : 'Retry'} onPress={() => {
          if (state.status === 'connected' || state.status === 'connecting') client.current?.disconnect();
          else client.current?.connect(pairing);
        }} />}
      </View>
    </>}
  </SafeAreaView>;
}

export default function App() { return <SafeAreaProvider><DeckRemote /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, backgroundColor: color.background },
  header: { padding: 16, gap: 4 }, title: { fontSize: 30, fontWeight: '700', color: color.text },
  body: { color: color.muted, fontSize: 15, lineHeight: 22 },
  banner: { padding: 12, marginHorizontal: 16, marginBottom: 12, borderRadius: 12, backgroundColor: color.panel, gap: 4 },
  bannerText: { color: color.accent, fontSize: 16, fontWeight: '600' }, error: { color: color.error, fontSize: 15, lineHeight: 22 },
  scannerArea: { flex: 1, padding: 16, gap: 16 }, camera: { flex: 1, minHeight: 120, borderRadius: 16, overflow: 'hidden' },
  actions: { gap: 16 }, control: { minHeight: 48, paddingHorizontal: 18, paddingVertical: 12, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: color.panel },
  controlText: { color: color.text, fontSize: 16, fontWeight: '600' },
  grid: { padding: 16, gap: 12 }, row: { gap: 12 },
  tile: { minHeight: 136, padding: 12, gap: 12, justifyContent: 'center', alignItems: 'center', borderRadius: 18, backgroundColor: color.panel },
  label: { color: color.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  pressed: { opacity: 0.6, transform: [{ scale: 0.97 }] }, disabled: { opacity: 0.45 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, gap: 12 },
});
