import { Platform } from 'react-native';
import { supabase } from './supabase';

// Chave PÚBLICA gerada com: npx.cmd web-push generate-vapid-keys
// (a chave privada NÃO vai aqui: ela fica só nos "Secrets" do Supabase)
const VAPID_PUBLIC_KEY = 'BEm6hbPhPXyJjyjUsZXEIT6Ds3t3ptg_Ya0i0V7efZ4UNjl_zQB9LHDTJwJh7T1F-5AAOGWvStiybo72JVrcVUk';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const saida = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) saida[i] = raw.charCodeAt(i);
  return saida;
}

function ehWeb() {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

// App aberto pelo ícone da tela inicial (e não pela aba do navegador)
function emModoApp() {
  if (!ehWeb()) return false;
  return (
    window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  );
}

// No iPhone o aviso só funciona se o site foi adicionado à Tela de Início
export function precisaAdicionarATelaInicial() {
  if (!ehWeb()) return false;
  const ua = window.navigator.userAgent || '';
  const ios =
    /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && window.navigator.maxTouchPoints > 1);
  return ios && !emModoApp();
}

function webPushSuportado() {
  return (
    ehWeb() &&
    'serviceWorker' in window.navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// Pede permissão (se ainda não deu), assina o push e grava a assinatura no Supabase.
// IMPORTANTE: chamar direto de um toque do usuário na primeira vez.
export async function registrarWebPush() {
  try {
    if (!webPushSuportado()) return { ok: false, motivo: 'nao-suportado' };
    if (VAPID_PUBLIC_KEY.startsWith('COLE_AQUI')) return { ok: false, motivo: 'sem-chave' };

    let permissao = Notification.permission;
    if (permissao === 'default') permissao = await Notification.requestPermission();
    if (permissao !== 'granted') return { ok: false, motivo: 'negado' };

    const registro = await window.navigator.serviceWorker.register('/sw.js');
    await window.navigator.serviceWorker.ready;

    let assinatura = await registro.pushManager.getSubscription();
    if (!assinatura) {
      assinatura = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const { error } = await supabase.rpc('registrar_web_push', {
      p_subscription: assinatura.toJSON(),
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn('Push web indisponível:', e?.message || e);
    return { ok: false, motivo: 'erro' };
  }
}

// Ao sair da conta, este aparelho deixa de receber os avisos desse usuário
export async function removerWebPush() {
  try {
    if (!webPushSuportado()) return;
    const registro = await window.navigator.serviceWorker.getRegistration('/');
    const assinatura = registro ? await registro.pushManager.getSubscription() : null;
    if (assinatura) {
      await supabase.rpc('remover_web_push', { p_endpoint: assinatura.endpoint });
    }
  } catch (e) {
    console.warn('Não foi possível remover o aviso web:', e?.message || e);
  }
}