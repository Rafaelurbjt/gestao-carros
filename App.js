import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Alert, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Vibration,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from './supabase';
import { registrarPush, removerPushAtual } from './push';
import { registrarWebPush, removerWebPush, precisaAdicionarATelaInicial } from './pushweb';

const TABELA = 'registros';

// Converte linha do banco (snake_case) para o formato usado no app
const deBanco = (r) => ({
  key: r.id,
  placa: r.placa,
  idNumero: r.id_numero,
  doca: r.doca,
  pddSaida: r.pdd_saida,
  pddChegada: r.pdd_chegada,
  dataSaida: r.data_saida,
  dataChegada: r.data_chegada,
  liberadoEm: r.liberado_em,
});

// Alert.alert não funciona na web, então usamos window.alert/confirm lá
function aviso(titulo, msg) {
  if (Platform.OS === 'web') window.alert(msg ? `${titulo}\n${msg}` : titulo);
  else Alert.alert(titulo, msg);
}

function confirmar(titulo, msg, onConfirm) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${titulo}\n${msg}`)) onConfirm();
    return;
  }
  Alert.alert(titulo, msg, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Confirmar', style: 'destructive', onPress: onConfirm },
  ]);
}

// Avisa o porteiro: vibra no celular; na web toca um bipe e mostra notificação do navegador
function notificarLiberacao(placa, doca, audioCtx) {
  if (Platform.OS !== 'web') {
    Vibration.vibrate([0, 500, 250, 500]);
    return;
  }
  try {
    if (audioCtx) {
      const osc = audioCtx.createOscillator();
      const ganho = audioCtx.createGain();
      osc.connect(ganho);
      ganho.connect(audioCtx.destination);
      osc.frequency.value = 880;
      ganho.gain.value = 0.2;
      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
    }
  } catch (e) { /* sem som, o banner continua aparecendo */ }
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Entrada liberada', { body: `Carro ${placa} liberado. Doca: ${doca || '-'}` });
    }
  } catch (e) { /* notificação do navegador indisponível */ }
}

// Máscara DD/MM/AAAA HH:MM enquanto digita
function maskDateTime(text) {
  const d = text.replace(/\D/g, '').slice(0, 12);
  let out = d.slice(0, 2);
  if (d.length > 2) out += '/' + d.slice(2, 4);
  if (d.length > 4) out += '/' + d.slice(4, 8);
  if (d.length > 8) out += ' ' + d.slice(8, 10);
  if (d.length > 10) out += ':' + d.slice(10, 12);
  return out;
}

function nowFormatted() {
  const n = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${p(n.getDate())}/${p(n.getMonth() + 1)}/${n.getFullYear()} ${p(n.getHours())}:${p(n.getMinutes())}`;
}

function getStatus(r) {
  if (r.liberadoEm) return 'Liberado';
  if (r.dataChegada) return 'Chegou';
  if (r.dataSaida) return 'Em trânsito';
  return 'Aguardando';
}

const STATUS_COLOR = {
  'Aguardando': '#9e9e9e',
  'Em trânsito': '#f59e0b',
  'Chegou': '#2563eb',
  'Liberado': '#16a34a',
};

const EMPTY = {
  placa: '', idNumero: '', doca: '',
  pddSaida: '', pddChegada: '',
  dataSaida: '', dataChegada: '',
};

