import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { connectionUrl, type Pairing } from './protocol.ts';

const endpointKey = 'deckremote.endpoint';
const tokenKey = 'deckremote.token';
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation);
  queue = next.catch(() => undefined);
  return next;
}

export const loadPairing = () => serial(async (): Promise<Pairing | null> => {
  const endpoint = await AsyncStorage.getItem(endpointKey);
  const token = await SecureStore.getItemAsync(tokenKey);
  if (!endpoint || !token) return null;
  const pairing = { endpoint, token };
  connectionUrl(pairing);
  return pairing;
});

export const savePairing = (pairing: Pairing) => serial(async () => {
  connectionUrl(pairing);
  // Separate stores cannot commit atomically. Invalidate metadata first so a failed
  // write never pairs an old endpoint with a new secret after app restart.
  await AsyncStorage.removeItem(endpointKey);
  await SecureStore.setItemAsync(tokenKey, pairing.token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  await AsyncStorage.setItem(endpointKey, pairing.endpoint);
});

export const clearToken = () => serial(async () => {
  // Also invalidate metadata if secure deletion fails, preventing stale auto-connect.
  try { await SecureStore.deleteItemAsync(tokenKey); }
  finally { await AsyncStorage.removeItem(endpointKey); }
});
