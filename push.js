import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// Com o app aberto, quem avisa é o banner da tela; o push só aparece com o app em segundo plano ou fechado
if (Platform.OS === 'android') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: false,
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

let tokenAtual = null;

// Pede permissão, pega o token do aparelho e grava no Supabase para o usuário logado
export async function registrarPush() {
  try {
    if (Platform.OS !== 'android' || !Device.isDevice) return null;

    await Notifications.setNotificationChannelAsync('default', {
      name: 'Liberações de entrada',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500],
      sound: 'default',
    });

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.warn('Push: projectId do EAS não encontrado (rode "eas init").');
      return null;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.rpc('registrar_push_token', { p_token: token });
    if (error) throw error;

    tokenAtual = token;
    return token;
  } catch (e) {
    // No Expo Go o push não funciona; o app segue normal, só sem aviso com o app fechado
    console.warn('Push indisponível:', e?.message || e);
    return null;
  }
}

// Chamar antes de sair da conta, para o aparelho não receber avisos de outro usuário
export async function removerPushAtual() {
  if (!tokenAtual) return;
  try {
    await supabase.rpc('remover_push_token', { p_token: tokenAtual });
  } catch (e) {
    console.warn('Não foi possível remover o token de push:', e?.message || e);
  }
  tokenAtual = null;
}