// ---------------------------------------------------------------------------
// App: controla login e perfil
// ---------------------------------------------------------------------------
export default function App() {
  const [sessao, setSessao] = useState(undefined); // undefined = ainda verificando
  const [perfil, setPerfil] = useState(null);
  const [erroPerfil, setErroPerfil] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => setSessao(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = sessao?.user?.id;

  useEffect(() => {
    if (!userId) {
      setPerfil(null);
      setErroPerfil('');
      return;
    }
    let ativo = true;
    (async () => {
      const { data, error } = await supabase
        .from('perfis')
        .select('papel,email')
        .eq('id', userId)
        .single();
      if (!ativo) return;
      if (error || !data) {
        console.error(error);
        setErroPerfil('Não foi possível carregar seu perfil. Fale com o administrador.');
      } else {
        setPerfil(data);
        setErroPerfil('');
      }
    })();
    return () => { ativo = false; };
  }, [userId]);

  const entrar = async (email, senha) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    if (!error) return '';
    if (/invalid login credentials/i.test(error.message)) return 'E-mail ou senha incorretos.';
    return 'Não foi possível entrar. Verifique a internet e tente de novo.';
  };

  const sair = async () => {
    await removerPushAtual();
    await removerWebPush();
    await supabase.auth.signOut();
  };

  let conteudo;
  if (sessao === undefined) {
    conteudo = <Carregando />;
  } else if (!sessao) {
    conteudo = <Login onEntrar={entrar} />;
  } else if (erroPerfil) {
    conteudo = <ErroPerfil texto={erroPerfil} onSair={sair} />;
  } else if (!perfil) {
    conteudo = <Carregando />;
  } else {
    conteudo = <Principal perfil={perfil} onSair={sair} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>{conteudo}</SafeAreaView>
    </SafeAreaProvider>
  );
}

function Carregando() {
  return (
    <View style={styles.centro}>
      <ActivityIndicator size="large" color="#1d4ed8" />
    </View>
  );
}

function ErroPerfil({ texto, onSair }) {
  return (
    <View style={styles.centro}>
      <Text style={styles.erroTexto}>{texto}</Text>
      <TouchableOpacity style={[styles.botao, { alignSelf: 'stretch', marginHorizontal: 24 }]} onPress={onSair}>
        <Text style={styles.botaoTexto}>Sair</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tela de login
// ---------------------------------------------------------------------------
function Login({ onEntrar }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    if (!email.trim() || !senha) {
      setErro('Informe e-mail e senha.');
      return;
    }
    setEnviando(true);
    setErro('');
    const msg = await onEntrar(email, senha);
    if (msg) {
      setErro(msg);
      setEnviando(false);
    }
    // Se deu certo, o App troca de tela sozinho
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Gestão de Carros</Text>
      </View>
      <ScrollView contentContainerStyle={styles.loginBox} keyboardShouldPersistTaps="handled">
        <Text style={styles.loginTitulo}>Entrar</Text>

        <Campo
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
        />
        <Campo
          label="Senha"
          value={senha}
          onChangeText={setSenha}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password"
          onSubmitEditing={enviar}
        />

        {!!erro && <Text style={styles.erroTexto}>{erro}</Text>}

        <TouchableOpacity style={[styles.botao, enviando && { opacity: 0.6 }]} onPress={enviar} disabled={enviando}>
          <Text style={styles.botaoTexto}>{enviando ? 'Entrando...' : 'Entrar'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Telas internas (depois do login)
// ---------------------------------------------------------------------------
function Principal({ perfil, onSair }) {
  const eAdmin = perfil.papel === 'admin';

  const [aba, setAba] = useState('cadastro');
  const [registros, setRegistros] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [filtroPlaca, setFiltroPlaca] = useState('');
  const [filtroId, setFiltroId] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erroConexao, setErroConexao] = useState(false);
  // Admin: card em que está digitando a doca antes de liberar a entrada
  const [liberandoKey, setLiberandoKey] = useState(null);
  const [docaLiberar, setDocaLiberar] = useState('');

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from(TABELA)
      .select('*')
      .order('criado_em', { ascending: false });
    if (error) {
      console.error(error);
      setErroConexao(true);
    } else {
      setRegistros(data.map(deBanco));
      setErroConexao(false);
    }
    setCarregando(false);
  }, []);

  // Admin e portaria veem o relatório; só o admin libera e exclui
  useEffect(() => {
    carregar();
    const canal = supabase
      .channel('registros-mudancas')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABELA }, carregar)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') carregar();
      });
    return () => {
      supabase.removeChannel(canal);
    };
  }, [carregar]);

  // Porteiro: avisa quando o admin libera a entrada de um carro
  const [avisos, setAvisos] = useState([]);
  const [avisosAtivos, setAvisosAtivos] = useState(
    Platform.OS !== 'web' ||
    (typeof Notification !== 'undefined' && Notification.permission === 'granted')
  );
  const audioRef = useRef(null);

  useEffect(() => {
    if (eAdmin) return undefined;
    const canal = supabase
      .channel('minhas-liberacoes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABELA }, (payload) => {
        const novo = payload.new || {};
        const antigo = payload.old || {};
        if (novo.liberado_em && !antigo.liberado_em) {
          setAvisos((prev) => [
            { id: novo.id, placa: novo.placa, idNumero: novo.id_numero, doca: novo.doca, quando: novo.liberado_em },
            ...prev,
          ]);
          notificarLiberacao(novo.placa, novo.doca, audioRef.current);
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [eAdmin]);

  // Porteiro no Android: registra o aparelho para receber push com o app fechado
  useEffect(() => {
    if (eAdmin) return;
    registrarPush();
  }, [eAdmin]);

  // Na web o navegador só libera som e notificação depois de um toque do usuário
  const ativarAvisos = async () => {
    // O pedido de permissão precisa começar logo no toque, antes de qualquer espera
    const registro = registrarWebPush();
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        audioRef.current = new Ctx();
        await audioRef.current.resume();
      }
    } catch (e) { /* sem som, o banner continua aparecendo */ }

    const r = await registro;
    if (r.ok) {
      setAvisosAtivos(true);
      aviso('Avisos ativados', 'Você será avisado quando uma entrada for liberada.');
    } else if (r.motivo === 'negado') {
      aviso('Avisos bloqueados', 'Libere as notificações deste app nas configurações do aparelho e toque de novo.');
    } else if (r.motivo === 'nao-suportado') {
      setAvisosAtivos(true);
      aviso('Aviso', 'Este navegador não recebe avisos com o app fechado. Com o app aberto, o aviso aparece normalmente.');
    } else {
      aviso('Erro', 'Não foi possível ativar os avisos. Tente de novo.');
    }
  };

  // Web: se a permissão já foi dada, renova o registro do aparelho para este usuário
  useEffect(() => {
    if (eAdmin || Platform.OS !== 'web') return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      registrarWebPush();
    }
  }, [eAdmin]);

  const setCampo = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  const cadastrar = async () => {
    if (!form.placa.trim() || !form.idNumero.trim()) {
      aviso('Atenção', 'Preencha pelo menos a placa e o número do ID.');
      return;
    }
    const { error } = await supabase.from(TABELA).insert({
      placa: form.placa.toUpperCase().trim(),
      id_numero: form.idNumero.trim(),
      doca: form.doca,
      pdd_saida: form.pddSaida,
      pdd_chegada: form.pddChegada,
      data_saida: form.dataSaida,
      data_chegada: form.dataChegada,
    });
    if (error) {
      console.error(error);
      aviso('Erro', 'Não foi possível salvar. Verifique a internet e tente de novo.');
      return;
    }
    setForm(EMPTY);
    aviso('Pronto', 'Registro salvo!');
    await carregar();
    // O admin vai direto para o relatório; a portaria fica no cadastro para o próximo carro
    if (eAdmin) setAba('relatorio');
  };

  const atualizar = async (key, campos) => {
    const { error } = await supabase.from(TABELA).update(campos).eq('id', key);
    if (error) {
      console.error(error);
      aviso('Erro', 'Não foi possível atualizar. Verifique a internet e tente de novo.');
      return;
    }
    carregar();
  };

  const marcarChegada = (key) => atualizar(key, { data_chegada: nowFormatted() });

  // O admin diz em qual doca o carro deve parar ao liberar a entrada
  const confirmarLiberacao = async (key) => {
    if (!eAdmin) return; // segunda barreira; a regra de verdade fica no Supabase
    if (!docaLiberar.trim()) {
      aviso('Atenção', 'Informe em qual doca o carro deve parar.');
      return;
    }
    await atualizar(key, { liberado_em: nowFormatted(), doca: docaLiberar.trim() });
    setLiberandoKey(null);
    setDocaLiberar('');
  };

  const excluir = (key) => {
    if (!eAdmin) return; // segunda barreira; a regra de verdade fica no Supabase
    confirmar('Excluir', 'Deseja excluir este registro?', async () => {
      const { error } = await supabase.from(TABELA).delete().eq('id', key);
      if (error) {
        console.error(error);
        aviso('Erro', 'Não foi possível excluir.');
        return;
      }
      carregar();
    });
  };

  const registrosFiltrados = registros.filter((r) => {
    const placaOk = (r.placa || '').toUpperCase().includes(filtroPlaca.toUpperCase().trim());
    const idOk = (r.idNumero || '').includes(filtroId.trim());
    return placaOk && idOk;
  });

  return (
    <>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Gestão de Carros</Text>
          <Text style={styles.headerSub}>
            {perfil.email} · {eAdmin ? 'Administrador' : 'Portaria'}
          </Text>
        </View>
        <TouchableOpacity style={styles.sair} onPress={onSair}>
          <Text style={styles.sairTexto}>Sair</Text>
        </TouchableOpacity>
      </View>

      {erroConexao && (
        <View style={styles.aviso}>
          <Text style={styles.avisoTexto}>
            Sem conexão com o servidor. Os dados podem estar desatualizados.
          </Text>
        </View>
      )}

      {!eAdmin && Platform.OS === 'web' && precisaAdicionarATelaInicial() && (
        <View style={styles.ativar}>
          <Text style={styles.ativarTexto}>
            Para receber avisos no iPhone: toque em Compartilhar, depois em Adicionar à Tela de Início, e abra o app pelo ícone.
          </Text>
        </View>
      )}

      {!eAdmin && Platform.OS === 'web' && !precisaAdicionarATelaInicial() && !avisosAtivos && (
        <TouchableOpacity style={styles.ativar} onPress={ativarAvisos}>
          <Text style={styles.ativarTexto}>Toque aqui para ativar os avisos de liberação</Text>
        </TouchableOpacity>
      )}

      {!eAdmin && avisos.length > 0 && (
        <ScrollView style={styles.avisosLista}>
          {avisos.map((a) => (
            <View key={`${a.id}-${a.quando}`} style={styles.liberado}>
              <View style={{ flex: 1 }}>
                <Text style={styles.liberadoTitulo}>Entrada liberada: {a.placa}</Text>
                <Text style={styles.liberadoDoca}>Parar na doca: {a.doca || '-'}</Text>
                <Text style={styles.liberadoSub}>ID {a.idNumero} · {a.quando}</Text>
              </View>
              <TouchableOpacity
                style={styles.liberadoOk}
                onPress={() => setAvisos((prev) => prev.filter((x) => x !== a))}
              >
                <Text style={styles.liberadoOkTexto}>OK</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.content}>
        {aba === 'cadastro' ? (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              <Campo label="Placa do carro" value={form.placa} onChangeText={(t) => setCampo('placa', t)} autoCapitalize="characters" maxLength={8} />
              <Campo label="Número do ID" value={form.idNumero} onChangeText={(t) => setCampo('idNumero', t)} keyboardType="numeric" />
              <Campo label="PDD de saída" value={form.pddSaida} onChangeText={(t) => setCampo('pddSaida', t)} />
              <Campo label="PDD de chegada" value={form.pddChegada} onChangeText={(t) => setCampo('pddChegada', t)} />
              <Campo label="Data/hora de saída" placeholder="DD/MM/AAAA HH:MM" value={form.dataSaida} onChangeText={(t) => setCampo('dataSaida', maskDateTime(t))} keyboardType="numeric" />
              <Campo label="Data/hora de chegada" placeholder="DD/MM/AAAA HH:MM" value={form.dataChegada} onChangeText={(t) => setCampo('dataChegada', maskDateTime(t))} keyboardType="numeric" />

              <TouchableOpacity style={styles.botao} onPress={cadastrar}>
                <Text style={styles.botaoTexto}>Salvar registro</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : (
          <ScrollView contentContainerStyle={styles.lista} keyboardShouldPersistTaps="handled">
            <View style={styles.filtros}>
              <TextInput
                style={[styles.input, styles.filtroInput]}
                placeholder="Filtrar por placa"
                placeholderTextColor="#9ca3af"
                value={filtroPlaca}
                onChangeText={setFiltroPlaca}
                autoCapitalize="characters"
              />
              <TextInput
                style={[styles.input, styles.filtroInput]}
                placeholder="Filtrar por ID"
                placeholderTextColor="#9ca3af"
                value={filtroId}
                onChangeText={setFiltroId}
                keyboardType="numeric"
              />
            </View>

            {!!(filtroPlaca || filtroId) && (
              <TouchableOpacity onPress={() => { setFiltroPlaca(''); setFiltroId(''); }}>
                <Text style={styles.limpar}>Limpar filtros</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.contador}>
              {registrosFiltrados.length} de {registros.length} registro(s)
            </Text>

            {carregando && <Text style={styles.vazio}>Carregando...</Text>}

            {!carregando && registrosFiltrados.length === 0 && (
              <Text style={styles.vazio}>
                {registros.length === 0 ? 'Nenhum registro ainda.' : 'Nenhum registro encontrado.'}
              </Text>
            )}

            {registrosFiltrados.map((r) => {
              const status = getStatus(r);
              return (
                <View key={r.key} style={styles.card}>
                  <View style={styles.cardTopo}>
                    <Text style={styles.placa}>{r.placa}</Text>
                    <View style={[styles.badge, { backgroundColor: STATUS_COLOR[status] }]}>
                      <Text style={styles.badgeTexto}>{status}</Text>
                    </View>
                  </View>
                  <Linha titulo="ID" valor={r.idNumero} />
                  <Linha titulo="Doca" valor={r.doca} />
                  <Linha titulo="PDD saída" valor={r.pddSaida} />
                  <Linha titulo="PDD chegada" valor={r.pddChegada} />
                  <Linha titulo="Saída" valor={r.dataSaida} />
                  <Linha titulo="Chegada" valor={r.dataChegada} />
                  <Linha titulo="Liberado em" valor={r.liberadoEm} />

                  <View style={styles.acoes}>
                    {status === 'Em trânsito' && (
                      <TouchableOpacity style={styles.botaoPequeno} onPress={() => marcarChegada(r.key)}>
                        <Text style={styles.botaoTexto}>Marcar chegada agora</Text>
                      </TouchableOpacity>
                    )}
                    {eAdmin && status !== 'Liberado' && liberandoKey !== r.key && (
                      <TouchableOpacity
                        style={[styles.botaoPequeno, { backgroundColor: '#16a34a' }]}
                        onPress={() => { setLiberandoKey(r.key); setDocaLiberar(''); }}
                      >
                        <Text style={styles.botaoTexto}>Liberar entrada</Text>
                      </TouchableOpacity>
                    )}
                    {eAdmin && (
                      <TouchableOpacity style={[styles.botaoPequeno, { backgroundColor: '#dc2626' }]} onPress={() => excluir(r.key)}>
                        <Text style={styles.botaoTexto}>Excluir</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {eAdmin && liberandoKey === r.key && (
                    <View style={styles.liberarBox}>
                      <Text style={styles.label}>Em qual doca o carro deve parar?</Text>
                      <TextInput
                        style={styles.input}
                        value={docaLiberar}
                        onChangeText={setDocaLiberar}
                        placeholder="Ex.: Doca 3"
                        placeholderTextColor="#9ca3af"
                        autoFocus
                        onSubmitEditing={() => confirmarLiberacao(r.key)}
                      />
                      <View style={styles.acoes}>
                        <TouchableOpacity
                          style={[styles.botaoPequeno, { backgroundColor: '#6b7280' }]}
                          onPress={() => { setLiberandoKey(null); setDocaLiberar(''); }}
                        >
                          <Text style={styles.botaoTexto}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.botaoPequeno, { backgroundColor: '#16a34a' }]}
                          onPress={() => confirmarLiberacao(r.key)}
                        >
                          <Text style={styles.botaoTexto}>Confirmar liberação</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View style={styles.tabBar}>
        <Aba titulo="Cadastro" ativa={aba === 'cadastro'} onPress={() => setAba('cadastro')} />
        <Aba titulo="Relatório" ativa={aba === 'relatorio'} onPress={() => setAba('relatorio')} />
      </View>
    </>
  );
}

function Campo({ label, ...props }) {
  return (
    <View style={styles.campo}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor="#9ca3af" {...props} />
    </View>
  );
}

function Linha({ titulo, valor }) {
  return (
    <View style={styles.linha}>
      <Text style={styles.linhaTitulo}>{titulo}</Text>
      <Text style={styles.linhaValor}>{valor || '-'}</Text>
    </View>
  );
}

function Aba({ titulo, ativa, onPress }) {
  return (
    <TouchableOpacity style={[styles.aba, ativa && styles.abaAtiva]} onPress={onPress}>
      <Text style={[styles.abaTexto, ativa && styles.abaTextoAtivo]}>{titulo}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  centro: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: { backgroundColor: '#1d4ed8', padding: 16, flexDirection: 'row', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  headerSub: { color: '#dbeafe', fontSize: 12, marginTop: 2 },
  sair: { borderWidth: 1, borderColor: '#fff', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  sairTexto: { color: '#fff', fontWeight: 'bold' },
  loginBox: { padding: 24, width: '100%', maxWidth: 420, alignSelf: 'center' },
  loginTitulo: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, color: '#111827' },
  erroTexto: { color: '#dc2626', fontWeight: '600', marginBottom: 12, textAlign: 'center' },
  aviso: { backgroundColor: '#fef3c7', padding: 10 },
  avisoTexto: { color: '#92400e', textAlign: 'center', fontWeight: '600' },
  ativar: { backgroundColor: '#dbeafe', padding: 10 },
  ativarTexto: { color: '#1e40af', textAlign: 'center', fontWeight: '700' },
  avisosLista: { maxHeight: 220, flexGrow: 0 },
  liberado: { backgroundColor: '#16a34a', padding: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#15803d' },
  liberadoTitulo: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  liberadoDoca: { color: '#fff', fontWeight: 'bold', fontSize: 22, marginTop: 4 },
  liberadoSub: { color: '#dcfce7', fontSize: 12, marginTop: 2 },
  liberarBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  liberadoOk: { backgroundColor: '#fff', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 14 },
  liberadoOkTexto: { color: '#15803d', fontWeight: 'bold' },
  content: { flex: 1 },
  form: { padding: 16 },
  campo: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 4, color: '#374151' },
  input: { backgroundColor: '#fff', color: '#111827', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10, fontSize: 16 },
  botao: { backgroundColor: '#1d4ed8', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  botaoPequeno: { backgroundColor: '#1d4ed8', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6 },
  botaoTexto: { color: '#fff', fontWeight: 'bold' },
  lista: { padding: 16 },
  vazio: { textAlign: 'center', color: '#6b7280', marginTop: 40 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, elevation: 2 },
  cardTopo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  placa: { fontSize: 20, fontWeight: 'bold', color: '#111827' },
  badge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  badgeTexto: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  linhaTitulo: { color: '#6b7280' },
  linhaValor: { fontWeight: '600', color: '#111827' },
  acoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, justifyContent: 'flex-end' },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  aba: { flex: 1, padding: 14, alignItems: 'center' },
  abaAtiva: { borderTopWidth: 3, borderTopColor: '#1d4ed8' },
  abaTexto: { color: '#6b7280', fontWeight: '600' },
  abaTextoAtivo: { color: '#1d4ed8' },
  filtros: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  filtroInput: { flex: 1 },
  limpar: { color: '#1d4ed8', fontWeight: '600', marginBottom: 8 },
  contador: { color: '#6b7280', marginBottom: 10 },
});